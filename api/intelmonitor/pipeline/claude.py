"""Claude through the Claude Agent SDK, on the user's Claude login, with structured JSON output."""

import os
from dataclasses import dataclass

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query
from pydantic import BaseModel

from intelmonitor.config import get_settings


def scrub_parent_env() -> None:
    """Keep the SDK's CLI subprocess from inheriting a parent Claude Code session or an empty
    API key, either of which stops it from running on the user's Claude login."""
    for key in list(os.environ):
        if key == "CLAUDECODE" or key.startswith("CLAUDE_CODE_"):
            del os.environ[key]
    if not os.environ.get("ANTHROPIC_API_KEY"):
        os.environ.pop("ANTHROPIC_API_KEY", None)


@dataclass(frozen=True)
class ClaudeReply[T: BaseModel]:
    output: T
    model_version: str | None  # the model the CLI reports having used
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None


async def ask_claude[T: BaseModel](
    prompt: str, schema: type[T], system: str | None = None, model: str | None = None
) -> ClaudeReply[T]:
    """Run one tool-free Claude turn and validate its structured output against `schema`, on
    `model` (default settings.anthropic_model)."""
    scrub_parent_env()
    options = ClaudeAgentOptions(
        model=model or get_settings().anthropic_model,
        system_prompt=system,
        tools=[],
        # No settings, MCP servers (including account connectors) or skills: their tool
        # definitions would add tens of thousands of input tokens to every call.
        setting_sources=[],
        strict_mcp_config=True,
        skills=[],
        output_format={"type": "json_schema", "schema": schema.model_json_schema()},
    )
    result: ResultMessage | None = None
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, ResultMessage):
            result = message
    if result is None or result.is_error or result.structured_output is None:
        detail = result.result if result else "no result message"
        raise RuntimeError(f"Claude returned no structured output: {detail}")
    usage = result.usage or {}
    return ClaudeReply(
        output=schema.model_validate(result.structured_output),
        model_version=_model_version(result, options.model),
        input_tokens=_tokens(
            usage, "input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"
        ),
        output_tokens=_tokens(usage, "output_tokens"),
        cost_usd=result.total_cost_usd,
    )


def _model_version(result: ResultMessage, requested: str | None) -> str | None:
    """The CLI also makes small side calls on another model; report the one that answered."""
    used = list(result.model_usage or {})
    return next(
        (m for m in used if requested and m.startswith(requested)), used[-1] if used else None
    )


def _tokens(usage: dict[str, object], *keys: str) -> int | None:
    counts = [v for k in keys if isinstance(v := usage.get(k), int)]
    return sum(counts) if counts else None
