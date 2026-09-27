"""`im` command line: uv run im <command>."""

import asyncio
import os
from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=True, add_completion=False)
series_app = typer.Typer(no_args_is_help=True, help="Fetch measured series (api/seed/series.yaml).")
app.add_typer(series_app, name="series")


@app.command()
def ingest(
    stats: Annotated[bool, typer.Option("--stats", help="Only print corpus stats")] = False,
    t0: Annotated[
        str | None, typer.Option("--t0", help="Override the stored T0, YYYY-MM-DD")
    ] = None,
) -> None:
    """Fetch the measured series, then fetch, cache, parse and dedup the 60-day corpus and print
    its stats."""
    from datetime import date

    from intelmonitor.ingest.run import run_ingest
    from intelmonitor.ingest.series.collect import fetch_series
    from intelmonitor.ingest.stats import ingest_stats
    from intelmonitor.store.db import connect

    if not stats:
        fetch_series(connect(), date.today(), log=typer.echo)
        typer.echo("")
        result = run_ingest(date.fromisoformat(t0) if t0 else None)
        typer.echo(
            f"added {sum(result.added.values())} {dict(result.added)}, "
            f"{result.duplicates} duplicates, {len(result.failures)} failures\n"
        )
    typer.echo(ingest_stats(connect()))


@series_app.command("fetch")
def series_fetch() -> None:
    """Fetch every series up to today; cached responses make reruns within a day free."""
    from datetime import date

    from intelmonitor.ingest.series.collect import fetch_series
    from intelmonitor.store.db import connect

    fetch_series(connect(), date.today(), log=typer.echo)


@series_app.command("backfill")
def series_backfill(
    from_: Annotated[
        str, typer.Option("--from", help="Earliest period to keep, YYYY-MM-DD")
    ] = "2021-07-01",
) -> None:
    """Fetch every series' history from --from to today, and keep that floor for later fetches."""
    from datetime import date

    from intelmonitor.ingest.series.collect import fetch_series
    from intelmonitor.store.db import connect

    fetch_series(connect(), date.today(), backfill_from=date.fromisoformat(from_), log=typer.echo)


@app.command()
def run(
    as_of: Annotated[str | None, typer.Option("--as-of", help="Run date, YYYY-MM-DD")] = None,
    both: Annotated[bool, typer.Option("--both", help="Compute Run 1 and Run 2")] = False,
) -> None:
    """Compute one pipeline run, or both (Run 1 as of T0 - 7 days, then Run 2 as of T0)."""
    from datetime import date

    from intelmonitor.pipeline.run import compute_run, run_dates
    from intelmonitor.store.db import connect

    if both == (as_of is not None):
        raise typer.BadParameter("pass either --as-of <date> or --both")
    dates = list(run_dates(connect())) if both else [date.fromisoformat(str(as_of))]
    for d in dates:
        asyncio.run(compute_run(d, lambda line: typer.echo(line)))


@app.command()
def report() -> None:
    """Write the pipeline report to artifacts/pipeline/<timestamp>/report.md."""
    from intelmonitor.pipeline.report import write_report

    typer.echo(write_report())


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
def openapi(
    out: Annotated[str, typer.Argument(help="Where to write the OpenAPI JSON schema")],
) -> None:
    """Write the API's OpenAPI schema, the source for the web client's generated types."""
    import json
    from pathlib import Path

    from intelmonitor.server.app import app as api

    Path(out).write_text(json.dumps(api.openapi(), indent=2) + "\n")


@app.command()
def smoke() -> None:
    """Make one Jev call and one Claude Agent SDK call and print both structured answers."""
    from intelmonitor.smoke import run_smoke

    asyncio.run(run_smoke())
