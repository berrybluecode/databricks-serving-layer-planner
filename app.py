"""Production wrapper for the Serving Layer Planner."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

import calibration

APP_NAME = "serving-layer-planner"
APP_VERSION = "1.4.0"
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


def _validate_kind(kind: str) -> str:
    if kind not in calibration.KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {sorted(calibration.KINDS)}")
    return kind


@app.get("/api/pricing")
def pricing() -> dict:
    """Return current SQL and Genie (SRTI) list prices from system.billing.list_prices."""
    try:
        return calibration.list_prices()
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/calibration/sources")
def calibration_sources(kind: str, days: int = Query(30, ge=1, le=90)) -> dict:
    """List observed workloads that can calibrate a forecast."""
    try:
        return {"sources": calibration.list_sources(_validate_kind(kind), days)}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/calibration/observe")
def calibration_observe(kind: str, source_id: str, days: int = Query(30, ge=1, le=90)) -> dict:
    """Return observed SQL rate, volume, and variability for one workload."""
    try:
        return calibration.observe(_validate_kind(kind), source_id, days)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


# Mount last so API routes take precedence while all existing static paths remain intact.
app.mount("/", StaticFiles(directory=STATIC_ROOT, html=True), name="static")
