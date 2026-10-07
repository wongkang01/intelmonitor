"""Every Jev and Claude call goes through `Inference`, which writes an InferenceRecord per call and
serves repeat calls (same stage and identical input) from those records, so an interrupted run
resumes without redoing finished work."""

import asyncio
import hashlib
import json
import sqlite3
import time
from collections.abc import Mapping
from datetime import UTC, datetime
from weakref import WeakKeyDictionary

from pydantic import BaseModel, TypeAdapter
from typesafe_sdk import Answer, Choice, ChoiceAnswer, Noul, NoulAnswer, Score, ScoreAnswer

from intelmonitor.config import get_settings
from intelmonitor.pipeline.claude import ask_claude
from intelmonitor.pipeline.jev import ask_jev
from intelmonitor.pipeline.params import CLAUDE_CONCURRENCY, JEV_CONCURRENCY

type JevQuestion = Noul | Choice | Score
type JevAnswers = dict[str, Answer]

_ANSWERS = TypeAdapter(dict[str, Answer])
_CLAUDE_ATTEMPTS = 3
_CLAUDE_BACKOFF_SECONDS = 20.0


class ClaudeRefused(RuntimeError):
    """Claude declined the input (a usage-policy refusal). Retrying the same input will not
    help, so the refusal is recorded like an answer and callers fall back."""


def _is_refusal(error: Exception) -> bool:
    text = str(error)
    return "anthropic.com/legal/aup" in text or "can't help with this" in text


class UnrecordedCall(RuntimeError):
    """A call with no record, made by an Inference that may only replay recorded ones."""


class StepFailed(RuntimeError):
    """Some items of a pipeline step failed; the rest finished and their calls are cached."""

    def __init__(self, step: str, failures: list[str]) -> None:
        super().__init__(f"{step}: {len(failures)} failed, first: {failures[0]}")
        self.failures = failures


def certainty(answer: Answer) -> float:
    """How sure Jev is of an answer, 0.5 to 1 for nouls and the reported confidence otherwise."""
    if isinstance(answer, NoulAnswer):
        return max(answer.noul, 1 - answer.noul)
    return answer.confidence


def noul(answers: JevAnswers, name: str) -> float:
    answer = answers[name]
    assert isinstance(answer, NoulAnswer), name
    return answer.noul


def choice(answers: JevAnswers, name: str) -> ChoiceAnswer:
    answer = answers[name]
    assert isinstance(answer, ChoiceAnswer), name
    return answer


def score(answers: JevAnswers, name: str) -> ScoreAnswer:
    answer = answers[name]
    assert isinstance(answer, ScoreAnswer), name
    return answer


type _Limits = tuple[asyncio.Semaphore, asyncio.Semaphore]
_limits: WeakKeyDictionary[asyncio.AbstractEventLoop, _Limits] = WeakKeyDictionary()


def _engine_limits() -> _Limits:
    """The (Jev, Claude) semaphores shared by every Inference on the running event loop, so
    parallel API requests stay within the same caps as one pipeline run."""
    loop = asyncio.get_running_loop()
    if (limits := _limits.get(loop)) is None:
        limits = _limits[loop] = (
            asyncio.Semaphore(JEV_CONCURRENCY),
            asyncio.Semaphore(CLAUDE_CONCURRENCY),
        )
    return limits


def _hash(payload: object) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


class Inference:
    """Model calls for one run. Concurrency is capped per engine across all callers on the loop.
    With `recorded_only`, a call with no record raises UnrecordedCall instead of reaching a model,
    as in `im check past-run`."""

    def __init__(
        self, conn: sqlite3.Connection, run_id: str | None, *, recorded_only: bool = False
    ) -> None:
        self.conn = conn
        self.run_id = run_id
        self.recorded_only = recorded_only
        self.calls = 0
        self.cache_hits = 0

    async def jev(
        self,
        stage: str,
        input_ref: str,
        state: str,
        questions: Mapping[str, JevQuestion],
        confidence_of: str | None = None,
    ) -> JevAnswers:
        """One System One call. The record's confidence is Jev's certainty on `confidence_of`,
        or the lowest certainty across all answers."""
        model = get_settings().typesafe_default_model
        key = _hash(
            {
                "model": model,
                "state": state,
                "questions": {k: q.model_dump(mode="json") for k, q in questions.items()},
            }
        )
        if (cached := self._cached(stage, key)) is not None:
            return _ANSWERS.validate_json(cached)
        self._require_record(stage, input_ref)
        async with _engine_limits()[0]:
            started = time.monotonic()
            try:
                response = await ask_jev(state, questions)
            except Exception as error:
                self._record(stage, "jev", model, input_ref, key, started, error=error)
                raise
        answers = response.answers
        conf = (
            certainty(answers[confidence_of])
            if confidence_of
            else min(certainty(a) for a in answers.values())
        )
        self._record(
            stage,
            "jev",
            model,
            input_ref,
            key,
            started,
            output=_ANSWERS.dump_json(answers).decode(),
            model_version=response.model,
            confidence=conf,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
        return answers

    async def claude[T: BaseModel](
        self,
        stage: str,
        input_ref: str,
        prompt: str,
        schema: type[T],
        system: str,
        model: str | None = None,
    ) -> T:
        """One structured Claude turn on `model` (default settings.anthropic_model), retried on
        failure; every attempt is recorded."""
        model = model or get_settings().anthropic_model
        key = _hash(
            {
                "model": model,
                "system": system,
                "prompt": prompt,
                "schema": schema.model_json_schema(),
            }
        )
        if (cached := self._cached(stage, key)) is not None:
            return schema.model_validate_json(cached)
        if self._cached(stage, key, status="refused") is not None:
            raise ClaudeRefused(f"{stage} {input_ref}: refused earlier")
        self._require_record(stage, input_ref)
        async with _engine_limits()[1]:
            for attempt in range(1, _CLAUDE_ATTEMPTS + 1):
                started = time.monotonic()
                try:
                    reply = await ask_claude(prompt, schema, system, model)
                except Exception as error:
                    refused = _is_refusal(error)
                    status = "refused" if refused else "error"
                    self._record(
                        stage, "claude", model, input_ref, key, started, error=error, status=status
                    )
                    if refused:
                        raise ClaudeRefused(f"{stage} {input_ref}: {error}") from error
                    if attempt == _CLAUDE_ATTEMPTS:
                        raise
                    await asyncio.sleep(_CLAUDE_BACKOFF_SECONDS * attempt)
                    continue
                self._record(
                    stage,
                    "claude",
                    model,
                    input_ref,
                    key,
                    started,
                    output=reply.output.model_dump_json(),
                    model_version=reply.model_version,
                    input_tokens=reply.input_tokens,
                    output_tokens=reply.output_tokens,
                    cost_usd=reply.cost_usd,
                )
                return reply.output
        raise AssertionError("unreachable")

    def _require_record(self, stage: str, input_ref: str) -> None:
        if self.recorded_only:
            raise UnrecordedCall(f"{stage} {input_ref}: no recorded call")

    def _cached(self, stage: str, key: str, status: str = "ok") -> str | None:
        row = self.conn.execute(
            "SELECT output FROM inference_records "
            "WHERE stage = ? AND input_hash = ? AND status = ? ORDER BY id DESC LIMIT 1",
            (stage, key, status),
        ).fetchone()
        if row is None:
            return None
        self.cache_hits += 1
        return str(row["output"] or "")

    def _record(
        self,
        stage: str,
        engine: str,
        model: str,
        input_ref: str,
        key: str,
        started: float,
        *,
        output: str | None = None,
        model_version: str | None = None,
        confidence: float | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        cost_usd: float | None = None,
        error: Exception | None = None,
        status: str | None = None,
    ) -> None:
        self.calls += 1
        self.conn.execute(
            "INSERT INTO inference_records (run_id, stage, engine, model, model_version, "
            "input_ref, input_hash, output, confidence, input_tokens, output_tokens, cost_usd, "
            "duration_ms, status, error, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                self.run_id,
                stage,
                engine,
                model,
                model_version,
                input_ref,
                key,
                output,
                confidence,
                input_tokens,
                output_tokens,
                cost_usd,
                int((time.monotonic() - started) * 1000),
                status or ("error" if error else "ok"),
                f"{type(error).__name__}: {error}"[:2000] if error else None,
                datetime.now(UTC).isoformat(),
            ),
        )
        self.conn.commit()
