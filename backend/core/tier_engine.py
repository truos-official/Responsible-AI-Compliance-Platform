"""
tier_engine.py - Risk Category Engine

Risk model structure:
  Context profile: deployment domain, decision impact, autonomy, affected scope
  Telemetry profile: weighted baseline KPI risk scores across governance categories

Score model:
  risk_score = (context_profile * 0.35) + (telemetry_profile * 0.65)
  where telemetry_profile = sum(kpi_risk_i * kpi_weight_i)
  and all kpi_weight_i sum to 1.0 (100%)

Category thresholds:
  Critical >= 80
  High     >= 62
  Medium   >= 38
  Low      < 38

Floor rules:
  - Domain floor: high-risk domains (biometric/surveillance/defense/etc.) => minimum High
  - Autonomy validation floor: human_in_the_loop with very low observed override_rate => minimum High
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Application, TierChangeEvent, MetricReading, RiskKpiWeightConfig


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CONTEXT_COMPONENT_WEIGHT = 0.35
TELEMETRY_COMPONENT_WEIGHT = 0.65
AUTONOMY_OVERRIDE_THRESHOLD = 0.001  # 0.1%

HIGH_RISK_FLOOR_DOMAINS = {
    "asylum",
    "criminal_justice",
    "medical_diagnosis",
    "biometric_id",
    "human_surveillance",
    "defense",
}

CONTEXT_DIMENSION_WEIGHTS: dict[str, float] = {
    "deployment_domain": 0.34,
    "decision_type": 0.24,
    "autonomy_level": 0.18,
    "population_breadth": 0.12,
    "affected_populations": 0.12,
}

DEPLOYMENT_DOMAIN_SCORES: dict[str, int] = {
    "asylum": 100,
    "criminal_justice": 100,
    "medical_diagnosis": 95,
    "biometric_id": 100,
    "human_surveillance": 100,
    "defense": 100,
    "healthcare": 85,
    "financial": 75,
    "hr": 65,
    "education": 55,
    "internal_ops": 35,
    "other": 45,
}

DECISION_TYPE_SCORES: dict[str, int] = {
    "binding": 92,
    "advisory": 55,
    "informational": 25,
}

AUTONOMY_LEVEL_SCORES: dict[str, int] = {
    "human_out_of_loop": 100,
    "human_on_loop": 72,
    "human_in_the_loop": 38,
}

POPULATION_BREADTH_SCORES: dict[str, int] = {
    "global": 100,
    "national": 78,
    "regional": 55,
    "local": 32,
}

AFFECTED_POPULATIONS_SCORES: dict[str, int] = {
    "vulnerable": 100,
    "mixed": 68,
    "general": 35,
}

RISK_KPI_CATALOG: list[dict[str, Any]] = [
    {
        "metric_name": "ai.oversight.override_rate",
        "label": "Human override rate",
        "governance_category": "Risk & Compliance",
        "operator": "gte",
        "target": 0.05,
        "weight": 0.09,
        "description": "Lower human intervention than target can indicate under-governed autonomy.",
    },
    {
        "metric_name": "ai.transparency.disclosure_rate",
        "label": "AI disclosure rate",
        "governance_category": "Risk & Compliance",
        "operator": "gte",
        "target": 90.0,
        "weight": 0.07,
        "description": "Measures how consistently users are informed when AI is involved.",
    },
    {
        "metric_name": "ai.transparency.doc_completeness",
        "label": "Documentation completeness",
        "governance_category": "Risk & Compliance",
        "operator": "gte",
        "target": 85.0,
        "weight": 0.07,
        "description": "Tracks governance evidence quality and policy traceability.",
    },
    {
        "metric_name": "ai.rag.citation_coverage",
        "label": "Citation coverage",
        "governance_category": "Technical Architecture",
        "operator": "gte",
        "target": 0.85,
        "weight": 0.06,
        "description": "Higher citation grounding lowers architecture-level reliability risk.",
    },
    {
        "metric_name": "ai.rag.retrieval_latency_p95",
        "label": "Retrieval latency p95",
        "governance_category": "Technical Architecture",
        "operator": "lte",
        "target": 500.0,
        "weight": 0.05,
        "description": "Higher retrieval latency increases architecture fragility risk.",
    },
    {
        "metric_name": "ai.model.accuracy",
        "label": "Model accuracy",
        "governance_category": "Technical Architecture",
        "operator": "gte",
        "target": 90.0,
        "weight": 0.07,
        "description": "Lower quality performance raises technical decision risk.",
    },
    {
        "metric_name": "ai.data.quality_score",
        "label": "Data quality score",
        "governance_category": "Data Readiness",
        "operator": "gte",
        "target": 0.85,
        "weight": 0.07,
        "description": "Poor data quality increases downstream model and policy risk.",
    },
    {
        "metric_name": "ai.data.bias_score",
        "label": "Bias score",
        "governance_category": "Data Readiness",
        "operator": "lte",
        "target": 0.10,
        "weight": 0.08,
        "description": "Higher disparity signals fairness and discrimination exposure.",
    },
    {
        "metric_name": "ai.resources.active_users",
        "label": "Active user load",
        "governance_category": "Data Integration",
        "operator": "gte",
        "target": 5.0,
        "weight": 0.04,
        "description": "Very low active usage can indicate weak integration or telemetry confidence.",
    },
    {
        "metric_name": "ai.model.hallucination_rate",
        "label": "Hallucination rate",
        "governance_category": "Security",
        "operator": "lte",
        "target": 0.15,
        "weight": 0.06,
        "description": "Ungrounded output is treated as safety/security-relevant model behavior risk.",
    },
    {
        "metric_name": "ai.resources.compute_cost",
        "label": "Compute cost",
        "governance_category": "Infrastructure",
        "operator": "lte",
        "target": 5000.0,
        "weight": 0.03,
        "description": "Infrastructure overrun risk if operating cost exceeds budget envelope.",
    },
    {
        "metric_name": "ai.resources.token_usage",
        "label": "Token usage volume",
        "governance_category": "Infrastructure",
        "operator": "lte",
        "target": 2_000_000.0,
        "weight": 0.02,
        "description": "Sustained high token load raises infrastructure and cost volatility risk.",
    },
    {
        "metric_name": "ai.resources.cost_per_token",
        "label": "Cost per token",
        "governance_category": "Infrastructure",
        "operator": "lte",
        "target": 0.005,
        "weight": 0.03,
        "description": "Captures cost-efficiency deterioration per unit model output.",
    },
    {
        "metric_name": "ai.oversight.feedback_positive_rate",
        "label": "Positive human feedback rate",
        "governance_category": "Solution Design",
        "operator": "gte",
        "target": 0.70,
        "weight": 0.05,
        "description": "Lower operator/user affirmation signals design quality and usability risk.",
    },
    {
        "metric_name": "ai.core.error_rate",
        "label": "Production error rate",
        "governance_category": "System Performance",
        "operator": "lte",
        "target": 0.05,
        "weight": 0.08,
        "description": "Higher failures increase operational and incident risk.",
    },
    {
        "metric_name": "ai.core.drift_score",
        "label": "Model drift score",
        "governance_category": "System Performance",
        "operator": "lte",
        "target": 0.20,
        "weight": 0.07,
        "description": "Higher drift indicates rising model behavior instability risk.",
    },
    {
        "metric_name": "ai.resources.frontier_model_count",
        "label": "Frontier model footprint",
        "governance_category": "Corporate Oversight",
        "operator": "lte",
        "target": 2.0,
        "weight": 0.06,
        "description": "More frontier models increase governance complexity and concentration risk.",
    },
]

DEFAULT_RISK_KPI_WEIGHTS: dict[str, float] = {
    item["metric_name"]: float(item["weight"]) for item in RISK_KPI_CATALOG
}


# ---------------------------------------------------------------------------
# Tier enum
# ---------------------------------------------------------------------------

class Tier(str, enum.Enum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"

    @classmethod
    def from_score(cls, score: float) -> "Tier":
        if score >= 80:
            return cls.CRITICAL
        if score >= 62:
            return cls.HIGH
        if score >= 38:
            return cls.MEDIUM
        return cls.LOW

    def __gt__(self, other: "Tier") -> bool:
        order = {Tier.LOW: 0, Tier.MEDIUM: 1, Tier.HIGH: 2, Tier.CRITICAL: 3}
        return order[self] > order[other]


@dataclass
class TierResult:
    raw_score: float
    final_tier: Tier
    floor_rule: Optional[str]  # "domain_floor_high" | "autonomy_floor_high" | None
    dimensions: dict[str, float]
    calculated_at: datetime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_ratio(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return numerator / denominator


def _normalize_value_scale(value: float, target: float) -> float:
    """
    Handles mixed telemetry scales (0..1 vs 0..100) for percentage-like KPIs.
    """
    if target <= 0:
        return value
    if target <= 1.0 and 1.0 < value <= 100.0:
        return value / 100.0
    if target > 1.0 and 0.0 <= value <= 1.0:
        return value * 100.0
    return value


def _metric_risk_score(metric_def: dict[str, Any], value: Optional[float]) -> float:
    """
    Converts KPI value to risk score in [0, 100], where 100 is highest risk.
    Missing telemetry returns neutral 50.
    """
    if value is None:
        return 50.0

    operator = str(metric_def.get("operator", "lte")).lower()
    target = float(metric_def.get("target", 0.0))
    val = _normalize_value_scale(float(value), target)
    eps = 1e-9

    if operator in {"lte", "lt"}:
        if val <= target:
            return 0.0
        gap_ratio = _safe_ratio(val - target, max(abs(target), eps))
        return round(min(100.0, gap_ratio * 100.0), 4)

    if operator in {"gte", "gt"}:
        if val >= target:
            return 0.0
        gap_ratio = _safe_ratio(target - val, max(abs(target), eps))
        return round(min(100.0, gap_ratio * 100.0), 4)

    # Fallback if unsupported operator appears.
    return 50.0


def _score_context_profile(app: Application) -> tuple[float, dict[str, float]]:
    domain_score = DEPLOYMENT_DOMAIN_SCORES.get((app.domain or "other").lower(), 45)
    decision_score = DECISION_TYPE_SCORES.get(app.decision_type, 55)
    autonomy_score = AUTONOMY_LEVEL_SCORES.get(app.autonomy_level, 55)
    breadth_score = POPULATION_BREADTH_SCORES.get(app.population_breadth, 35)
    populations_score = AFFECTED_POPULATIONS_SCORES.get(app.affected_populations, 45)

    weighted = {
        "context.deployment_domain": round(domain_score * CONTEXT_DIMENSION_WEIGHTS["deployment_domain"], 4),
        "context.decision_type": round(decision_score * CONTEXT_DIMENSION_WEIGHTS["decision_type"], 4),
        "context.autonomy_level": round(autonomy_score * CONTEXT_DIMENSION_WEIGHTS["autonomy_level"], 4),
        "context.population_breadth": round(breadth_score * CONTEXT_DIMENSION_WEIGHTS["population_breadth"], 4),
        "context.affected_populations": round(populations_score * CONTEXT_DIMENSION_WEIGHTS["affected_populations"], 4),
    }
    return round(sum(weighted.values()), 4), weighted


def _normalize_and_validate_weights(weights: dict[str, float]) -> dict[str, float]:
    merged: dict[str, float] = {}
    for metric_name, default_weight in DEFAULT_RISK_KPI_WEIGHTS.items():
        raw = weights.get(metric_name, default_weight)
        try:
            merged[metric_name] = max(0.0, float(raw))
        except (TypeError, ValueError):
            merged[metric_name] = default_weight

    total = sum(merged.values())
    if total <= 0:
        return dict(DEFAULT_RISK_KPI_WEIGHTS)

    return {k: round(v / total, 8) for k, v in merged.items()}


async def _get_active_kpi_weights(db: AsyncSession) -> dict[str, float]:
    row = await db.scalar(
        select(RiskKpiWeightConfig)
        .where(RiskKpiWeightConfig.is_active.is_(True))
        .order_by(RiskKpiWeightConfig.set_at.desc())
        .limit(1)
    )
    if not row:
        return dict(DEFAULT_RISK_KPI_WEIGHTS)
    raw = row.kpi_weights if isinstance(row.kpi_weights, dict) else {}
    return _normalize_and_validate_weights(raw)


async def _latest_metric_value(
    app_id: str,
    metric_name: str,
    db: AsyncSession,
) -> Optional[float]:
    reading = await db.scalar(
        select(MetricReading)
        .where(
            MetricReading.application_id == app_id,
            MetricReading.metric_name == metric_name,
        )
        .order_by(MetricReading.collected_at.desc())
        .limit(1)
    )
    if not reading:
        return None
    try:
        return float(reading.value)
    except (TypeError, ValueError):
        return None


async def _score_telemetry_profile(
    app: Application,
    db: AsyncSession,
    override_rate_hint: Optional[float],
) -> tuple[float, dict[str, float], float, Optional[float]]:
    weights = await _get_active_kpi_weights(db)

    weighted_breakdown: dict[str, float] = {}
    weighted_total = 0.0
    observed_points = 0
    override_rate_value: Optional[float] = override_rate_hint

    for metric_def in RISK_KPI_CATALOG:
        metric_name = metric_def["metric_name"]
        value = await _latest_metric_value(app.id, metric_name, db)
        if metric_name == "ai.oversight.override_rate" and value is not None:
            override_rate_value = value
        if value is not None:
            observed_points += 1
        risk_i = _metric_risk_score(metric_def, value)
        contribution = risk_i * weights.get(metric_name, 0.0)
        weighted_breakdown[f"kpi.{metric_name}"] = round(contribution, 4)
        weighted_total += contribution

    coverage = (observed_points / len(RISK_KPI_CATALOG)) if RISK_KPI_CATALOG else 0.0
    return round(weighted_total, 4), weighted_breakdown, round(coverage * 100.0, 2), override_rate_value


def _apply_floor_rules(
    app: Application,
    score_tier: Tier,
    override_rate: Optional[float],
) -> tuple[Tier, Optional[str]]:
    final_tier = score_tier
    floor_rule = None

    if (app.domain or "").lower() in HIGH_RISK_FLOOR_DOMAINS and Tier.HIGH > final_tier:
        final_tier = Tier.HIGH
        floor_rule = "domain_floor_high"

    if (
        override_rate is not None
        and app.autonomy_level == "human_in_the_loop"
        and override_rate < AUTONOMY_OVERRIDE_THRESHOLD
        and Tier.HIGH > final_tier
    ):
        final_tier = Tier.HIGH
        floor_rule = "autonomy_floor_high"

    return final_tier, floor_rule


async def _persist_tier_result(app: Application, result: TierResult, db: AsyncSession) -> None:
    event = TierChangeEvent(
        id=str(uuid4()),
        application_id=app.id,
        previous_tier=app.current_tier,
        new_tier=result.final_tier.value,
        reason=(
            f"score={result.raw_score:.2f} "
            f"floor={result.floor_rule or 'none'} "
            f"dims={result.dimensions}"
        ),
        changed_at=result.calculated_at,
    )
    db.add(event)

    await db.execute(
        update(Application).where(Application.id == app.id).values(current_tier=result.final_tier.value)
    )
    await db.commit()


async def _calculate_tier_result(
    app: Application,
    db: AsyncSession,
    *,
    override_rate_hint: Optional[float] = None,
) -> TierResult:
    context_score, context_breakdown = _score_context_profile(app)
    telemetry_score, telemetry_breakdown, telemetry_coverage_pct, observed_override_rate = await _score_telemetry_profile(
        app=app,
        db=db,
        override_rate_hint=override_rate_hint,
    )

    context_component = context_score * CONTEXT_COMPONENT_WEIGHT
    telemetry_component = telemetry_score * TELEMETRY_COMPONENT_WEIGHT
    raw_score = round(context_component + telemetry_component, 4)

    score_tier = Tier.from_score(raw_score)
    final_tier, floor_rule = _apply_floor_rules(
        app=app,
        score_tier=score_tier,
        override_rate=observed_override_rate,
    )

    dimensions: dict[str, float] = {
        "context_profile": round(context_component, 4),
        "telemetry_profile": round(telemetry_component, 4),
        "telemetry_coverage_pct": telemetry_coverage_pct,
    }
    for key, value in context_breakdown.items():
        dimensions[key] = round(value * CONTEXT_COMPONENT_WEIGHT, 4)
    for key, value in telemetry_breakdown.items():
        dimensions[key] = round(value * TELEMETRY_COMPONENT_WEIGHT, 4)

    result = TierResult(
        raw_score=raw_score,
        final_tier=final_tier,
        floor_rule=floor_rule,
        dimensions=dimensions,
        calculated_at=datetime.utcnow(),
    )
    await _persist_tier_result(app, result, db)
    return result


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

async def registration_trigger(app: Application, db: AsyncSession) -> TierResult:
    """
    Registration risk assignment.
    Uses context profile plus neutral telemetry priors (missing KPIs => risk=50).
    """
    return await _calculate_tier_result(app=app, db=db, override_rate_hint=None)


async def recalculation_trigger(
    app: Application,
    db: AsyncSession,
    otel_override_rate: Optional[float] = None,
) -> TierResult:
    """
    Telemetry-driven risk reassessment.
    Recalculates from baseline KPI telemetry with latest values and applies autonomy floor.
    """
    return await _calculate_tier_result(app=app, db=db, override_rate_hint=otel_override_rate)
