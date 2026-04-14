"""
kpi_calculator.py — KPI Calculator

Pull model: calculated on-demand when dashboard loads. Never pre-scheduled.

For each adopted control assigned to an application:
  1. Find linked ControlMetricDefinition rows
  2. Pull latest MetricReading from TimescaleDB hypertable
  3. Evaluate threshold → PASS / FAIL / INSUFFICIENT_DATA
  4. Write CalculatedMetric row
  5. If is_manual=True → create ControlCalculationProposal (PENDING)

Threshold JSON schema (stored in control_metric_definition.threshold):
  { "operator": "lte" | "gte" | "lt" | "gt" | "eq", "value": <float> }
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import (
    CalculatedMetric,
    ControlAssignment,
    ControlCalculationProposal,
    ControlMetricDefinition,
    MetricReading,
)

logger = logging.getLogger(__name__)

PASS              = "PASS"
FAIL              = "FAIL"
INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
DELTA_PERIOD_PATTERN = re.compile(r"^\s*(\d+)\s*([hd])\s*$", re.IGNORECASE)
FORMULA_MAX0_MINUS_PATTERN = re.compile(
    r"max\(\s*0\s*,\s*100\s*-\s*([a-zA-Z0-9_.]+)\s*\)",
    re.IGNORECASE,
)
FORMULA_DIVIDE_PATTERN = re.compile(
    r"^\s*([a-zA-Z0-9_.]+)\s*/\s*([0-9]+(?:\.[0-9]+)?)\s*$",
    re.IGNORECASE,
)

PROXY_METRIC_RULES: dict[str, list[dict[str, str]]] = {
    # Secretariat telemetry aliases/proxies resolved from metrics already emitted by connected apps.
    "ai.robustness.drift_score": [
        {"source_metric": "ai.core.drift_score", "transform": "identity"},
    ],
    "ai.disclosure.consumer_rate": [
        {"source_metric": "ai.transparency.disclosure_rate", "transform": "to_percent"},
        {"source_metric": "ai.rag.citation_coverage", "transform": "to_percent"},
    ],
    "ai.incident.detection_rate": [
        {"source_metric": "ai.core.error_rate", "transform": "inverse_percent"},
    ],
    "ai.data.dlp_incident_rate": [
        {"source_metric": "ai.core.error_rate", "transform": "to_percent"},
    ],
    "ai.fairness.demographic_parity": [
        {"source_metric": "ai.oversight.feedback_positive_rate", "transform": "to_percent"},
    ],
    "ai.fairness.equal_opportunity": [
        {"source_metric": "ai.oversight.feedback_positive_rate", "transform": "to_percent"},
    ],
    "ai.security.pentest_age": [
        {"source_metric": "ai.security.pentest_age_days", "transform": "identity"},
        {"source_metric": "ai.incident.detection_rate", "transform": "inverse_percent"},
        {"source_metric": "ai.core.error_rate", "transform": "to_percent"},
    ],
}


# ---------------------------------------------------------------------------
# Threshold evaluation
# ---------------------------------------------------------------------------

def _evaluate_threshold(value: float, threshold: dict) -> str:
    """
    Evaluate a metric value against a threshold definition.

    Handles two formats:

    Simple format:
      {"operator": "lte", "value": 0.05}

    Rich format (seeded data):
      {"compliant": ">=90", "warning": ">=75", "breach": "<75",
       "direction": "higher_better", "unit": "%"}

    Returns PASS or FAIL.
    """
    if not threshold:
        return FAIL

    # --- Detect format ---
    if "operator" in threshold and "value" in threshold:
        # Simple format
        operator      = threshold["operator"]
        target: float = float(threshold["value"])
        ops = {
            "lte": value <= target,
            "gte": value >= target,
            "lt":  value <  target,
            "gt":  value >  target,
            "eq":  abs(value - target) < 1e-9,
        }
        result = ops.get(operator)
        if result is None:
            logger.warning(f"Unknown threshold operator: {operator} — defaulting to FAIL")
            return FAIL
        return PASS if result else FAIL

    if "compliant" in threshold:
        # Rich format — parse the compliant boundary string
        compliant_str = str(threshold["compliant"]).strip()
        try:
            if compliant_str.startswith(">="):
                return PASS if value >= float(compliant_str[2:]) else FAIL
            elif compliant_str.startswith("<="):
                return PASS if value <= float(compliant_str[2:]) else FAIL
            elif compliant_str.startswith(">"):
                return PASS if value >  float(compliant_str[1:]) else FAIL
            elif compliant_str.startswith("<"):
                return PASS if value <  float(compliant_str[1:]) else FAIL
            elif compliant_str.startswith("="):
                return PASS if abs(value - float(compliant_str[1:])) < 1e-9 else FAIL
            else:
                # Plain number — treat as exact match
                return PASS if abs(value - float(compliant_str)) < 1e-9 else FAIL
        except (ValueError, TypeError) as e:
            logger.warning(f"Could not parse compliant threshold '{compliant_str}': {e}")
            return FAIL

    logger.warning(f"Unrecognised threshold format: {threshold} — defaulting to FAIL")
    return FAIL


def _parse_delta_period(period_raw: Optional[str]) -> Optional[timedelta]:
    if not period_raw:
        return None
    period = str(period_raw).strip().lower()
    if period in {"realtime", "latest"}:
        return timedelta(seconds=0)
    match = DELTA_PERIOD_PATTERN.match(period)
    if not match:
        return None
    value = int(match.group(1))
    unit = match.group(2).lower()
    if unit == "h":
        return timedelta(hours=value)
    return timedelta(days=value)


def _is_stale_timestamp(collected_at: Optional[datetime], threshold: dict) -> bool:
    if collected_at is None:
        return True
    max_age = _parse_delta_period((threshold or {}).get("delta_period"))
    if max_age is None:
        return False
    if collected_at.tzinfo is not None:
        now = datetime.now(timezone.utc)
    else:
        now = datetime.utcnow()
    return collected_at < (now - max_age)


def _to_percent_points(value: float) -> float:
    # Metric streams may store percentages as either ratio (0-1) or points (0-100).
    return value * 100.0 if abs(value) <= 1.0 else value


def _apply_proxy_transform(value: float, transform: str) -> Optional[float]:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    transform_key = (transform or "identity").strip().lower()
    if transform_key == "identity":
        return numeric
    if transform_key == "to_percent":
        return _to_percent_points(numeric)
    if transform_key == "inverse_percent":
        return max(0.0, 100.0 - _to_percent_points(numeric))
    return None


# ---------------------------------------------------------------------------
# Main calculator
# ---------------------------------------------------------------------------

class KPICalculator:

    PASS              = PASS
    FAIL              = FAIL
    INSUFFICIENT_DATA = INSUFFICIENT_DATA

    async def calculate_for_application(
        self,
        app_id: str,
        db:     AsyncSession,
        scoped_control_ids: set[str] | None = None,
    ) -> list[dict]:
        """
        Calculate KPIs for all adopted controls assigned to the application.

        Returns list of:
          {
            control_id, metric_name, result,
            value, threshold, evidence_ts, is_manual
          }
        """
        # 1. Load adopted control assignments
        assignments_result = await db.execute(
            select(ControlAssignment)
            .where(
                ControlAssignment.application_id == app_id,
                ControlAssignment.status == "adopted",
            )
        )
        assignments = assignments_result.scalars().all()

        if not assignments:
            logger.info(f"No adopted controls for application {app_id}")
            return []

        control_ids = [a.control_id for a in assignments]
        if scoped_control_ids:
            control_ids = [cid for cid in control_ids if str(cid) in scoped_control_ids]
            if not control_ids:
                logger.info(f"No adopted controls in active scope for application {app_id}")
                return []

        # 2. Load all metric definitions for these controls
        defs_result = await db.execute(
            select(ControlMetricDefinition)
            .where(ControlMetricDefinition.control_id.in_(control_ids))
        )
        metric_defs = defs_result.scalars().all()

        batch_calculated_at = datetime.utcnow()
        results = []

        for mdef in metric_defs:
            result_entry = await self._calculate_single(
                app_id=app_id,
                mdef=mdef,
                calculated_at=batch_calculated_at,
                db=db,
            )
            results.append(result_entry)

        return results

    async def _calculate_single(
        self,
        app_id: str,
        mdef:   ControlMetricDefinition,
        calculated_at: datetime,
        db:     AsyncSession,
    ) -> dict:
        """Calculate KPI for a single ControlMetricDefinition."""

        threshold_obj = mdef.threshold or {}

        # 3. Pull latest MetricReading for this app + metric_name
        reading_query = (
            select(MetricReading)
            .where(
                MetricReading.application_id == app_id,
                MetricReading.metric_name    == mdef.metric_name,
            )
        )
        # Manual KPI updates are scoped per control via metric_reading.attributes.control_id.
        # This prevents one manual toggle from affecting every control sharing the metric name.
        if mdef.is_manual:
            reading_query = reading_query.where(
                func.json_extract_path_text(MetricReading.attributes, "control_id") == str(mdef.control_id)
            )
        reading_result = await db.execute(
            reading_query
            .order_by(desc(MetricReading.collected_at))
            .limit(1)
        )
        latest_reading: Optional[MetricReading] = reading_result.scalar_one_or_none()
        stale_reading: Optional[MetricReading] = None
        reading = latest_reading
        if (not mdef.is_manual) and reading is not None and _is_stale_timestamp(reading.collected_at, threshold_obj):
            stale_reading = reading
            reading = None

        # 4. Evaluate threshold
        if reading is None:
            if mdef.is_manual:
                # Manual KPIs are explicitly user-attested; do not auto-fill from
                # derived/proxy telemetry when no manual value has been set yet.
                kpi_result = INSUFFICIENT_DATA
                value = None
                evidence_ts = None
            else:
                derived_value = await self._evaluate_derived_formula(
                    app_id=app_id,
                    threshold=threshold_obj,
                    db=db,
                )
                if derived_value is None:
                    stale_derived_value = await self._evaluate_derived_formula(
                        app_id=app_id,
                        threshold=threshold_obj,
                        db=db,
                        allow_stale=True,
                    )
                    if stale_derived_value is not None:
                        value = stale_derived_value
                        evidence_ts = None
                        kpi_result = _evaluate_threshold(value, threshold_obj)
                    elif stale_reading is not None:
                        # Dashboard fallback for demo/runtime continuity:
                        # keep showing latest observed value even if stale.
                        value = stale_reading.value
                        evidence_ts = stale_reading.collected_at
                        kpi_result = _evaluate_threshold(value, threshold_obj)
                    else:
                        proxy_value = await self._resolve_proxy_metric_value(
                            app_id=app_id,
                            metric_name=mdef.metric_name,
                            threshold=threshold_obj,
                            db=db,
                        )
                        if proxy_value is not None:
                            value = proxy_value
                            evidence_ts = None
                            kpi_result = _evaluate_threshold(value, threshold_obj)
                        else:
                            kpi_result = INSUFFICIENT_DATA
                            value = None
                            evidence_ts = None
                else:
                    value = derived_value
                    evidence_ts = None
                    kpi_result = _evaluate_threshold(value, threshold_obj)
        else:
            value       = reading.value
            evidence_ts = reading.collected_at
            if mdef.is_manual:
                # Manual controls - reading exists but needs human confirmation
                kpi_result = INSUFFICIENT_DATA
            else:
                kpi_result = _evaluate_threshold(value, threshold_obj)

        # 5. Write CalculatedMetric row
        calculated = CalculatedMetric(
            id             = str(uuid4()),
            application_id = app_id,
            control_id     = mdef.control_id,
            metric_name    = mdef.metric_name,
            result         = kpi_result,
            value          = value,
            calculated_at  = calculated_at,
        )
        db.add(calculated)

        # 6. Create ControlCalculationProposal for manual controls
        if mdef.is_manual and value is not None:
            proposal = ControlCalculationProposal(
                id             = str(uuid4()),
                control_id     = mdef.control_id,
                application_id = app_id,
                proposed_value = {
                    "metric_name": mdef.metric_name,
                    "value":       value,
                    "threshold":   mdef.threshold,
                    "evidence_ts": evidence_ts.isoformat() if evidence_ts else None,
                },
                status     = "PENDING",
                created_at = datetime.utcnow(),
            )
            db.add(proposal)

        await db.flush()

        return {
            "control_id":   mdef.control_id,
            "metric_name":  mdef.metric_name,
            "result":       kpi_result,
            "value":        value,
            "threshold":    mdef.threshold,
            "evidence_ts":  evidence_ts.isoformat() if evidence_ts else None,
            "is_manual":    mdef.is_manual,
        }

    async def _evaluate_derived_formula(
        self,
        app_id: str,
        threshold: dict,
        db: AsyncSession,
        allow_stale: bool = False,
    ) -> Optional[float]:
        calc_type = str((threshold or {}).get("calculation_type", "") or "").lower()
        source_system = str((threshold or {}).get("source_system", "") or "").lower()
        formula = str((threshold or {}).get("formula", "") or "")
        if calc_type != "derived" and source_system != "calculated":
            return None
        if not formula:
            return None

        max0_match = FORMULA_MAX0_MINUS_PATTERN.match(formula)
        if max0_match:
            metric_name = max0_match.group(1)
            base_value = await self._latest_metric_value(
                app_id, metric_name, threshold, db, allow_stale=allow_stale
            )
            if base_value is None:
                return None
            return max(0.0, 100.0 - _to_percent_points(base_value))

        divide_match = FORMULA_DIVIDE_PATTERN.match(formula)
        if divide_match:
            metric_name = divide_match.group(1)
            divisor = float(divide_match.group(2))
            if abs(divisor) < 1e-12:
                return None
            base_value = await self._latest_metric_value(
                app_id, metric_name, threshold, db, allow_stale=allow_stale
            )
            if base_value is None:
                return None
            return float(base_value) / divisor

        return None

    async def _latest_metric_value(
        self,
        app_id: str,
        metric_name: str,
        threshold: dict,
        db: AsyncSession,
        allow_stale: bool = False,
    ) -> Optional[float]:
        reading_result = await db.execute(
            select(MetricReading)
            .where(
                MetricReading.application_id == app_id,
                MetricReading.metric_name == metric_name,
            )
            .order_by(desc(MetricReading.collected_at))
            .limit(1)
        )
        reading = reading_result.scalar_one_or_none()
        if reading is None:
            return None
        if (not allow_stale) and _is_stale_timestamp(reading.collected_at, threshold):
            return None
        return float(reading.value)

    async def _resolve_proxy_metric_value(
        self,
        *,
        app_id: str,
        metric_name: str,
        threshold: dict,
        db: AsyncSession,
    ) -> Optional[float]:
        rules = PROXY_METRIC_RULES.get(metric_name, [])
        for rule in rules:
            source_metric = str(rule.get("source_metric") or "").strip()
            if not source_metric:
                continue
            source_value = await self._latest_metric_value(
                app_id=app_id,
                metric_name=source_metric,
                threshold=threshold,
                db=db,
                allow_stale=True,
            )
            if source_value is None:
                continue
            transformed = _apply_proxy_transform(
                source_value,
                str(rule.get("transform") or "identity"),
            )
            if transformed is None:
                continue
            return transformed
        return None

    def _evaluate_metric(self, metric_name: str, value: float, threshold: dict) -> str:
        """Public wrapper — kept for interface compatibility with stub."""
        return _evaluate_threshold(value, threshold)
