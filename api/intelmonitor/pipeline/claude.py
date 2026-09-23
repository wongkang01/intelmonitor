"""Claude through the Claude Agent SDK, on the user's Claude login, with structured JSON output."""

import os

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query
from pydantic import BaseModel

from intelmonitor.config import get_settings


def _scrub_parent_env() -> None:
    """Keep the SDK's CLI subprocess from inheriting a parent Claude Code session or an empty
    API key, either of which stops it from running on the user's Claude login."""
    for key in list(os.environ):
        if key == "CLAUDECODE" or key.startswith("CLAUDE_CODE_"):
            del os.environ[key]
    if not os.environ.get("ANTHROPIC_API_KEY"):
        os.environ.pop("ANTHROPIC_API_KEY", None)


async def ask_claude[T: BaseModel](prompt: str, schema: type[T], system: str | None = None) -> T:
    """Run one tool-free Claude turn and validate its structured output against `schema`."""
    _scrub_parent_env()
    options = ClaudeAgentOptions(
        model=get_settings().anthropic_model,
        system_prompt=system,
        tools=[],
        setting_sources=[],
        output_format={"type": "json_schema", "schema": schema.model_json_schema()},
    )
    result: ResultMessage | None = None
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, ResultMessage):
            result = message
    if result is None or result.is_error or result.structured_output is None:
        detail = result.result if result else "no result message"
        raise RuntimeError(f"Claude returned no structured output: {detail}")
    return schema.model_validate(result.structured_output)
