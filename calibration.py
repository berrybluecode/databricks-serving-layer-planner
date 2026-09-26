"""Observed-workload calibration from Databricks system tables.

SQL warehouses are billed per warehouse, not per query. Each day's warehouse DBUs
are allocated to the statements that ran on it in proportion to their
``total_task_duration_ms``, so a consumer sharing a warehouse with ETL is only
charged for its own compute share.
"""

from __future__ import annotations

import os
import time
from functools import lru_cache
from typing import Any

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementParameterListItem, StatementState

KINDS = {"app", "dashboard", "genie"}
CACHE_SECONDS = 900
_cache: dict[tuple, tuple[float, Any]] = {}

_ATTRIBUTED = """
WITH q AS (
  SELECT
    compute.warehouse_id AS wh,
    date(start_time) AS d,
    CASE
      WHEN query_source.dashboard_id IS NOT NULL THEN 'dashboard'
      WHEN query_source.genie_space_id IS NOT NULL THEN 'genie'
      WHEN executed_as RLIKE '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-' THEN 'app'
      ELSE 'other'
    END AS kind,
    coalesce(query_source.dashboard_id, query_source.genie_space_id, executed_as) AS source_id,
    coalesce(total_task_duration_ms, 0) AS task_ms,
    coalesce(read_bytes, 0) AS read_bytes,
    coalesce(total_duration_ms, 0) AS duration_ms,
    coalesce(from_result_cache, false) AS cached,
    executed_by
  FROM system.query.history
  WHERE workspace_id = :workspace_id
    AND start_time >= dateadd(DAY, -:days, current_timestamp())
    AND compute.warehouse_id IS NOT NULL
),
warehouse_task AS (
  SELECT wh, d, sum(task_ms) AS wh_task FROM q GROUP BY wh, d
),
warehouse_dbu AS (
  SELECT usage_metadata.warehouse_id AS wh, usage_date AS d, sum(usage_quantity) AS wh_dbu
  FROM system.billing.usage
  WHERE workspace_id = :workspace_id
    AND billing_origin_product = 'SQL'
    AND usage_unit = 'DBU'
    AND usage_date >= date_sub(current_date(), :days)
  GROUP BY 1, 2
),
attributed AS (
  SELECT
    q.*,
    coalesce(warehouse_dbu.wh_dbu, 0)
      * CASE WHEN warehouse_task.wh_task > 0 THEN q.task_ms / warehouse_task.wh_task ELSE 0 END
      AS dbu
  FROM q
  JOIN warehouse_task USING (wh, d)
  LEFT JOIN warehouse_dbu USING (wh, d)
)
{select}
"""

_SOURCES = _ATTRIBUTED.format(select="""
SELECT kind, source_id, count(*) AS queries, sum(dbu) AS dbu, count(DISTINCT d) AS active_days
FROM attributed
WHERE kind = :kind
GROUP BY kind, source_id
HAVING count(*) >= 5
ORDER BY dbu DESC
LIMIT 50
""")

_OBSERVE = _ATTRIBUTED.format(select="""
, source AS (SELECT * FROM attributed WHERE kind = :kind AND source_id = :source_id),
daily AS (
  SELECT d, count(*) AS n, sum(dbu) AS dbu FROM source GROUP BY d
)
SELECT
  (SELECT count(*) FROM source) AS queries,
  (SELECT sum(dbu) FROM source) AS dbu,
  (SELECT sum(read_bytes) FROM source) / greatest((SELECT count(*) FROM source), 1) / 1e9
    AS gb_per_query,
  (SELECT percentile_approx(duration_ms, 0.95) FROM source) / 1000 AS p95_runtime_s,
  (SELECT avg(CASE WHEN cached THEN 1 ELSE 0 END) FROM source) AS cache_hit_share,
  (SELECT count(DISTINCT executed_by) FROM source) AS distinct_identities,
  (SELECT count(*) FROM daily) AS active_days,
  (SELECT percentile_approx(dbu / n * 1000, 0.1) FROM daily) AS p10_dbu_per_1k,
  (SELECT percentile_approx(dbu / n * 1000, 0.9) FROM daily) AS p90_dbu_per_1k
""")

_APP_RUNTIME = """
SELECT usage_metadata.app_id AS app_id, usage_metadata.app_name AS app_name,
  sum(usage_quantity) AS dbu, count(DISTINCT usage_date) AS days
FROM system.billing.usage
WHERE workspace_id = :workspace_id
  AND billing_origin_product = 'APPS'
  AND usage_date >= date_sub(current_date(), :days)
GROUP BY 1, 2
"""


@lru_cache(maxsize=1)
def _client() -> WorkspaceClient:
    return WorkspaceClient()


def _warehouse_id() -> str:
    warehouse_id = os.environ.get("DATABRICKS_WAREHOUSE_ID")
    if not warehouse_id:
        raise RuntimeError("DATABRICKS_WAREHOUSE_ID is not configured for this app.")
    return warehouse_id


@lru_cache(maxsize=1)
def _workspace_id() -> str:
    return str(_client().get_workspace_id())


def _query(sql: str, **params: Any) -> list[dict[str, Any]]:
    key = (sql, tuple(sorted(params.items())))
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
        return cached[1]
    rows = _execute(sql, **params)
    _cache[key] = (time.monotonic(), rows)
    return rows


def _execute(sql: str, **params: Any) -> list[dict[str, Any]]:
    response = _client().statement_execution.execute_statement(
        warehouse_id=_warehouse_id(),
        statement=sql,
        parameters=[
            StatementParameterListItem(
                name=name, value=str(value), type="INT" if isinstance(value, int) else None
            )
            for name, value in {"workspace_id": _workspace_id(), **params}.items()
        ],
        wait_timeout="50s",
    )
    state = response.status.state if response.status else None
    if state != StatementState.SUCCEEDED:
        message = response.status.error.message if response.status and response.status.error else state
        raise RuntimeError(f"Calibration query failed: {message}")
    columns = [column.name for column in response.manifest.schema.columns]
    rows = response.result.data_array if response.result and response.result.data_array else []
    return [dict(zip(columns, row)) for row in rows]


def _num(value: Any) -> float:
    return float(value) if value not in (None, "") else 0.0


def _app_runtime(days: int) -> dict[str, dict[str, Any]]:
    return {row["app_id"]: row for row in _query(_APP_RUNTIME, days=days) if row["app_id"]}


def _names(kind: str, source_ids: list[str], days: int) -> dict[str, str]:
    if kind == "app":
        return {app_id: row["app_name"] for app_id, row in _app_runtime(days).items()}
    names: dict[str, str] = {}
    for source_id in source_ids:
        try:
            if kind == "dashboard":
                names[source_id] = _client().lakeview.get(source_id).display_name
            elif kind == "genie":
                names[source_id] = _client().genie.get_space(source_id).title
        except Exception:
            continue
    return names


def list_sources(kind: str, days: int) -> list[dict[str, Any]]:
    """Return observed consumers of one kind, most expensive first."""
    rows = _query(_SOURCES, kind=kind, days=days)
    names = _names(kind, [row["source_id"] for row in rows], days)
    return [
        {
            "source_id": row["source_id"],
            "label": names.get(row["source_id"], row["source_id"]),
            "queries": int(_num(row["queries"])),
            "dbu": round(_num(row["dbu"]), 2),
            "active_days": int(_num(row["active_days"])),
        }
        for row in rows
    ]


def observe(kind: str, source_id: str, days: int) -> dict[str, Any]:
    """Return the observed SQL rate and shape for one consumer."""
    row = _query(_OBSERVE, kind=kind, source_id=source_id, days=days)[0]
    queries = int(_num(row["queries"]))
    dbu = _num(row["dbu"])
    result: dict[str, Any] = {
        "kind": kind,
        "source_id": source_id,
        "label": _names(kind, [source_id], days).get(source_id, source_id),
        "days": days,
        "queries": queries,
        "sql_dbu": round(dbu, 3),
        "dbu_per_1k": round(dbu / queries * 1000, 3) if queries else 0.0,
        "p10_dbu_per_1k": round(_num(row["p10_dbu_per_1k"]), 3),
        "p90_dbu_per_1k": round(_num(row["p90_dbu_per_1k"]), 3),
        "gb_per_query": round(_num(row["gb_per_query"]), 4),
        "p95_runtime_s": round(_num(row["p95_runtime_s"]), 2),
        "cache_hit_share": round(_num(row["cache_hit_share"]), 3),
        "distinct_identities": int(_num(row["distinct_identities"])),
        "active_days": int(_num(row["active_days"])),
        "queries_per_day": round(queries / max(int(_num(row["active_days"])), 1), 1),
    }
    if kind == "app":
        runtime = _app_runtime(days).get(source_id)
        if runtime:
            result["app_dbu_per_day"] = round(_num(runtime["dbu"]) / max(int(_num(runtime["days"])), 1), 2)
    return result
