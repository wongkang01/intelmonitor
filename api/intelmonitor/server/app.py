"""FastAPI app. Run with `uv run im serve` (behind Portless in development)."""

from fastapi import FastAPI

app = FastAPI(title="IntelMonitor API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
