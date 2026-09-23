"""`im` command line: uv run im <command>."""

import asyncio
import os
from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=True, add_completion=False)


@app.command()
def ingest(
    stats: Annotated[bool, typer.Option("--stats", help="Only print corpus stats")] = False,
    t0: Annotated[
        str | None, typer.Option("--t0", help="Override the stored T0, YYYY-MM-DD")
    ] = None,
) -> None:
    """Fetch, cache, parse and dedup the 60-day corpus, then print its stats."""
    from datetime import date

    from intelmonitor.ingest.run import run_ingest
    from intelmonitor.ingest.stats import ingest_stats
    from intelmonitor.store.db import connect

    if not stats:
        result = run_ingest(date.fromisoformat(t0) if t0 else None)
        typer.echo(
            f"added {sum(result.added.values())} {dict(result.added)}, "
            f"{result.duplicates} duplicates, {len(result.failures)} failures\n"
        )
    typer.echo(ingest_stats(connect()))


@app.command()
def run(
    as_of: Annotated[str | None, typer.Option("--as-of", help="Run date, YYYY-MM-DD")] = None,
    both: Annotated[bool, typer.Option("--both", help="Compute Run 1 and Run 2")] = False,
) -> None:
    """Compute one pipeline run, or both."""
    typer.echo(f"run: not implemented yet (phase 2) as_of={as_of} both={both}")


@app.command()
def report() -> None:
    """Write the pipeline report to artifacts/pipeline/<timestamp>/report.md."""
    typer.echo("report: not implemented yet (phase 2)")


@app.command()
def serve(
    reload: Annotated[bool, typer.Option(help="Reload on code changes")] = True,
) -> None:
    """Serve the API on $PORT (set by Portless)."""
    import uvicorn

    uvicorn.run(
        "intelmonitor.server.app:app",
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "8000")),
        reload=reload,
    )


@app.command()
def smoke() -> None:
    """Make one Jev call and one Claude Agent SDK call and print both structured answers."""
    from intelmonitor.smoke import run_smoke

    asyncio.run(run_smoke())
