"""Production wrapper for the static Serving Layer Planner."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

APP_NAME = "serving-layer-planner"
APP_VERSION = "1.1.0"
STATIC_ROOT = Path(__file__).resolve().parent

app = FastAPI(
    title="Databricks Serving Layer Planner",
    version=APP_VERSION,
    docs_url=None,
    redoc_url=None,
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    """Return a lightweight readiness response."""
    return {
        "app": APP_NAME,
        "status": "healthy",
        "version": APP_VERSION,
    }


# Mount last so API routes take precedence while all existing static paths remain intact.
app.mount("/", StaticFiles(directory=STATIC_ROOT, html=True), name="static")
