"""Requirement intelligence helpers for semantic linking and draft proposals.

Capabilities:
1) Suggest draft requirement/control text from policy context (LLM + fallback).
2) Infer telemetry vs manual control measure type from existing KPI catalog.
3) Find semantically related requirements for create-time guidance and detail views.
4) Best-effort sync of requirement relationship edges into GraphDB.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.graph.factory import get_graph_adapter
from adapters.llm.factory import get_llm_adapter

_GRAPH_REQ_URI_PREFIX = "urn:aigov:requirement:"
_GRAPH_RELATED_PREDICATE = "urn:aigov:predicate:semantically_related_requirement"
_WORD_RE = re.compile(r"[a-z0-9]+")
_GOVERNANCE_CATEGORIES = (
    "Corporate Oversight",
    "Risk & Compliance",
    "Technical Architecture",
    "Data Readiness",
    "Data Integration",
    "Security",
    "Infrastructure",
    "Solution Design",
    "System Performance",
)
_CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Corporate Oversight": (
        "oversight", "committee", "executive", "governance", "accountability", "ownership",
        "responsibility", "board", "leadership", "policy", "directive",
    ),
    "Risk & Compliance": (
        "risk", "compliance", "conformance", "regulatory", "audit", "obligation",
        "assessment", "classification", "controls",
    ),
    "Technical Architecture": (
        "architecture", "retrieval", "citation", "grounding", "rag", "design pattern",
        "model selection", "pipeline", "component",
    ),
    "Data Readiness": (
        "data quality", "bias", "fairness", "label", "dataset", "readiness", "coverage",
        "representative", "lineage", "provenance",
    ),
    "Data Integration": (
        "integration", "ingest", "etl", "mapping", "schema", "interoperability", "connector",
        "pipeline sync", "orchestration",
    ),
    "Security": (
        "security", "pentest", "attack", "injection", "breach", "vulnerability", "encryption",
        "access control", "threat", "adversarial",
    ),
    "Infrastructure": (
        "latency", "availability", "uptime", "capacity", "cost", "token", "throughput",
        "resource", "infrastructure", "compute",
    ),
    "Solution Design": (
        "human oversight", "override", "explainability", "usability", "alignment", "safety",
        "human-in-the-loop", "appeal", "decision support",
    ),
    "System Performance": (
        "performance", "drift", "monitoring", "incident", "reliability", "error rate",
        "accuracy", "precision", "recall", "kpi",
    ),
}
_EMBEDDING_TEXT_MAX_CHARS = 1600
_EMBEDDING_CACHE_MAX = 2048
_embedding_cache: dict[str, list[float]] = {}
_llm_adapter_cached: Any | None = None
_llm_adapter_error = False


@dataclass
class RequirementRecord:
    requirement_id: str
    title: str
    description: str
    category: str
    control_id: str | None
    control_title: str | None
    control_description: str | None
    metric_name: str | None


@dataclass
class RelatedRequirement:
    requirement_id: str
    title: str
    description: str
    category: str
    score: float
    control_id: str | None
    control_title: str | None
    metric_name: str | None


@dataclass
class MetricCandidate:
    metric_name: str
    description: str
    expression_preview: str | None
    control_title: str | None
    control_description: str | None
    control_domain: str | None


@dataclass
class RequirementDraftSuggestion:
    requirement_title: str
    requirement_description: str
    governance_category: str
    control_title: str
    control_description: str
    risk_statement: str
    control_measure_type: str
    metric_name: str | None
    suggestion_source: str
    confidence: float


def _normalize_text(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _tokens(value: str | None) -> set[str]:
    return set(_WORD_RE.findall(_normalize_text(value)))


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a.intersection(b)) / len(a.union(b))


def _seq_similarity(a: str | None, b: str | None) -> float:
    aa = _normalize_text(a)
    bb = _normalize_text(b)
    if not aa or not bb:
        return 0.0
    return SequenceMatcher(None, aa, bb).ratio()


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    size = min(len(a), len(b))
    if size <= 0:
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for idx in range(size):
        av = float(a[idx])
        bv = float(b[idx])
        dot += av * bv
        norm_a += av * av
        norm_b += bv * bv
    if norm_a <= 0 or norm_b <= 0:
        return 0.0
    score = dot / (math.sqrt(norm_a) * math.sqrt(norm_b))
    return max(0.0, min(1.0, (score + 1.0) / 2.0))


def _novelty_against_selected(candidate_tokens: set[str], selected_token_sets: list[set[str]]) -> float:
    if not candidate_tokens or not selected_token_sets:
        return 1.0
    max_overlap = 0.0
    for selected_tokens in selected_token_sets:
        overlap = _jaccard(candidate_tokens, selected_tokens)
        if overlap > max_overlap:
            max_overlap = overlap
    return max(0.0, 1.0 - max_overlap)


def _diversify_related_rows(candidates: list[RelatedRequirement], limit: int) -> list[RelatedRequirement]:
    if len(candidates) <= 1 or limit <= 1:
        return candidates[: max(1, limit)]

    pool = candidates[: min(len(candidates), max(limit * 8, 48))]
    selected: list[RelatedRequirement] = []
    selected_token_sets: list[set[str]] = []
    selected_control_ids: set[str] = set()
    selected_categories: set[str] = set()

    while pool and len(selected) < limit:
        best_index = 0
        best_adjusted = -1.0
        for index, row in enumerate(pool):
            row_tokens = _tokens(f"{row.title} {row.description} {row.category} {row.control_title or ''}")
            novelty = _novelty_against_selected(row_tokens, selected_token_sets)
            category = _normalize_text(row.category)
            control_id = (row.control_id or "").strip()
            category_bonus = 0.04 if category and category not in selected_categories else 0.0
            control_penalty = 0.07 if control_id and control_id in selected_control_ids else 0.0
            adjusted = (0.74 * row.score) + (0.22 * novelty) + category_bonus - control_penalty
            if adjusted > best_adjusted:
                best_adjusted = adjusted
                best_index = index

        chosen = pool.pop(best_index)
        chosen.score = round(max(0.0, min(1.0, best_adjusted)), 4)
        selected.append(chosen)
        selected_token_sets.append(_tokens(f"{chosen.title} {chosen.description} {chosen.category} {chosen.control_title or ''}"))
        if chosen.control_id:
            selected_control_ids.add(chosen.control_id)
        normalized_category = _normalize_text(chosen.category)
        if normalized_category:
            selected_categories.add(normalized_category)

    if len(selected) < limit:
        for row in candidates:
            if len(selected) >= limit:
                break
            if any(existing.requirement_id == row.requirement_id for existing in selected):
                continue
            selected.append(row)

    return selected


async def _embed_text_cached(text_value: str) -> list[float] | None:
    normalized = _normalize_text(text_value)
    if not normalized:
        return None
    key = normalized[:_EMBEDDING_TEXT_MAX_CHARS]
    cached = _embedding_cache.get(key)
    if cached is not None:
        return cached
    global _llm_adapter_cached, _llm_adapter_error
    if _llm_adapter_error:
        return None
    try:
        if _llm_adapter_cached is None:
            _llm_adapter_cached = get_llm_adapter()
        llm = _llm_adapter_cached
        vector = await llm.embed(key)
        if not isinstance(vector, list) or not vector:
            return None
        if len(_embedding_cache) >= _EMBEDDING_CACHE_MAX:
            oldest_key = next(iter(_embedding_cache))
            _embedding_cache.pop(oldest_key, None)
        _embedding_cache[key] = vector
        return vector
    except Exception:
        _llm_adapter_error = True
        return None


def _truncate(value: str, limit: int) -> str:
    compact = " ".join(value.split()).strip()
    if len(compact) <= limit:
        return compact
    return compact[: max(0, limit - 3)].rstrip() + "..."


def _safe_json_object(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    raw = raw.strip()
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(raw[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _canonical_governance_category(raw: str | None) -> str | None:
    value = _normalize_text(raw)
    if not value:
        return None
    aliases = {
        "corporate oversight": "Corporate Oversight",
        "risk and compliance": "Risk & Compliance",
        "risk & compliance": "Risk & Compliance",
        "risk classification": "Risk & Compliance",
        "technical architecture": "Technical Architecture",
        "data readiness": "Data Readiness",
        "data integration": "Data Integration",
        "security": "Security",
        "infrastructure": "Infrastructure",
        "solution design": "Solution Design",
        "system performance": "System Performance",
        "cost of ownership": "Corporate Oversight",
    }
    return aliases.get(value)


def _infer_governance_category(*, requirement_description: str, policy_description: str) -> str:
    req_blob = _normalize_text(requirement_description)
    pol_blob = _normalize_text(policy_description)
    if not req_blob and not pol_blob:
        return "Risk & Compliance"
    scores: dict[str, int] = {}
    for category, keywords in _CATEGORY_KEYWORDS.items():
        score = 0
        for keyword in keywords:
            normalized_kw = _normalize_text(keyword)
            if not normalized_kw:
                continue
            # Requirement Description is primary signal; Policy Description is secondary context.
            if normalized_kw in req_blob:
                score += 2
            if normalized_kw in pol_blob:
                score += 1
        scores[category] = score
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    top_category, top_score = ranked[0]
    return top_category if top_score > 0 else "Risk & Compliance"


async def _load_requirement_records(session: AsyncSession) -> list[RequirementRecord]:
    result = await session.execute(
        text(
            """
            SELECT
                r.id::text AS requirement_id,
                r.title AS title,
                COALESCE(r.description, '') AS description,
                COALESCE(r.category, '') AS category,
                c.id::text AS control_id,
                c.title AS control_title,
                c.description AS control_description,
                cmd.metric_name AS metric_name
            FROM requirement r
            LEFT JOIN control_requirement cr
                ON cr.requirement_id = r.id
            LEFT JOIN control c
                ON c.id = cr.control_id
            LEFT JOIN LATERAL (
                SELECT metric_name
                FROM control_metric_definition
                WHERE control_id = c.id
                ORDER BY metric_name
                LIMIT 1
            ) cmd ON TRUE
            WHERE COALESCE(TRIM(r.title), '') <> ''
            ORDER BY r.title
            """
        )
    )
    rows = result.mappings().all()
    records: list[RequirementRecord] = []
    for row in rows:
        records.append(
            RequirementRecord(
                requirement_id=str(row.get("requirement_id") or ""),
                title=(row.get("title") or "").strip(),
                description=(row.get("description") or "").strip(),
                category=(row.get("category") or "").strip(),
                control_id=(str(row.get("control_id")) if row.get("control_id") else None),
                control_title=(row.get("control_title") or "").strip() or None,
                control_description=(row.get("control_description") or "").strip() or None,
                metric_name=(row.get("metric_name") or "").strip() or None,
            )
        )
    return records


async def _load_metric_candidates(
    session: AsyncSession,
    *,
    governance_category: str | None = None,
) -> list[MetricCandidate]:
    params: dict[str, Any] = {}
    category_filter = ""
    if governance_category and governance_category.strip():
        category_filter = "AND LOWER(COALESCE(c.domain, '')) = LOWER(:governance_category)"
        params["governance_category"] = governance_category.strip()

    result = await session.execute(
        text(
            f"""
            SELECT
                cmd.metric_name AS metric_name,
                COALESCE(
                    NULLIF(TRIM(asa.description), ''),
                    NULLIF(TRIM(mf.interpretation_template), ''),
                    NULLIF(TRIM(mf.expression_preview), ''),
                    ''
                ) AS metric_description,
                mf.expression_preview AS expression_preview,
                c.title AS control_title,
                c.description AS control_description,
                c.domain AS control_domain
            FROM control_metric_definition cmd
            JOIN control c
                ON c.id = cmd.control_id
            LEFT JOIN measure_formula mf
                ON mf.control_metric_definition_id = cmd.id
            LEFT JOIN approved_system_attributes asa
                ON asa.attribute_name = cmd.metric_name
               AND asa.is_active = TRUE
            WHERE COALESCE(TRIM(cmd.metric_name), '') <> ''
              AND COALESCE(cmd.is_manual, FALSE) = FALSE
              {category_filter}
            ORDER BY cmd.metric_name, mf.approved DESC NULLS LAST, mf.approved_at DESC NULLS LAST
            """
        ),
        params,
    )
    dedup: dict[str, MetricCandidate] = {}
    for row in result.mappings().all():
        metric_name = (row.get("metric_name") or "").strip()
        if not metric_name:
            continue
        if metric_name in dedup:
            continue
        dedup[metric_name] = MetricCandidate(
            metric_name=metric_name,
            description=(row.get("metric_description") or "").strip(),
            expression_preview=(row.get("expression_preview") or "").strip() or None,
            control_title=(row.get("control_title") or "").strip() or None,
            control_description=(row.get("control_description") or "").strip() or None,
            control_domain=(row.get("control_domain") or "").strip() or None,
        )
    return list(dedup.values())


def _relatedness_score(
    *,
    query_title: str,
    query_description: str,
    query_category: str,
    query_control_id: str | None,
    candidate: RequirementRecord,
) -> float:
    title_score = _seq_similarity(query_title, candidate.title)
    description_score = _seq_similarity(query_description, candidate.description)
    token_score = _jaccard(
        _tokens(f"{query_title} {query_description}"),
        _tokens(f"{candidate.title} {candidate.description}"),
    )

    category_bonus = 0.08 if query_category and _normalize_text(candidate.category) == _normalize_text(query_category) else 0.0
    control_bonus = 0.1 if query_control_id and candidate.control_id and candidate.control_id == query_control_id else 0.0
    score = (0.42 * title_score) + (0.33 * description_score) + (0.25 * token_score) + category_bonus + control_bonus
    return round(max(0.0, min(1.0, score)), 4)


async def find_related_requirements(
    session: AsyncSession,
    *,
    query_title: str,
    query_description: str,
    query_category: str | None = None,
    query_control_id: str | None = None,
    exclude_requirement_id: str | None = None,
    limit: int = 8,
    min_score: float = 0.2,
) -> list[RelatedRequirement]:
    records = await _load_requirement_records(session)
    query_blob = " ".join(
        [
            query_title or "",
            query_description or "",
            query_category or "",
        ]
    )
    query_embedding = await _embed_text_cached(query_blob)
    related: list[RelatedRequirement] = []
    for item in records:
        if not item.requirement_id:
            continue
        if exclude_requirement_id and item.requirement_id == str(exclude_requirement_id):
            continue
        lexical_score = _relatedness_score(
            query_title=query_title,
            query_description=query_description,
            query_category=query_category or "",
            query_control_id=query_control_id,
            candidate=item,
        )
        semantic_score = 0.0
        if query_embedding is not None:
            candidate_blob = " ".join(
                [
                    item.title or "",
                    item.description or "",
                    item.category or "",
                    item.control_title or "",
                    item.control_description or "",
                ]
            )
            candidate_embedding = await _embed_text_cached(candidate_blob)
            if candidate_embedding is not None:
                semantic_score = _cosine_similarity(query_embedding, candidate_embedding)

        score = (
            (0.58 * lexical_score) + (0.42 * semantic_score)
            if query_embedding is not None
            else lexical_score
        )
        score = round(max(0.0, min(1.0, score)), 4)
        if score < min_score:
            continue
        related.append(
            RelatedRequirement(
                requirement_id=item.requirement_id,
                title=item.title,
                description=item.description,
                category=item.category,
                score=score,
                control_id=item.control_id,
                control_title=item.control_title,
                metric_name=item.metric_name,
            )
        )
    related.sort(key=lambda row: row.score, reverse=True)
    return _diversify_related_rows(related, max(1, limit))


async def _generate_llm_draft(
    *,
    policy_description: str,
    requirement_description: str,
) -> dict[str, Any] | None:
    prompt = (
        "You generate concise enterprise governance requirement drafts.\n"
        "Return STRICT JSON only with keys:\n"
        '  requirement_title, requirement_description, governance_category, control_title, control_description, risk_statement\n'
        "Rules:\n"
        "- governance_category must be exactly one of: "
        + ", ".join(_GOVERNANCE_CATEGORIES) + "\n"
        "- requirement_title <= 250 chars\n"
        "- requirement_description <= 700 chars\n"
        "- control_title <= 160 chars\n"
        "- control_description <= 700 chars\n"
        "- keep language plain English and implementation-oriented\n\n"
        f"Policy description: {policy_description}\n"
        f"Requirement description: {requirement_description}\n"
    )
    system = (
        "You are an AI governance analyst. "
        "Output valid JSON only and do not include markdown."
    )

    try:
        llm = get_llm_adapter()
        try:
            raw = await llm.complete(prompt=prompt, system=system, max_tokens=380, use_mini=True)  # type: ignore[arg-type]
        except TypeError:
            raw = await llm.complete(prompt=prompt, system=system, max_tokens=380)
    except Exception:
        return None

    payload = _safe_json_object(raw or "")
    if not payload:
        return None
    return payload


def _heuristic_draft(
    *,
    policy_description: str,
    requirement_description: str,
) -> dict[str, str]:
    governance_category = _infer_governance_category(
        requirement_description=requirement_description,
        policy_description=policy_description,
    )
    source = requirement_description.strip() or policy_description.strip()
    fallback_title = _truncate(source or f"{governance_category} conformance requirement", 250)
    if not fallback_title:
        fallback_title = f"{governance_category} conformance requirement"

    fallback_description = _truncate(
        requirement_description.strip()
        or policy_description.strip()
        or f"Ensure the application conforms to governance obligations for {governance_category}.",
        700,
    )
    fallback_control_title = _truncate(
        f"{governance_category} control attestation",
        160,
    )
    fallback_control_description = _truncate(
        f"Track objective evidence that the requirement '{fallback_title}' is implemented and continuously monitored.",
        700,
    )
    fallback_risk = _truncate(f"Non-conformance may increase governance exposure in {governance_category}.", 700)

    return {
        "requirement_title": fallback_title,
        "requirement_description": fallback_description,
        "governance_category": governance_category,
        "control_title": fallback_control_title,
        "control_description": fallback_control_description,
        "risk_statement": fallback_risk,
    }


def _metric_match_score(
    *,
    metric: MetricCandidate,
    query_text: str,
    query_category: str,
) -> float:
    query_tokens = _tokens(query_text)
    metric_tokens = _tokens(
        f"{metric.metric_name} {metric.description} {metric.expression_preview or ''} {metric.control_title or ''} {metric.control_description or ''}"
    )
    token_score = _jaccard(query_tokens, metric_tokens)
    seq_score = _seq_similarity(query_text, f"{metric.description} {metric.control_description or ''}")
    category_bonus = 0.08 if query_category and _normalize_text(query_category) == _normalize_text(metric.control_domain or "") else 0.0
    return round(max(0.0, min(1.0, (0.6 * token_score) + (0.4 * seq_score) + category_bonus)), 4)


async def suggest_requirement_draft(
    session: AsyncSession,
    *,
    policy_description: str,
    requirement_description: str,
    preferred_related_limit: int = 8,
    use_llm: bool = True,
) -> tuple[RequirementDraftSuggestion, list[RelatedRequirement]]:
    llm_payload: dict[str, Any] | None = None
    if use_llm:
        llm_payload = await _generate_llm_draft(
            policy_description=policy_description,
            requirement_description=requirement_description,
        )

    heuristic = _heuristic_draft(
        policy_description=policy_description,
        requirement_description=requirement_description,
    )
    llm_category = _canonical_governance_category((llm_payload or {}).get("governance_category"))
    inferred_category = llm_category or heuristic["governance_category"]
    merged = {
        "requirement_title": _truncate(str((llm_payload or {}).get("requirement_title") or heuristic["requirement_title"]), 250),
        "requirement_description": _truncate(str((llm_payload or {}).get("requirement_description") or heuristic["requirement_description"]), 700),
        "governance_category": inferred_category,
        "control_title": _truncate(str((llm_payload or {}).get("control_title") or heuristic["control_title"]), 160),
        "control_description": _truncate(str((llm_payload or {}).get("control_description") or heuristic["control_description"]), 700),
        "risk_statement": _truncate(str((llm_payload or {}).get("risk_statement") or heuristic["risk_statement"]), 700),
    }

    query_blob = " ".join(
        [
            merged["requirement_title"],
            merged["requirement_description"],
            merged["control_title"],
            merged["control_description"],
            merged["governance_category"],
        ]
    )
    metric_candidates = await _load_metric_candidates(session)

    metric_name: str | None = None
    control_measure_type = "evidence_based"
    confidence = 0.38 if llm_payload else 0.3
    top_metric_score = 0.0
    if metric_candidates:
        ranked = sorted(
            [
                (candidate, _metric_match_score(metric=candidate, query_text=query_blob, query_category=merged["governance_category"]))
                for candidate in metric_candidates
            ],
            key=lambda item: item[1],
            reverse=True,
        )
        best_metric, best_score = ranked[0]
        top_metric_score = best_score
        if best_score >= 0.26:
            control_measure_type = "system_telemetry"
            metric_name = best_metric.metric_name
            if not llm_payload:
                merged["control_title"] = best_metric.control_title or merged["control_title"]
                merged["control_description"] = best_metric.control_description or merged["control_description"]
            confidence = max(confidence, min(0.92, 0.48 + (best_score * 0.4)))

    related = await find_related_requirements(
        session,
        query_title=merged["requirement_title"],
        query_description=merged["requirement_description"],
        query_category=merged["governance_category"],
        limit=preferred_related_limit,
        min_score=0.18,
    )
    if related:
        confidence = max(confidence, min(0.95, related[0].score))
    if control_measure_type == "evidence_based":
        confidence = max(confidence, 0.42 if llm_payload else 0.34)
    if top_metric_score and control_measure_type == "system_telemetry":
        confidence = max(confidence, min(0.95, 0.45 + top_metric_score))

    suggestion = RequirementDraftSuggestion(
        requirement_title=merged["requirement_title"],
        requirement_description=merged["requirement_description"],
        governance_category=merged["governance_category"],
        control_title=merged["control_title"],
        control_description=merged["control_description"],
        risk_statement=merged["risk_statement"],
        control_measure_type=control_measure_type,
        metric_name=metric_name,
        suggestion_source="llm_plus_heuristic" if llm_payload else "heuristic",
        confidence=round(min(0.99, confidence), 4),
    )
    return suggestion, related


async def sync_related_requirements_graph(
    requirement_id: str,
    related_requirement_ids: list[str],
) -> bool:
    """Best-effort GraphDB sync for semantic relationship edges.

    Returns True when sync logic executes successfully. Any adapter failure returns False.
    """
    subject = f"{_GRAPH_REQ_URI_PREFIX}{requirement_id}"
    target_ids = {str(item).strip() for item in related_requirement_ids if str(item).strip()}
    target_uris = {f"{_GRAPH_REQ_URI_PREFIX}{item}" for item in target_ids}
    try:
        graph = get_graph_adapter()
        existing_rows = await graph.query(
            f"""
            SELECT ?o
            WHERE {{
              <{subject}> <{_GRAPH_RELATED_PREDICATE}> ?o .
            }}
            """
        )
        existing_uris = {
            str(row.get("o") or "").strip()
            for row in existing_rows
            if str(row.get("o") or "").strip().startswith(_GRAPH_REQ_URI_PREFIX)
        }

        for stale in sorted(existing_uris - target_uris):
            await graph.delete_triple(subject, _GRAPH_RELATED_PREDICATE, stale)
        for fresh in sorted(target_uris - existing_uris):
            await graph.insert_triple(subject, _GRAPH_RELATED_PREDICATE, fresh, None)
        return True
    except Exception:
        return False
