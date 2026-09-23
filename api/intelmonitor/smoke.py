"""Connectivity check for the two model paths: Jev via OpenRouter and Claude via the Agent SDK."""

import json

from pydantic import BaseModel
from typesafe_sdk import Choice, Noul

from intelmonitor.pipeline.claude import ask_claude
from intelmonitor.pipeline.jev import ask_jev

SAMPLE = (
    "The Monetary Authority of Singapore imposed a composition penalty of S$2.4 million on a "
    "local bank for breaches of anti-money laundering requirements."
)


class SmokeFinding(BaseModel):
    statement: str
    subjects: list[str]
    category: str


async def run_smoke() -> None:
    jev = await ask_jev(
        SAMPLE,
        {
            "relevant": Noul(instructions="Is this relevant to banking regulation?"),
            "category": Choice(
                instructions="What kind of item is this?",
                criteria={
                    "enforcement": "A penalty or supervisory action",
                    "policy": "A new rule or consultation",
                    "market": "Market or price movement",
                },
            ),
        },
    )
    print("Jev:", jev.model, json.dumps({k: a.model_dump() for k, a in jev.answers.items()}))
    print("Jev usage:", jev.usage.model_dump())

    claude = await ask_claude(
        f"Extract one finding from this text:\n\n{SAMPLE}",
        SmokeFinding,
        system="You extract findings for a financial supervisor's monitoring dashboard.",
    )
    print("Claude:", claude.model_dump_json())
