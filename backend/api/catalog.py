"""
GET    /catalog/controls                  — list controls (59 pre-seeded)
GET    /catalog/controls/{id}             — control detail
GET    /catalog/requirements              — list requirements (140 pre-seeded)
GET    /catalog/requirements/{id}         — requirement detail
GET    /catalog/interpretations           — 3-layer interpretation tree
POST   /catalog/interpretations           — submit interpretation (admin)

Domains: 13 (RM, RO, LC, SE, OM, AA, GL, CO, etc.)
Three-tier structure: Foundation / Common / Specialized.
FOUNDATION controls auto-applied to every application:
  RM-0, RM-1, RM-2, RO-2, LC-1, SE-1, OM-1, AA-1, GL-1, CO-1

Phase 3 implementation. MCP server (mcp/server.py) exposes these via 5 catalog tools.
"""
import os
import json
from typing import Any, Literal
from uuid import UUID, uuid4
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Header, Path, Query
from pydantic import BaseModel, Field, ValidationInfo, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from adapters.search.factory import get_search_adapter
from db.session import get_db_session

router = APIRouter(tags=["catalog"])


class ControlListItem(BaseModel):
    id: str
    code: str
    title: str
    description: str | None
    domain: str
    tier: str | None
    is_foundation: bool | None
    measurement_mode: str | None
    metric_name: str | None = None


class ControlListResponse(BaseModel):
    items: list[ControlListItem]
    total: int
    skip: int
    limit: int


class RequirementListItem(BaseModel):
    id: str
    regulation_id: str
    regulation_title: str | None
    jurisdiction: str | None
    policy_source: str | None = None
    policy_description: str | None = None
    policy_type: str | None = None
    policy_status: str | None = None
    code: str
    title: str
    description: str | None
    category: str | None
    risk_statement: str | None = None


class RequirementListResponse(BaseModel):
    items: list[RequirementListItem]
    total: int
    skip: int
    limit: int


class RegulationListItem(BaseModel):
    id: str
    title: str
    jurisdiction: str | None
    source: str | None = None
    description: str | None = None
    policy_type: str | None = None
    policy_status: str | None = None
    requirement_count: int


class RegulationListResponse(BaseModel):
    items: list[RegulationListItem]
    total: int
    skip: int
    limit: int


class CatalogOverviewStatsResponse(BaseModel):
    total_requirements: int
    distinct_rules: int
    rules_with_controls: int
    rules_with_measures: int
    total_controls: int
    controls_with_measures: int
    distinct_control_domains: int
    total_control_requirement_links: int
    total_measure_definitions: int
    distinct_measure_metrics: int
    peer_benchmarked_metrics: int
    risk_compliance_controls: int
    risk_compliance_measurable_controls: int
    risk_compliance_domains_present: int
    total_regulations: int
    total_jurisdictions: int
    total_interpretations: int


class SearchResultItem(BaseModel):
    id: str
    code: str | None = None
    title: str | None = None
    description: str | None = None
    type: str | None = None
    domain: str | None = None
    tier: str | None = None
    measurement_mode: str | None = None
    source: str | None = None
    jurisdiction: str | None = None
    score: float | None = None


class UnifiedSearchResponse(BaseModel):
    items: list[SearchResultItem]
    total: int
    skip: int
    limit: int
    facets: dict[str, dict[str, int]]


class AutocompleteItem(BaseModel):
    id: str
    label: str
    type: str | None = None
    code: str | None = None


class AutocompleteResponse(BaseModel):
    items: list[AutocompleteItem]
    total: int
    skip: int
    limit: int


class InterpretationItem(BaseModel):
    id: str
    requirement_id: str
    layer: str | None
    content: str
    version: int | None
    created_at: datetime | None


class InterpretationListResponse(BaseModel):
    items: list[InterpretationItem]
    total: int
    skip: int
    limit: int


class InterpretationVersionItem(BaseModel):
    id: str
    version: int | None
    content: str
    created_at: datetime | None


class InterpretationLayerNode(BaseModel):
    layer: str
    versions: list[InterpretationVersionItem]


class InterpretationRequirementNode(BaseModel):
    requirement_id: str
    layers: list[InterpretationLayerNode]


class InterpretationTreeResponse(BaseModel):
    items: list[InterpretationRequirementNode]
    total_requirements: int
    skip: int
    limit: int


class InterpretationCreateRequest(BaseModel):
    requirement_id: UUID
    layer: Literal["SOURCE", "SYSTEM", "USER"]
    content: str = Field(..., min_length=1, description="Interpretation text")

    @field_validator("content")
    @classmethod
    def _content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Interpretation content must not be blank")
        return value


class AdminRequirementPlacement(BaseModel):
    requirement_type: Literal["baseline", "application_specific"] = "baseline"
    dashboard_inclusion: Literal["baseline", "assigned"] = "baseline"
    application_ids: list[UUID] = Field(default_factory=list)
    apply_to_all_apps: bool = False


class AdminRequirementSaveRequest(BaseModel):
    requirement_id: UUID | None = None
    policy_id: UUID | None = None
    policy_title: str = Field(..., min_length=2, max_length=280)
    policy_jurisdiction: str = Field(..., min_length=2, max_length=120)
    policy_source: str = Field(..., min_length=2, max_length=200)
    policy_description: str = Field(..., min_length=2, max_length=4000)
    policy_type: str = Field(..., min_length=2, max_length=120)
    policy_status: str = Field(..., min_length=2, max_length=40)

    requirement_title: str = Field(..., min_length=2, max_length=280)
    requirement_description: str = Field(..., min_length=2, max_length=1200)
    governance_category: str = Field(..., min_length=2, max_length=120)
    risk_statement: str = Field(..., min_length=2, max_length=1000)

    control_id: UUID | None = None
    control_title: str = Field(..., min_length=2, max_length=280)
    control_description: str | None = None

    control_measure_type: Literal["system_telemetry", "evidence_based"] = "system_telemetry"
    metric_name: str | None = None
    threshold: dict[str, Any] | None = None
    formula_expression: str | None = None

    placement: AdminRequirementPlacement = Field(default_factory=AdminRequirementPlacement)
    set_by: str | None = None

    @field_validator(
        "policy_title",
        "policy_jurisdiction",
        "policy_source",
        "policy_description",
        "policy_type",
        "policy_status",
        "requirement_title",
        "requirement_description",
        "governance_category",
        "risk_statement",
        mode="before",
    )
    @classmethod
    def _required_text_fields_must_not_be_blank(cls, value: Any, info: ValidationInfo) -> str:
        text_value = str(value or "").strip()
        if not text_value:
            raise ValueError(f"{info.field_name} is required")
        return text_value


class AdminRequirementSaveResponse(BaseModel):
    requirement_id: str
    control_id: str
    policy_id: str
    metric_definition_id: str | None
    assigned_app_count: int
    dashboard_inclusion: str
    requirement_type: str


class AdminRequirementDeleteResponse(BaseModel):
    requirement_id: str
    deleted: bool


class AdminRequirementStatusUpdateRequest(BaseModel):
    policy_status: Literal["Active", "Inactive"]


class AdminRequirementStatusUpdateResponse(BaseModel):
    requirement_id: str
    regulation_id: str
    policy_status: str


class AdminPolicySearchItem(BaseModel):
    id: str
    title: str
    jurisdiction: str | None
    source: str | None = None
    description: str | None = None
    policy_type: str | None = None
    policy_status: str | None = None
    requirement_count: int


class AdminPolicySearchResponse(BaseModel):
    items: list[AdminPolicySearchItem]
    total: int


class AdminRequirementQuickSearchItem(BaseModel):
    id: str
    title: str
    description: str | None
    category: str | None
    regulation_id: str
    regulation_title: str | None
    jurisdiction: str | None
    policy_source: str | None = None
    policy_type: str | None = None
    policy_status: str | None = None
    risk_statement: str | None = None


class AdminRequirementQuickSearchResponse(BaseModel):
    items: list[AdminRequirementQuickSearchItem]
    total: int


class AdminSystemKpiItem(BaseModel):
    metric_name: str
    label: str
    description: str | None
    expression_preview: str | None
    threshold: dict[str, Any] | None = None
    operator: str | None = None
    window: str | None = None
    aggregation: str | None = None
    source: str


CONTROL_BASE_SELECT = """
SELECT
    c.id::text AS id,
    c.code AS code,
    c.title AS title,
    c.description AS description,
    c.domain AS domain,
    c.tier::text AS tier,
    c.is_foundation AS is_foundation,
    c.measurement_mode::text AS measurement_mode,
    (
        SELECT cmd.metric_name
        FROM control_metric_definition cmd
        WHERE cmd.control_id = c.id
        ORDER BY cmd.metric_name
        LIMIT 1
    ) AS metric_name
FROM control c
"""


REQUIREMENT_BASE_SELECT = """
SELECT
    r.id::text AS id,
    r.regulation_id::text AS regulation_id,
    reg.title AS regulation_title,
    reg.jurisdiction AS jurisdiction,
    reg.source AS policy_source,
    reg.description AS policy_description,
    reg.policy_type AS policy_type,
    COALESCE(NULLIF(TRIM(r.status), ''), NULLIF(TRIM(reg.policy_status), ''), 'Active') AS policy_status,
    r.code AS code,
    r.title AS title,
    r.description AS description,
    r.category AS category,
    r.risk_statement AS risk_statement
FROM requirement r
LEFT JOIN regulation reg ON reg.id = r.regulation_id
"""


def _control_filters(domain: str | None, tier: str | None) -> tuple[str, dict]:
    clauses: list[str] = []
    params: dict[str, str] = {}
    if domain:
        clauses.append("LOWER(c.domain) = :domain")
        params["domain"] = domain.lower()
    if tier:
        clauses.append("c.tier::text = :tier")
        params["tier"] = tier
    where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where_clause, params


def _requirement_filters(control_id: UUID | None) -> tuple[str, str, dict]:
    joins = ""
    clauses: list[str] = []
    params: dict[str, str] = {}
    if control_id:
        joins = "JOIN control_requirement cr ON cr.requirement_id = r.id"
        clauses.append("cr.control_id::text = :control_id")
        params["control_id"] = str(control_id)
    where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return joins, where_clause, params


def _build_facets(rows: list[dict], fields: list[str]) -> dict[str, dict[str, int]]:
    facets: dict[str, dict[str, int]] = {field: {} for field in fields}
    for row in rows:
        for field in fields:
            value = row.get(field)
            if value is None or value == "":
                continue
            bucket = str(value)
            facets[field][bucket] = facets[field].get(bucket, 0) + 1
    return facets


def _build_autocomplete_candidates(rows: list[dict]) -> list[AutocompleteItem]:
    items: list[AutocompleteItem] = []
    seen: set[tuple[str, str | None]] = set()
    for row in rows:
        label = str(row.get("title") or row.get("code") or row.get("id") or "").strip()
        if not label:
            continue
        item_type = row.get("type")
        key = (label.lower(), item_type)
        if key in seen:
            continue
        seen.add(key)
        items.append(
            AutocompleteItem(
                id=str(row.get("id") or ""),
                label=label,
                type=item_type,
                code=row.get("code"),
            )
        )
    return items


def _search_order_by(sort: Literal["relevance", "code", "title"]) -> list[str] | None:
    if sort == "code":
        return ["code asc", "title asc"]
    if sort == "title":
        return ["title asc", "code asc"]
    return None


def _interpretation_filters(
    requirement_id: UUID | None,
    layer: Literal["SOURCE", "SYSTEM", "USER"] | None,
) -> tuple[str, dict]:
    clauses: list[str] = []
    params: dict[str, str] = {}
    if requirement_id:
        clauses.append("ri.requirement_id::text = :requirement_id")
        params["requirement_id"] = str(requirement_id)
    if layer:
        clauses.append("ri.layer::text = :layer")
        params["layer"] = layer
    where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where_clause, params


def _build_interpretation_tree(rows: list[dict]) -> list[InterpretationRequirementNode]:
    grouped: dict[str, dict[str, list[InterpretationVersionItem]]] = {}

    for row in rows:
        requirement_id = row["requirement_id"]
        layer = row.get("layer") or "UNKNOWN"
        grouped.setdefault(requirement_id, {})
        grouped[requirement_id].setdefault(layer, [])
        grouped[requirement_id][layer].append(
            InterpretationVersionItem(
                id=row["id"],
                version=row.get("version"),
                content=row["content"],
                created_at=row.get("created_at"),
            )
        )

    tree: list[InterpretationRequirementNode] = []
    for requirement_id, layers_map in grouped.items():
        layers = [
            InterpretationLayerNode(layer=layer, versions=versions)
            for layer, versions in layers_map.items()
        ]
        tree.append(InterpretationRequirementNode(requirement_id=requirement_id, layers=layers))
    return tree


def _is_admin_scope_check_enabled() -> bool:
    raw = os.getenv("ENFORCE_ADMIN_SCOPE_CHECK", "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


async def require_governance_admin_scope(
    x_governance_scopes: str | None = Header(default=None),
) -> None:
    """Placeholder scope guard.

    Enforcement is controlled by ENFORCE_ADMIN_SCOPE_CHECK.
    If enabled, request header X-Governance-Scopes must include governance.admin.
    """
    if not _is_admin_scope_check_enabled():
        return

    scopes = {
        token.strip()
        for token in (x_governance_scopes or "").replace(",", " ").split()
        if token.strip()
    }
    if "governance.admin" not in scopes:
        raise HTTPException(status_code=403, detail="governance.admin scope required")


CATEGORY_TO_TAG: dict[str, str] = {
    "corporate oversight": "corporate_oversight",
    "risk & compliance": "risk_compliance",
    "technical architecture": "technical_architecture",
    "data readiness": "data_readiness",
    "data integration": "data_integration",
    "security": "security",
    "infrastructure": "infrastructure",
    "solution design": "solution_design",
    "system performance": "system_performance",
}


def _slug(value: str) -> str:
    return "_".join((value or "").lower().replace("&", "and").replace("/", " ").split())


def _lifecycle_tag_for_category(category: str) -> str:
    key = (category or "").strip().lower()
    return CATEGORY_TO_TAG.get(key) or _slug(category)


async def _generate_unique_code(
    session: AsyncSession,
    *,
    table_name: Literal["requirement", "control"],
    prefix: str,
) -> str:
    for _ in range(60):
        token = uuid4().hex[:8].upper()
        candidate = f"{prefix}-{token}"
        result = await session.execute(
            text(f"SELECT 1 FROM {table_name} WHERE code = :code LIMIT 1"),
            {"code": candidate},
        )
        if result.first() is None:
            return candidate
    raise HTTPException(status_code=500, detail=f"Failed to generate unique code for {table_name}")


@router.get("/catalog/controls", response_model=ControlListResponse)
async def list_controls(
    domain: str | None = Query(default=None, min_length=1, max_length=64),
    tier: Literal["FOUNDATION", "COMMON", "SPECIALIZED"] | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_db_session),
) -> ControlListResponse:
    """List catalog controls with simple domain/tier filters and pagination."""
    where_clause, params = _control_filters(domain=domain, tier=tier)

    count_result = await session.execute(
        text(
            f"""
            SELECT COUNT(*) AS total
            FROM control c
            {where_clause}
            """
        ),
        params,
    )
    total = int(count_result.scalar_one())

    page_params = {**params, "skip": skip, "limit": limit}
    rows_result = await session.execute(
        text(
            f"""
            {CONTROL_BASE_SELECT}
            {where_clause}
            ORDER BY c.code
            OFFSET :skip
            LIMIT :limit
            """
        ),
        page_params,
    )
    items = [ControlListItem(**row) for row in rows_result.mappings().all()]

    return ControlListResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/catalog/controls/{control_id}", response_model=ControlListItem)
async def get_control(
    control_id: UUID = Path(..., description="Control UUID"),
    session: AsyncSession = Depends(get_db_session),
) -> ControlListItem:
    result = await session.execute(
        text(
            f"""
            {CONTROL_BASE_SELECT}
            WHERE c.id::text = :control_id
            """
        ),
        {"control_id": str(control_id)},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Control not found")
    return ControlListItem(**row)


@router.get("/catalog/requirements", response_model=RequirementListResponse)
async def list_requirements(
    control_id: UUID | None = Query(default=None, description="Filter by control UUID"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_db_session),
) -> RequirementListResponse:
    joins, where_clause, params = _requirement_filters(control_id=control_id)

    count_result = await session.execute(
        text(
            f"""
            SELECT COUNT(*) AS total
            FROM requirement r
            {joins}
            {where_clause}
            """
        ),
        params,
    )
    total = int(count_result.scalar_one())

    page_params = {**params, "skip": skip, "limit": limit}
    rows_result = await session.execute(
        text(
            f"""
            {REQUIREMENT_BASE_SELECT}
            {joins}
            {where_clause}
            ORDER BY r.code
            OFFSET :skip
            LIMIT :limit
            """
        ),
        page_params,
    )
    items = [RequirementListItem(**row) for row in rows_result.mappings().all()]

    return RequirementListResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/catalog/requirements/{req_id}", response_model=RequirementListItem)
async def get_requirement(
    req_id: UUID = Path(..., description="Requirement UUID"),
    session: AsyncSession = Depends(get_db_session),
) -> RequirementListItem:
    result = await session.execute(
        text(
            f"""
            {REQUIREMENT_BASE_SELECT}
            WHERE r.id::text = :req_id
            """
        ),
        {"req_id": str(req_id)},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Requirement not found")
    return RequirementListItem(**row)


@router.get("/catalog/regulations", response_model=RegulationListResponse)
async def list_regulations(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=500),
    session: AsyncSession = Depends(get_db_session),
) -> RegulationListResponse:
    count_result = await session.execute(
        text(
            """
            SELECT COUNT(*) AS total
            FROM regulation reg
            """
        )
    )
    total = int(count_result.scalar_one())

    rows_result = await session.execute(
        text(
            """
            SELECT
                reg.id::text AS id,
                reg.title AS title,
                reg.jurisdiction AS jurisdiction,
                COUNT(r.id) AS requirement_count
            FROM regulation reg
            LEFT JOIN requirement r ON r.regulation_id = reg.id
            GROUP BY reg.id, reg.title, reg.jurisdiction
            ORDER BY reg.title
            OFFSET :skip
            LIMIT :limit
            """
        ),
        {"skip": skip, "limit": limit},
    )

    items = [
        RegulationListItem(
            id=row["id"],
            title=row["title"],
            jurisdiction=row.get("jurisdiction"),
            requirement_count=int(row.get("requirement_count") or 0),
        )
        for row in rows_result.mappings().all()
    ]
    return RegulationListResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/catalog/overview-stats", response_model=CatalogOverviewStatsResponse)
async def catalog_overview_stats(
    session: AsyncSession = Depends(get_db_session),
) -> CatalogOverviewStatsResponse:
    result = await session.execute(
        text(
            """
            SELECT
                (SELECT COUNT(*) FROM requirement) AS total_requirements,
                (
                    SELECT COUNT(DISTINCT LOWER(TRIM(COALESCE(NULLIF(r.title, ''), r.code))))
                    FROM requirement r
                ) AS distinct_rules,
                (
                    SELECT COUNT(DISTINCT cr.requirement_id)
                    FROM control_requirement cr
                ) AS rules_with_controls,
                (
                    SELECT COUNT(DISTINCT cr.requirement_id)
                    FROM control_requirement cr
                    JOIN control_metric_definition cmd ON cmd.control_id = cr.control_id
                ) AS rules_with_measures,
                (SELECT COUNT(*) FROM control) AS total_controls,
                (
                    SELECT COUNT(DISTINCT cmd.control_id)
                    FROM control_metric_definition cmd
                ) AS controls_with_measures,
                (
                    SELECT COUNT(DISTINCT LOWER(TRIM(COALESCE(NULLIF(c.domain, ''), 'unassigned'))))
                    FROM control c
                ) AS distinct_control_domains,
                (SELECT COUNT(*) FROM control_requirement) AS total_control_requirement_links,
                (SELECT COUNT(*) FROM control_metric_definition) AS total_measure_definitions,
                (SELECT COUNT(DISTINCT cmd.metric_name) FROM control_metric_definition cmd) AS distinct_measure_metrics,
                (
                    SELECT COUNT(DISTINCT tpa.metric_name)
                    FROM tier_peer_aggregate tpa
                    WHERE COALESCE(tpa.peer_count, 0) >= 1
                ) AS peer_benchmarked_metrics,
                (
                    SELECT COUNT(*)
                    FROM control c
                    WHERE LOWER(TRIM(COALESCE(c.domain, ''))) IN (
                        'risk management',
                        'regulatory',
                        'governance',
                        'audit',
                        'privacy'
                    )
                ) AS risk_compliance_controls,
                (
                    SELECT COUNT(DISTINCT c.id)
                    FROM control c
                    JOIN control_metric_definition cmd ON cmd.control_id = c.id
                    WHERE LOWER(TRIM(COALESCE(c.domain, ''))) IN (
                        'risk management',
                        'regulatory',
                        'governance',
                        'audit',
                        'privacy'
                    )
                ) AS risk_compliance_measurable_controls,
                (
                    SELECT COUNT(DISTINCT LOWER(TRIM(COALESCE(c.domain, ''))))
                    FROM control c
                    WHERE LOWER(TRIM(COALESCE(c.domain, ''))) IN (
                        'risk management',
                        'regulatory',
                        'governance',
                        'audit',
                        'privacy'
                    )
                ) AS risk_compliance_domains_present,
                (SELECT COUNT(*) FROM regulation) AS total_regulations,
                (
                    SELECT COUNT(DISTINCT LOWER(TRIM(reg.jurisdiction)))
                    FROM regulation reg
                    WHERE reg.jurisdiction IS NOT NULL
                      AND TRIM(reg.jurisdiction) <> ''
                ) AS total_jurisdictions,
                (SELECT COUNT(*) FROM risk_interpretation) AS total_interpretations
            """
        )
    )
    row = result.mappings().first() or {}
    return CatalogOverviewStatsResponse(
        total_requirements=int(row.get("total_requirements") or 0),
        distinct_rules=int(row.get("distinct_rules") or 0),
        rules_with_controls=int(row.get("rules_with_controls") or 0),
        rules_with_measures=int(row.get("rules_with_measures") or 0),
        total_controls=int(row.get("total_controls") or 0),
        controls_with_measures=int(row.get("controls_with_measures") or 0),
        distinct_control_domains=int(row.get("distinct_control_domains") or 0),
        total_control_requirement_links=int(row.get("total_control_requirement_links") or 0),
        total_measure_definitions=int(row.get("total_measure_definitions") or 0),
        distinct_measure_metrics=int(row.get("distinct_measure_metrics") or 0),
        peer_benchmarked_metrics=int(row.get("peer_benchmarked_metrics") or 0),
        risk_compliance_controls=int(row.get("risk_compliance_controls") or 0),
        risk_compliance_measurable_controls=int(row.get("risk_compliance_measurable_controls") or 0),
        risk_compliance_domains_present=int(row.get("risk_compliance_domains_present") or 0),
        total_regulations=int(row.get("total_regulations") or 0),
        total_jurisdictions=int(row.get("total_jurisdictions") or 0),
        total_interpretations=int(row.get("total_interpretations") or 0),
    )


@router.get(
    "/catalog/search",
    response_model=UnifiedSearchResponse,
    summary="Unified catalog search",
    description=(
        "Search controls and requirements with optional filters and pagination. "
        "Use sort=relevance|code|title for globally stable ordering across pages."
    ),
)
async def unified_search(
    q: str = Query(..., min_length=1, max_length=200, description="Search query text"),
    type: Literal["control", "requirement"] | None = Query(default=None),
    domain: str | None = Query(default=None),
    tier: Literal["FOUNDATION", "COMMON", "SPECIALIZED"] | None = Query(default=None),
    jurisdiction: str | None = Query(default=None),
    measurement_mode: Literal["system_calculated", "hybrid", "manual"] | None = Query(default=None),
    sort: Literal["relevance", "code", "title"] = Query(
        default="relevance",
        description="Sort order: relevance (default), code, or title",
        examples=["relevance", "code", "title"],
    ),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
) -> UnifiedSearchResponse:
    filters: dict[str, str] = {}
    if type is not None:
        filters["type"] = type
    if domain is not None:
        filters["domain"] = domain
    if tier is not None:
        filters["tier"] = tier
    if jurisdiction is not None:
        filters["jurisdiction"] = jurisdiction
    if measurement_mode is not None:
        filters["measurement_mode"] = measurement_mode

    try:
        adapter = get_search_adapter(index_name="governance-catalog")
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    order_by = _search_order_by(sort)
    page_rows, total_count = await adapter.search(
        query=q,
        filters=filters or None,
        top=limit,
        skip=skip,
        order_by=order_by,
        include_total_count=True,
    )

    items = [SearchResultItem(**row) for row in page_rows]
    facets = _build_facets(
        rows=page_rows,
        fields=["type", "domain", "tier", "jurisdiction", "measurement_mode", "source"],
    )

    return UnifiedSearchResponse(
        items=items,
        total=int(total_count) if total_count is not None else len(page_rows),
        skip=skip,
        limit=limit,
        facets=facets,
    )


@router.get("/catalog/autocomplete", response_model=AutocompleteResponse)
async def autocomplete(
    q: str = Query(..., min_length=1, max_length=120, description="Prefix or phrase for suggestions"),
    type: Literal["control", "requirement"] | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=50),
) -> AutocompleteResponse:
    filters: dict[str, str] = {}
    if type is not None:
        filters["type"] = type

    try:
        adapter = get_search_adapter(index_name="governance-catalog")
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    raw_results, _ = await adapter.search(
        query=q,
        filters=filters or None,
        top=skip + limit,
    )

    all_candidates = _build_autocomplete_candidates(raw_results)
    page = all_candidates[skip : skip + limit]

    return AutocompleteResponse(
        items=page,
        total=len(all_candidates),
        skip=skip,
        limit=limit,
    )


@router.get(
    "/catalog/interpretations",
    response_model=InterpretationListResponse | InterpretationTreeResponse,
)
async def list_interpretations(
    requirement_id: UUID | None = Query(default=None, description="Filter by requirement UUID"),
    layer: Literal["SOURCE", "SYSTEM", "USER"] | None = Query(default=None),
    view: Literal["flat", "tree"] = Query(
        default="flat",
        description="Response shape: flat list or grouped tree",
    ),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_db_session),
) -> InterpretationListResponse | InterpretationTreeResponse:
    where_clause, params = _interpretation_filters(requirement_id=requirement_id, layer=layer)

    if view == "tree":
        rows_result = await session.execute(
            text(
                f"""
                SELECT
                    ri.id::text AS id,
                    ri.requirement_id::text AS requirement_id,
                    ri.layer::text AS layer,
                    ri.content AS content,
                    ri.version AS version,
                    ri.created_at AS created_at
                FROM risk_interpretation ri
                {where_clause}
                ORDER BY
                    ri.requirement_id::text,
                    ri.layer::text,
                    ri.version DESC NULLS LAST,
                    ri.created_at DESC NULLS LAST
                """
            ),
            params,
        )
        rows = rows_result.mappings().all()
        full_tree = _build_interpretation_tree(rows)
        page = full_tree[skip : skip + limit]

        return InterpretationTreeResponse(
            items=page,
            total_requirements=len(full_tree),
            skip=skip,
            limit=limit,
        )

    count_result = await session.execute(
        text(
            f"""
            SELECT COUNT(*) AS total
            FROM risk_interpretation ri
            {where_clause}
            """
        ),
        params,
    )
    total = int(count_result.scalar_one())

    page_params = {**params, "skip": skip, "limit": limit}
    rows_result = await session.execute(
        text(
            f"""
            SELECT
                ri.id::text AS id,
                ri.requirement_id::text AS requirement_id,
                ri.layer::text AS layer,
                ri.content AS content,
                ri.version AS version,
                ri.created_at AS created_at
            FROM risk_interpretation ri
            {where_clause}
            ORDER BY ri.created_at DESC NULLS LAST, ri.version DESC NULLS LAST
            OFFSET :skip
            LIMIT :limit
            """
        ),
        page_params,
    )
    items = [InterpretationItem(**row) for row in rows_result.mappings().all()]

    return InterpretationListResponse(items=items, total=total, skip=skip, limit=limit)


@router.get(
    "/catalog/admin/policies/search",
    response_model=AdminPolicySearchResponse,
)
async def admin_search_policies(
    q: str = Query(..., min_length=1, max_length=160),
    limit: int = Query(default=15, ge=1, le=50),
    _admin_scope: None = Depends(require_governance_admin_scope),
    session: AsyncSession = Depends(get_db_session),
) -> AdminPolicySearchResponse:
    query = f"%{q.strip()}%"
    rows_result = await session.execute(
        text(
            """
            SELECT
                reg.id::text AS id,
                reg.title AS title,
                reg.jurisdiction AS jurisdiction,
                reg.source AS source,
                reg.description AS description,
                reg.policy_type AS policy_type,
                reg.policy_status AS policy_status,
                COUNT(r.id) AS requirement_count
            FROM regulation reg
            LEFT JOIN requirement r ON r.regulation_id = reg.id
            WHERE LOWER(reg.title) LIKE LOWER(:query)
               OR LOWER(COALESCE(reg.jurisdiction, '')) LIKE LOWER(:query)
               OR LOWER(COALESCE(reg.source, '')) LIKE LOWER(:query)
               OR LOWER(COALESCE(reg.description, '')) LIKE LOWER(:query)
            GROUP BY reg.id, reg.title, reg.jurisdiction, reg.source, reg.description, reg.policy_type, reg.policy_status
            ORDER BY reg.title
            LIMIT :limit
            """
        ),
        {"query": query, "limit": limit},
    )
    items = [
        AdminPolicySearchItem(
            id=row["id"],
            title=row["title"],
            jurisdiction=row.get("jurisdiction"),
            source=row.get("source"),
            description=row.get("description"),
            policy_type=row.get("policy_type"),
            policy_status=row.get("policy_status"),
            requirement_count=int(row.get("requirement_count") or 0),
        )
        for row in rows_result.mappings().all()
    ]
    return AdminPolicySearchResponse(items=items, total=len(items))


@router.get(
    "/catalog/admin/requirements/search",
    response_model=AdminRequirementQuickSearchResponse,
)
async def admin_search_requirements(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(default=15, ge=1, le=50),
    _admin_scope: None = Depends(require_governance_admin_scope),
    session: AsyncSession = Depends(get_db_session),
) -> AdminRequirementQuickSearchResponse:
    query = f"%{q.strip()}%"
    rows_result = await session.execute(
        text(
            """
            SELECT
                r.id::text AS id,
                r.title AS title,
                r.description AS description,
                r.category AS category,
                r.regulation_id::text AS regulation_id,
                reg.title AS regulation_title,
                reg.jurisdiction AS jurisdiction,
                reg.source AS policy_source,
                reg.policy_type AS policy_type,
                COALESCE(NULLIF(TRIM(r.status), ''), NULLIF(TRIM(reg.policy_status), ''), 'Active') AS policy_status,
                r.risk_statement AS risk_statement
            FROM requirement r
            LEFT JOIN regulation reg ON reg.id = r.regulation_id
            WHERE LOWER(r.title) LIKE LOWER(:query)
               OR LOWER(COALESCE(r.description, '')) LIKE LOWER(:query)
               OR LOWER(COALESCE(reg.title, '')) LIKE LOWER(:query)
            ORDER BY r.title
            LIMIT :limit
            """
        ),
        {"query": query, "limit": limit},
    )
    items = [AdminRequirementQuickSearchItem(**row) for row in rows_result.mappings().all()]
    return AdminRequirementQuickSearchResponse(items=items, total=len(items))


@router.get(
    "/catalog/admin/system-kpis",
    response_model=list[AdminSystemKpiItem],
)
async def admin_list_system_kpis(
    _admin_scope: None = Depends(require_governance_admin_scope),
    session: AsyncSession = Depends(get_db_session),
) -> list[AdminSystemKpiItem]:
    metric_rows = await session.execute(
        text(
            """
            SELECT
                cmd.metric_name AS metric_name,
                cmd.threshold AS threshold,
                mf.expression_preview AS expression_preview,
                mf.operator AS operator,
                mf.window AS window,
                mf.aggregation AS aggregation,
                mf.approved AS approved,
                mf.approved_at AS approved_at
            FROM control_metric_definition cmd
            LEFT JOIN measure_formula mf
                ON mf.control_metric_definition_id = cmd.id
            WHERE COALESCE(TRIM(cmd.metric_name), '') <> ''
            ORDER BY
                cmd.metric_name,
                mf.approved DESC NULLS LAST,
                mf.approved_at DESC NULLS LAST
            """
        )
    )
    attribute_rows = await session.execute(
        text(
            """
            SELECT
                asa.attribute_name AS attribute_name,
                asa.description AS description,
                asa.source::text AS source
            FROM approved_system_attributes asa
            WHERE asa.is_active = TRUE
              AND asa.source::text = 'otel_metric'
            ORDER BY asa.attribute_name
            """
        )
    )

    by_metric: dict[str, dict[str, Any]] = {}
    for row in metric_rows.mappings().all():
        metric_name = (row.get("metric_name") or "").strip()
        if not metric_name:
            continue
        if metric_name in by_metric:
            continue
        threshold_value = row.get("threshold")
        if isinstance(threshold_value, str):
            try:
                threshold_value = json.loads(threshold_value)
            except Exception:
                threshold_value = None
        if not isinstance(threshold_value, dict):
            threshold_value = None
        by_metric[metric_name] = {
            "metric_name": metric_name,
            "description": None,
            "expression_preview": row.get("expression_preview"),
            "threshold": threshold_value,
            "operator": row.get("operator"),
            "window": row.get("window"),
            "aggregation": row.get("aggregation"),
            "source": "control_metric_definition",
        }

    for row in attribute_rows.mappings().all():
        metric_name = (row.get("attribute_name") or "").strip()
        if not metric_name:
            continue
        if metric_name not in by_metric:
            by_metric[metric_name] = {
                "metric_name": metric_name,
                "description": row.get("description"),
                "expression_preview": None,
                "threshold": None,
                "operator": None,
                "window": None,
                "aggregation": None,
                "source": row.get("source") or "approved_system_attributes",
            }
        elif not by_metric[metric_name].get("description"):
            by_metric[metric_name]["description"] = row.get("description")
            by_metric[metric_name]["source"] = row.get("source") or by_metric[metric_name]["source"]

    def _label(metric_name: str, description: str | None) -> str:
        if description and description.strip():
            return description.strip()
        return metric_name.replace("ai.", "").replace(".", " ").replace("_", " ").title()

    return [
        AdminSystemKpiItem(
            metric_name=metric_name,
            label=_label(metric_name, row.get("description")),
            description=row.get("description"),
            expression_preview=row.get("expression_preview"),
            threshold=row.get("threshold"),
            operator=row.get("operator"),
            window=row.get("window"),
            aggregation=row.get("aggregation"),
            source=row.get("source") or "catalog",
        )
        for metric_name, row in sorted(by_metric.items(), key=lambda item: item[0])
    ]


@router.post(
    "/catalog/admin/requirements/save",
    response_model=AdminRequirementSaveResponse,
)
async def admin_save_requirement_record(
    payload: AdminRequirementSaveRequest,
    _admin_scope: None = Depends(require_governance_admin_scope),
    session: AsyncSession = Depends(get_db_session),
) -> AdminRequirementSaveResponse:
    now = datetime.utcnow()
    actor = (payload.set_by or "governance_admin").strip() or "governance_admin"
    placement = payload.placement

    if payload.control_measure_type == "system_telemetry" and not (payload.metric_name or "").strip():
        raise HTTPException(status_code=422, detail="metric_name is required for system_telemetry control measures")

    resolved_requirement_type = placement.requirement_type
    resolved_dashboard_inclusion = "baseline" if resolved_requirement_type == "baseline" else "assigned"
    resolved_apply_to_all_apps = resolved_requirement_type == "baseline"

    if resolved_requirement_type == "application_specific" and not placement.application_ids:
        raise HTTPException(status_code=422, detail="application_specific requirements must select at least one application")

    try:
        regulation_id = str(payload.policy_id) if payload.policy_id else None
        jurisdiction = payload.policy_jurisdiction.strip()
        policy_source = payload.policy_source.strip()
        policy_description = payload.policy_description.strip()
        policy_type = payload.policy_type.strip()
        policy_status = payload.policy_status.strip()

        if regulation_id:
            existing_reg = await session.execute(
                text("SELECT 1 FROM regulation WHERE id::text = :id"),
                {"id": regulation_id},
            )
            if existing_reg.first() is None:
                raise HTTPException(status_code=404, detail="Policy record not found")
            await session.execute(
                text(
                    """
                    UPDATE regulation
                    SET title = :title,
                        jurisdiction = :jurisdiction,
                        source = :source,
                        description = :description,
                        policy_type = :policy_type,
                        policy_status = :policy_status
                    WHERE id::text = :id
                    """
                ),
                {
                    "id": regulation_id,
                    "title": payload.policy_title.strip(),
                    "jurisdiction": jurisdiction,
                    "source": policy_source,
                    "description": policy_description,
                    "policy_type": policy_type,
                    "policy_status": policy_status,
                },
            )
        else:
            reg_lookup = await session.execute(
                text(
                    """
                    SELECT reg.id::text AS id
                    FROM regulation reg
                    WHERE LOWER(reg.title) = LOWER(:title)
                      AND LOWER(COALESCE(reg.jurisdiction, '')) = LOWER(COALESCE(:jurisdiction, ''))
                    LIMIT 1
                    """
                ),
                {
                    "title": payload.policy_title.strip(),
                    "jurisdiction": jurisdiction,
                },
            )
            reg_row = reg_lookup.mappings().first()
            if reg_row:
                regulation_id = reg_row["id"]
            else:
                regulation_id = str(uuid4())
                await session.execute(
                    text(
                        """
                        INSERT INTO regulation (
                            id, title, jurisdiction, source, description, policy_type, policy_status, source_url, effective_date, created_at
                        ) VALUES (
                            :id, :title, :jurisdiction, :source, :description, :policy_type, :policy_status, NULL, NULL, :created_at
                        )
                        """
                    ),
                    {
                        "id": regulation_id,
                        "title": payload.policy_title.strip(),
                        "jurisdiction": jurisdiction,
                        "source": policy_source,
                        "description": policy_description,
                        "policy_type": policy_type,
                        "policy_status": policy_status,
                        "created_at": now,
                    },
                )

        requirement_id = str(payload.requirement_id) if payload.requirement_id else None
        if requirement_id:
            req_exists = await session.execute(
                text("SELECT 1 FROM requirement WHERE id::text = :id"),
                {"id": requirement_id},
            )
            if req_exists.first() is None:
                raise HTTPException(status_code=404, detail="Requirement not found")
            await session.execute(
                text(
                    """
                    UPDATE requirement
                    SET regulation_id = :regulation_id,
                        title = :title,
                        description = :description,
                        category = :category,
                        status = :status,
                        risk_statement = :risk_statement
                    WHERE id::text = :id
                    """
                ),
                {
                    "id": requirement_id,
                    "regulation_id": regulation_id,
                    "title": payload.requirement_title.strip(),
                    "description": payload.requirement_description.strip(),
                    "category": payload.governance_category.strip(),
                    "status": policy_status,
                    "risk_statement": payload.risk_statement.strip(),
                },
            )
        else:
            requirement_id = str(uuid4())
            requirement_code = await _generate_unique_code(
                session,
                table_name="requirement",
                prefix="REQ",
            )
            await session.execute(
                text(
                    """
                    INSERT INTO requirement (
                        id, regulation_id, code, title, description, category, status, risk_statement
                    ) VALUES (
                        :id, :regulation_id, :code, :title, :description, :category, :status, :risk_statement
                    )
                    """
                ),
                {
                    "id": requirement_id,
                    "regulation_id": regulation_id,
                    "code": requirement_code,
                    "title": payload.requirement_title.strip(),
                    "description": payload.requirement_description.strip(),
                    "category": payload.governance_category.strip(),
                    "status": policy_status,
                    "risk_statement": payload.risk_statement.strip(),
                },
            )

        existing_link = await session.execute(
            text(
                """
                SELECT cr.control_id::text AS control_id
                FROM control_requirement cr
                WHERE cr.requirement_id::text = :requirement_id
                ORDER BY cr.control_id::text
                LIMIT 1
                """
            ),
            {"requirement_id": requirement_id},
        )
        existing_link_row = existing_link.mappings().first()
        control_id = str(payload.control_id) if payload.control_id else (existing_link_row.get("control_id") if existing_link_row else None)

        control_is_foundation = resolved_dashboard_inclusion == "baseline"
        control_tier = "FOUNDATION" if control_is_foundation else "COMMON"
        control_measurement_mode = (
            "manual"
            if payload.control_measure_type == "evidence_based"
            else "system_calculated"
        )

        if control_id:
            control_exists = await session.execute(
                text("SELECT 1 FROM control WHERE id::text = :id"),
                {"id": control_id},
            )
            if control_exists.first() is None:
                raise HTTPException(status_code=404, detail="Control not found")
            await session.execute(
                text(
                    """
                    UPDATE control
                    SET title = :title,
                        description = :description,
                        domain = :domain,
                        tier = :tier,
                        is_foundation = :is_foundation,
                        measurement_mode = :measurement_mode
                    WHERE id::text = :id
                    """
                ),
                {
                    "id": control_id,
                    "title": payload.control_title.strip(),
                    "description": (payload.control_description or "").strip() or None,
                    "domain": payload.governance_category.strip(),
                    "tier": control_tier,
                    "is_foundation": control_is_foundation,
                    "measurement_mode": control_measurement_mode,
                },
            )
        else:
            control_id = str(uuid4())
            control_code = await _generate_unique_code(
                session,
                table_name="control",
                prefix="CTL",
            )
            await session.execute(
                text(
                    """
                    INSERT INTO control (
                        id, code, title, description, domain, tier, is_foundation, measurement_mode
                    ) VALUES (
                        :id, :code, :title, :description, :domain, :tier, :is_foundation, :measurement_mode
                    )
                    """
                ),
                {
                    "id": control_id,
                    "code": control_code,
                    "title": payload.control_title.strip(),
                    "description": (payload.control_description or "").strip() or None,
                    "domain": payload.governance_category.strip(),
                    "tier": control_tier,
                    "is_foundation": control_is_foundation,
                    "measurement_mode": control_measurement_mode,
                },
            )

        await session.execute(
            text(
                """
                DELETE FROM control_requirement
                WHERE requirement_id::text = :requirement_id
                  AND control_id::text <> :control_id
                """
            ),
            {
                "requirement_id": requirement_id,
                "control_id": control_id,
            },
        )
        link_exists = await session.execute(
            text(
                """
                SELECT 1
                FROM control_requirement
                WHERE requirement_id::text = :requirement_id
                  AND control_id::text = :control_id
                """
            ),
            {
                "requirement_id": requirement_id,
                "control_id": control_id,
            },
        )
        if link_exists.first() is None:
            await session.execute(
                text(
                    """
                    INSERT INTO control_requirement (control_id, requirement_id)
                    VALUES (:control_id, :requirement_id)
                    """
                ),
                {
                    "control_id": control_id,
                    "requirement_id": requirement_id,
                },
            )

        await session.execute(
            text("DELETE FROM control_lifecycle_tag WHERE control_id::text = :control_id AND approved = TRUE"),
            {"control_id": control_id},
        )
        await session.execute(
            text(
                """
                INSERT INTO control_lifecycle_tag (
                    id,
                    control_id,
                    tag,
                    confidence_score,
                    suggested_by,
                    reviewed_by,
                    approved,
                    created_at
                ) VALUES (
                    :id,
                    :control_id,
                    :tag,
                    :confidence_score,
                    :suggested_by,
                    :reviewed_by,
                    :approved,
                    :created_at
                )
                """
            ),
            {
                "id": str(uuid4()),
                "control_id": control_id,
                "tag": _lifecycle_tag_for_category(payload.governance_category),
                "confidence_score": 1.0,
                "suggested_by": "human",
                "reviewed_by": actor,
                "approved": True,
                "created_at": now,
            },
        )

        metric_definition_id: str | None = None
        metric_name = (payload.metric_name or "").strip()
        if metric_name:
            canonical_metric = None
            if payload.control_measure_type == "system_telemetry":
                canonical_metric_result = await session.execute(
                    text(
                        """
                        SELECT
                            cmd.threshold AS threshold,
                            mf.expression_preview AS expression_preview,
                            mf.operator AS formula_operator
                        FROM control_metric_definition cmd
                        LEFT JOIN measure_formula mf
                            ON mf.control_metric_definition_id = cmd.id
                        WHERE cmd.metric_name = :metric_name
                        ORDER BY mf.approved DESC NULLS LAST, mf.approved_at DESC NULLS LAST
                        LIMIT 1
                        """
                    ),
                    {"metric_name": metric_name},
                )
                canonical_metric = canonical_metric_result.mappings().first()
                # Allow Secretariat/Admin flows to register new telemetry KPI names.
                # If no canonical metric exists yet, the row created below becomes the canonical registry record.

            default_threshold = {
                "operator": "lte" if payload.control_measure_type == "system_telemetry" else "eq",
                "value": 1 if payload.control_measure_type == "evidence_based" else 80,
                "unit": "%",
            }
            threshold = (
                canonical_metric.get("threshold")
                if payload.control_measure_type == "system_telemetry" and canonical_metric
                else (payload.threshold or default_threshold)
            )
            if isinstance(threshold, str):
                try:
                    threshold = json.loads(threshold)
                except json.JSONDecodeError:
                    threshold = default_threshold
            if not isinstance(threshold, dict):
                threshold = default_threshold
            threshold_payload = json.dumps(threshold)
            metric_row_result = await session.execute(
                text(
                    """
                    SELECT cmd.id::text AS id
                    FROM control_metric_definition cmd
                    WHERE cmd.control_id::text = :control_id
                      AND cmd.metric_name = :metric_name
                    LIMIT 1
                    """
                ),
                {
                    "control_id": control_id,
                    "metric_name": metric_name,
                },
            )
            metric_row = metric_row_result.mappings().first()
            if metric_row:
                metric_definition_id = metric_row["id"]
                await session.execute(
                    text(
                        """
                        UPDATE control_metric_definition
                        SET threshold = CAST(:threshold AS jsonb),
                            is_manual = :is_manual
                        WHERE id::text = :id
                        """
                    ),
                    {
                        "id": metric_definition_id,
                        "threshold": threshold_payload,
                        "is_manual": payload.control_measure_type == "evidence_based",
                    },
                )
            else:
                metric_definition_id = str(uuid4())
                await session.execute(
                    text(
                        """
                        INSERT INTO control_metric_definition (
                            id, control_id, metric_name, threshold, is_manual
                        ) VALUES (
                            :id, :control_id, :metric_name, CAST(:threshold AS jsonb), :is_manual
                        )
                        """
                    ),
                    {
                        "id": metric_definition_id,
                        "control_id": control_id,
                        "metric_name": metric_name,
                        "threshold": threshold_payload,
                        "is_manual": payload.control_measure_type == "evidence_based",
                    },
                )

            payload_expression = (payload.formula_expression or "").strip()
            expression_preview = payload_expression or (
                (canonical_metric.get("expression_preview") if canonical_metric else None)
                if payload.control_measure_type == "system_telemetry"
                else None
            )
            if not expression_preview:
                expression_preview = (payload.formula_expression or "").strip() or (
                    f"latest({metric_name})" if payload.control_measure_type == "system_telemetry" else "manual(evidence_flag)"
                )
            interpretation_template = (
                f"This control is measured by {metric_name}. "
                "The latest value is compared with the configured threshold to determine governance status."
            )
            formula_operator = (
                (canonical_metric.get("formula_operator") if canonical_metric else None)
                if payload.control_measure_type == "system_telemetry"
                else None
            )
            formula_row = await session.execute(
                text(
                    """
                    SELECT mf.id::text AS id
                    FROM measure_formula mf
                    WHERE mf.control_metric_definition_id::text = :metric_definition_id
                    LIMIT 1
                    """
                ),
                {"metric_definition_id": metric_definition_id},
            )
            formula = formula_row.mappings().first()
            if formula:
                await session.execute(
                    text(
                        """
                        UPDATE measure_formula
                        SET field_picker = :field_picker,
                            operator = :operator,
                            "window" = :window,
                            aggregation = :aggregation,
                            expression_preview = :expression_preview,
                            interpretation_template = :interpretation_template,
                            approved = TRUE,
                            approved_by = :approved_by,
                            approved_at = :approved_at
                        WHERE id::text = :id
                        """
                    ),
                    {
                        "id": formula["id"],
                        "field_picker": metric_name,
                        "operator": formula_operator or (threshold or {}).get("operator") or "lte",
                        "window": "24h",
                        "aggregation": "latest",
                        "expression_preview": expression_preview,
                        "interpretation_template": interpretation_template,
                        "approved_by": actor,
                        "approved_at": now,
                    },
                )
            else:
                await session.execute(
                    text(
                        """
                        INSERT INTO measure_formula (
                            id,
                            control_metric_definition_id,
                            field_picker,
                            operator,
                            "window",
                            aggregation,
                            expression_preview,
                            interpretation_template,
                            interpretation_generated,
                            interpretation_approved,
                            approved,
                            approved_by,
                            approved_at,
                            created_at
                        ) VALUES (
                            :id,
                            :metric_definition_id,
                            :field_picker,
                            :operator,
                            :window,
                            :aggregation,
                            :expression_preview,
                            :interpretation_template,
                            NULL,
                            FALSE,
                            TRUE,
                            :approved_by,
                            :approved_at,
                            :created_at
                        )
                        """
                    ),
                    {
                        "id": str(uuid4()),
                        "metric_definition_id": metric_definition_id,
                        "field_picker": metric_name,
                        "operator": formula_operator or (threshold or {}).get("operator") or "lte",
                        "window": "24h",
                        "aggregation": "latest",
                        "expression_preview": expression_preview,
                        "interpretation_template": interpretation_template,
                        "approved_by": actor,
                        "approved_at": now,
                        "created_at": now,
                    },
                )

        target_app_ids = [str(app_id) for app_id in placement.application_ids]
        if resolved_apply_to_all_apps:
            all_apps = await session.execute(
                text(
                    """
                    SELECT a.id::text AS id
                    FROM application a
                    WHERE LOWER(COALESCE(a.status, 'active')) <> 'disconnected'
                    ORDER BY a.name
                    """
                )
            )
            target_app_ids = [row["id"] for row in all_apps.mappings().all()]

        existing_assignments_result = await session.execute(
            text(
                """
                SELECT
                    ar.id::text AS id,
                    ar.application_id::text AS application_id
                FROM application_requirement ar
                WHERE ar.requirement_id::text = :requirement_id
                """
            ),
            {"requirement_id": requirement_id},
        )
        existing_assignments = {
            row["application_id"]: row["id"]
            for row in existing_assignments_result.mappings().all()
        }
        target_set = set(target_app_ids)
        existing_set = set(existing_assignments.keys())

        for remove_app_id in sorted(existing_set - target_set):
            await session.execute(
                text("DELETE FROM application_requirement WHERE id::text = :id"),
                {"id": existing_assignments[remove_app_id]},
            )

        is_default = resolved_dashboard_inclusion == "baseline"
        for keep_app_id in sorted(existing_set & target_set):
            await session.execute(
                text(
                    """
                    UPDATE application_requirement
                    SET is_default = :is_default,
                        added_by = :added_by,
                        added_at = :added_at
                    WHERE id::text = :id
                    """
                ),
                {
                    "id": existing_assignments[keep_app_id],
                    "is_default": is_default,
                    "added_by": actor,
                    "added_at": now,
                },
            )

        for add_app_id in sorted(target_set - existing_set):
            await session.execute(
                text(
                    """
                    INSERT INTO application_requirement (
                        id,
                        application_id,
                        requirement_id,
                        selected_at,
                        is_default,
                        added_by,
                        added_at
                    ) VALUES (
                        :id,
                        :application_id,
                        :requirement_id,
                        :selected_at,
                        :is_default,
                        :added_by,
                        :added_at
                    )
                    """
                ),
                {
                    "id": str(uuid4()),
                    "application_id": add_app_id,
                    "requirement_id": requirement_id,
                    "selected_at": now,
                    "is_default": is_default,
                    "added_by": actor,
                    "added_at": now,
                },
            )

        assigned_count = len(target_set)

        await session.commit()
        return AdminRequirementSaveResponse(
            requirement_id=requirement_id,
            control_id=control_id,
            policy_id=regulation_id,
            metric_definition_id=metric_definition_id,
            assigned_app_count=assigned_count,
            dashboard_inclusion=resolved_dashboard_inclusion,
            requirement_type=resolved_requirement_type,
        )
    except HTTPException:
        await session.rollback()
        raise
    except Exception as exc:
        await session.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save requirement record: {exc}") from exc


@router.delete(
    "/catalog/admin/requirements/{requirement_id}",
    response_model=AdminRequirementDeleteResponse,
)
async def admin_delete_requirement_record(
    requirement_id: UUID,
    _admin_scope: None = Depends(require_governance_admin_scope),
    session: AsyncSession = Depends(get_db_session),
) -> AdminRequirementDeleteResponse:
    requirement_id_text = str(requirement_id)
    try:
        exists = await session.execute(
            text("SELECT 1 FROM requirement WHERE id::text = :id"),
            {"id": requirement_id_text},
        )
        if exists.first() is None:
            raise HTTPException(status_code=404, detail="Requirement not found")

        linked_controls_result = await session.execute(
            text(
                """
                SELECT cr.control_id::text AS control_id
                FROM control_requirement cr
                WHERE cr.requirement_id::text = :id
                """
            ),
            {"id": requirement_id_text},
        )
        linked_controls = [row["control_id"] for row in linked_controls_result.mappings().all()]

        interpretation_ids_result = await session.execute(
            text(
                """
                SELECT ri.id::text AS id
                FROM risk_interpretation ri
                WHERE ri.requirement_id::text = :id
                """
            ),
            {"id": requirement_id_text},
        )
        interpretation_ids = [row["id"] for row in interpretation_ids_result.mappings().all()]

        for interp_id in interpretation_ids:
            await session.execute(
                text("DELETE FROM interpretation_divergence_signal WHERE interpretation_id::text = :id"),
                {"id": interp_id},
            )

        await session.execute(
            text("DELETE FROM app_interpretation WHERE requirement_id::text = :id"),
            {"id": requirement_id_text},
        )
        await session.execute(
            text("DELETE FROM application_requirement WHERE requirement_id::text = :id"),
            {"id": requirement_id_text},
        )
        await session.execute(
            text("DELETE FROM risk_interpretation WHERE requirement_id::text = :id"),
            {"id": requirement_id_text},
        )
        await session.execute(
            text("DELETE FROM control_requirement WHERE requirement_id::text = :id"),
            {"id": requirement_id_text},
        )
        await session.execute(
            text("DELETE FROM requirement WHERE id::text = :id"),
            {"id": requirement_id_text},
        )

        for control_id in linked_controls:
            remaining = await session.execute(
                text("SELECT 1 FROM control_requirement WHERE control_id::text = :control_id LIMIT 1"),
                {"control_id": control_id},
            )
            if remaining.first() is not None:
                continue

            metric_ids_result = await session.execute(
                text(
                    """
                    SELECT cmd.id::text AS id
                    FROM control_metric_definition cmd
                    WHERE cmd.control_id::text = :control_id
                    """
                ),
                {"control_id": control_id},
            )
            metric_ids = [row["id"] for row in metric_ids_result.mappings().all()]
            for metric_id in metric_ids:
                await session.execute(
                    text("DELETE FROM measure_formula WHERE control_metric_definition_id::text = :id"),
                    {"id": metric_id},
                )

            await session.execute(
                text("DELETE FROM control_metric_definition WHERE control_id::text = :control_id"),
                {"control_id": control_id},
            )
            await session.execute(
                text("DELETE FROM control_lifecycle_tag WHERE control_id::text = :control_id"),
                {"control_id": control_id},
            )
            await session.execute(
                text("DELETE FROM control_tags WHERE control_id::text = :control_id"),
                {"control_id": control_id},
            )
            await session.execute(
                text("DELETE FROM control_assignment WHERE control_id::text = :control_id"),
                {"control_id": control_id},
            )
            await session.execute(
                text("DELETE FROM calculated_metric WHERE control_id::text = :control_id"),
                {"control_id": control_id},
            )
            await session.execute(
                text("DELETE FROM control_calculation_proposal WHERE control_id::text = :control_id"),
                {"control_id": control_id},
            )
            await session.execute(
                text("DELETE FROM app_interpretation WHERE control_id::text = :control_id"),
                {"control_id": control_id},
            )
            await session.execute(
                text("DELETE FROM control WHERE id::text = :control_id"),
                {"control_id": control_id},
            )

        await session.commit()
        return AdminRequirementDeleteResponse(requirement_id=requirement_id_text, deleted=True)
    except HTTPException:
        await session.rollback()
        raise
    except Exception as exc:
        await session.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete requirement record: {exc}") from exc


@router.patch(
    "/catalog/admin/requirements/{requirement_id}/status",
    response_model=AdminRequirementStatusUpdateResponse,
)
async def admin_update_requirement_status(
    requirement_id: UUID,
    payload: AdminRequirementStatusUpdateRequest,
    _admin_scope: None = Depends(require_governance_admin_scope),
    session: AsyncSession = Depends(get_db_session),
) -> AdminRequirementStatusUpdateResponse:
    requirement_id_text = str(requirement_id)
    target_status = str(payload.policy_status or "").strip().title()
    if target_status not in {"Active", "Inactive"}:
        raise HTTPException(status_code=422, detail="policy_status must be Active or Inactive")

    try:
        row_result = await session.execute(
            text(
                """
                SELECT
                    r.id::text AS requirement_id,
                    r.regulation_id::text AS regulation_id
                FROM requirement r
                WHERE r.id::text = :requirement_id
                """
            ),
            {"requirement_id": requirement_id_text},
        )
        row = row_result.mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail="Requirement not found")

        regulation_id = str(row["regulation_id"])
        await session.execute(
            text(
                """
                UPDATE requirement
                SET status = :policy_status
                WHERE id::text = :requirement_id
                """
            ),
            {
                "policy_status": target_status,
                "requirement_id": requirement_id_text,
            },
        )
        await session.commit()
        return AdminRequirementStatusUpdateResponse(
            requirement_id=requirement_id_text,
            regulation_id=regulation_id,
            policy_status=target_status,
        )
    except HTTPException:
        await session.rollback()
        raise
    except Exception as exc:
        await session.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update requirement status: {exc}") from exc


@router.post(
    "/catalog/interpretations",
    status_code=201,
    response_model=InterpretationItem,
    summary="Create interpretation",
    description=(
        "Creates a new interpretation version for a requirement/layer pair. "
        "If ENFORCE_ADMIN_SCOPE_CHECK=true, send header "
        "X-Governance-Scopes including governance.admin."
    ),
    responses={403: {"description": "governance.admin scope required"}},
)
async def create_interpretation(
    payload: InterpretationCreateRequest,
    _admin_scope: None = Depends(require_governance_admin_scope),
    session: AsyncSession = Depends(get_db_session),
) -> InterpretationItem:
    """Create an interpretation row and auto-increment version by requirement+layer."""
    requirement_result = await session.execute(
        text(
            """
            SELECT 1
            FROM requirement r
            WHERE r.id::text = :requirement_id
            """
        ),
        {"requirement_id": str(payload.requirement_id)},
    )
    if requirement_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Requirement not found")

    next_version_result = await session.execute(
        text(
            """
            SELECT COALESCE(MAX(ri.version), 0) + 1 AS next_version
            FROM risk_interpretation ri
            WHERE ri.requirement_id::text = :requirement_id
              AND ri.layer::text = :layer
            """
        ),
        {
            "requirement_id": str(payload.requirement_id),
            "layer": payload.layer,
        },
    )
    next_version = int(next_version_result.scalar_one())
    now = datetime.utcnow()

    created_result = await session.execute(
        text(
            """
            INSERT INTO risk_interpretation (
                id,
                requirement_id,
                layer,
                content,
                version,
                created_at
            )
            VALUES (
                :id,
                :requirement_id,
                :layer,
                :content,
                :version,
                :created_at
            )
            RETURNING
                id::text AS id,
                requirement_id::text AS requirement_id,
                layer::text AS layer,
                content AS content,
                version AS version,
                created_at AS created_at
            """
        ),
        {
            "id": str(uuid4()),
            "requirement_id": str(payload.requirement_id),
            "layer": payload.layer,
            "content": payload.content,
            "version": next_version,
            "created_at": now,
        },
    )
    await session.commit()

    row = created_result.mappings().first()
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to create interpretation")
    return InterpretationItem(**row)
