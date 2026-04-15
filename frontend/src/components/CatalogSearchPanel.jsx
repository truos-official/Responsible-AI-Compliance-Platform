import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";

import {
  deleteAdminRequirementRecord,
  getCatalogItemDetail,
  listAdminSystemKpis,
  listControls,
  listRequirements,
  saveAdminRequirementRecord,
  updateAdminRequirementStatus,
} from "../api/catalogClient";
import { api } from "../api/client";
import { useApp } from "../context/AppContext";

const PAGE_SIZE = 5;
const REQUIREMENTS_PAGE_LIMIT = 200;

const STEP_BY_CATEGORY = {
  "Corporate Oversight": 1,
  "Risk & Compliance": 2,
  "Technical Architecture": 3,
  "Data Readiness": 4,
  "Data Integration": 5,
  Security: 6,
  Infrastructure: 7,
  "Solution Design": 8,
  "System Performance": 9,
};

const DASHBOARD_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const GOVERNANCE_CATEGORIES = Object.keys(STEP_BY_CATEGORY);
const POLICY_TYPE_OPTIONS = [
  "Global Policy",
  "Region Specific Policy",
  "Domain Specific Policy",
  "Enterprise Policy",
  "Divisional Policy",
  "Application Policy",
];
const ADMIN_FORM_STEPS = [
  "Define Requirement and Scope",
  "Link Policy",
  "Map KPI and Control",
];
const NEW_REQUIREMENT_MARKER_KEY_PREFIX = "aigov.new_requirements";

function newRequirementMarkerStorageKey(appId) {
  return `${NEW_REQUIREMENT_MARKER_KEY_PREFIX}.${String(appId || "").trim()}`;
}

function addNewRequirementMarker(appId, requirementId) {
  const normalizedAppId = String(appId || "").trim();
  const normalizedRequirementId = String(requirementId || "").trim();
  if (!normalizedAppId || !normalizedRequirementId || typeof window === "undefined") return;
  const key = newRequirementMarkerStorageKey(normalizedAppId);
  const raw = window.localStorage.getItem(key);
  let current = [];
  try {
    current = raw ? JSON.parse(raw) : [];
  } catch {
    current = [];
  }
  const merged = Array.from(new Set([...(Array.isArray(current) ? current : []), normalizedRequirementId]));
  window.localStorage.setItem(key, JSON.stringify(merged));
}

function createEmptyAdminDraft(defaultAppId = "") {
  return {
    requirement_id: "",
    policy_id: "",
    policy_title: "",
    policy_jurisdiction: "",
    policy_source: "",
    policy_description: "",
    policy_type: "Global Policy",
    policy_status: "Active",
    requirement_title: "",
    requirement_description: "",
    governance_category: "Risk & Compliance",
    risk_statement: "",
    control_id: "",
    control_title: "",
    control_description: "",
    control_measure_type: "system_telemetry",
    metric_name: "",
    formula_expression: "",
    threshold_operator: "lte",
    threshold_value: "80",
    threshold_unit: "%",
    placement_requirement_type: defaultAppId ? "application_specific" : "baseline",
    placement_dashboard_inclusion: defaultAppId ? "assigned" : "baseline",
    placement_apply_to_all_apps: defaultAppId ? false : true,
    placement_application_ids: defaultAppId ? [defaultAppId] : [],
  };
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalGovernanceCategory(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.includes("corporate") || text.includes("cost") || text.includes("oversight")) return "Corporate Oversight";
  if (text.includes("risk") || text.includes("compliance")) return "Risk & Compliance";
  if (text.includes("technical") || text.includes("architecture")) return "Technical Architecture";
  if (text.includes("data readiness")) return "Data Readiness";
  if (text.includes("data integration") || text.includes("integration")) return "Data Integration";
  if (text === "security" || text.includes("security")) return "Security";
  if (text.includes("infrastructure")) return "Infrastructure";
  if (text.includes("solution") || text.includes("design")) return "Solution Design";
  if (text.includes("system performance") || text.includes("performance") || text.includes("monitoring")) return "System Performance";
  return "";
}

function governanceCategoryFromMetricName(metricName) {
  const key = String(metricName || "").toLowerCase();
  if (!key) return "";
  if (
    key.startsWith("ai.resources.")
    || key.startsWith("ai.governance.")
    || key.startsWith("governance.")
  ) return "Corporate Oversight";
  if (
    key.startsWith("ai.risk.")
    || key.startsWith("ai.transparency.")
    || key.startsWith("ai.disclosure.")
    || key.includes("disclosure")
    || key.includes("doc_completeness")
  ) return "Risk & Compliance";
  if (key.startsWith("ai.rag.") || key.startsWith("ai.model.")) return "Technical Architecture";
  if (
    key.startsWith("ai.data.")
    || key.startsWith("ai.privacy.")
    || key.includes("quality")
    || key.includes("bias")
    || key.includes("consent")
  ) return "Data Readiness";
  if (
    key.startsWith("ai.logs.")
    || key.startsWith("ai.records.")
    || key.includes("pipeline")
    || key.includes("retention")
  ) return "Data Integration";
  if (
    key.startsWith("ai.security.")
    || key.startsWith("ai.access.")
    || key.includes("encryption")
    || key.includes("auth")
    || key.includes("mfa")
    || key.includes("vuln")
    || key.includes("pentest")
  ) return "Security";
  if (
    key.startsWith("ai.robustness.")
    || key.includes("uptime")
    || key.includes("latency")
    || key.includes("compute")
    || key.includes("token_usage")
  ) return "Infrastructure";
  if (
    key.startsWith("ai.fairness.")
    || key.startsWith("ai.explain.")
    || key.startsWith("ai.oversight.")
    || key.includes("satisfaction")
  ) return "Solution Design";
  if (
    key.startsWith("ai.monitoring.")
    || key.startsWith("ai.incident.")
    || key.startsWith("ai.appeals.")
    || key.includes("incident")
    || key.includes("alert")
    || key.includes("response_time")
    || key.includes("drift")
    || key.includes("availability")
    || key.includes("performance")
  ) return "System Performance";
  return "";
}

function humanizeMetricName(metricName) {
  if (!metricName) return "No metric bound";
  return metricName
    .replace(/^ai\./i, "")
    .replace(/[._]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function metricNamePlainEnglish(metricName) {
  const readable = humanizeMetricName(metricName || "");
  return readable || "Telemetry KPI";
}

function isTechnicalTelemetryText(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes("ai.")
    || text.includes("metric:")
    || text.includes("metric_name")
    || text.includes("telemetry live")
    || text.includes("source:")
    || text.includes("latest(")
    || text.includes("mean(")
    || text.includes("p95")
    || text.includes("p50")
    || text.includes("threshold")
    || text.includes("otel")
  );
}

function metricDefinitionPlainEnglish(metricName, description = "", expressionPreview = "") {
  const desc = String(description || "").trim();
  const expr = String(expressionPreview || "").trim();
  const key = String(metricName || "").toLowerCase();

  if (desc && desc.length > 22 && !/^ai[._]/i.test(desc) && !isTechnicalTelemetryText(desc)) {
    return desc;
  }

  if (key.includes("latency")) {
    return "Measures response time from request to answer. Lower values indicate faster system performance.";
  }
  if (key.includes("error")) {
    return "Measures the percentage of requests that fail due to system or model errors.";
  }
  if (key.includes("override")) {
    return "Measures how often human reviewers override AI outputs during supervision.";
  }
  if (key.includes("citation")) {
    return "Measures the percentage of AI answers that include cited source evidence.";
  }
  if (key.includes("hallucination")) {
    return "Measures the estimated rate of unsupported or fabricated AI outputs.";
  }
  if (key.includes("drift")) {
    return "Measures behavior drift versus baseline to detect model quality degradation over time.";
  }
  if (key.includes("uptime")) {
    return "Measures service availability as the percentage of time the AI system is operational.";
  }
  if (key.includes("throughput")) {
    return "Measures how many requests the system can process in a given time window.";
  }
  if (key.includes("cost") && key.includes("token")) {
    return "Measures average cost per token processed for AI workloads.";
  }
  if (key.includes("token")) {
    return "Measures token usage volume for prompts and completions.";
  }
  if (key.includes("coverage")) {
    return "Measures how much of the target scope is covered by this governance signal.";
  }

  if (expr) {
    return "This KPI is calculated automatically from live telemetry using the platform’s predefined formula.";
  }
  return "This KPI is measured automatically from live system telemetry and cannot be manually edited.";
}

function operatorPhrase(operator) {
  const op = String(operator || "").toLowerCase();
  if (op === "lte") return "is less than or equal to";
  if (op === "lt") return "is less than";
  if (op === "gte") return "is greater than or equal to";
  if (op === "gt") return "is greater than";
  if (op === "eq") return "equals";
  if (op === "between") return "falls within";
  return "is evaluated against";
}

function thresholdPlainEnglish(threshold) {
  if (!threshold || typeof threshold !== "object") return "the configured threshold";
  const operator = operatorPhrase(threshold.operator);
  const unit = String(threshold.unit || "").trim();
  const value = threshold.value;
  const minValue = threshold.min_value;
  const maxValue = threshold.max_value;
  if (String(threshold.operator || "").toLowerCase() === "between" && minValue !== undefined && maxValue !== undefined) {
    return `${operator} ${minValue}${unit ? ` ${unit}` : ""} to ${maxValue}${unit ? ` ${unit}` : ""}`;
  }
  if (value === undefined || value === null || value === "") return "the configured threshold";
  return `${operator} ${value}${unit ? ` ${unit}` : ""}`;
}

function metricCalculationNarrative(metric) {
  if (!metric) return "Select a metric to view its plain-English definition and calculation logic.";
  const metricName = metricNamePlainEnglish(metric.value);
  const baseDefinition = metricDefinitionPlainEnglish(
    metric.value,
    metric.description,
    metric.expression_preview,
  );
  const aggregation = String(metric.aggregation || "").trim() || "latest reading";
  const window = String(metric.window || "").trim() || "default monitoring window";
  const thresholdSentence = thresholdPlainEnglish(metric.threshold);
  return `${baseDefinition} It uses telemetry values from ${metricName}, applies ${aggregation} aggregation over ${window}, and checks whether the result ${thresholdSentence}.`;
}

function formatMetricValue(value, threshold) {
  if (typeof value !== "number" || Number.isNaN(value)) return "No live value";
  const unit = String(threshold?.unit || "").trim();
  if (unit === "%") return `${Math.round(value)}%`;
  if (unit === "ratio") return `${Number(value.toFixed(3))}`;
  if (unit === "score") return `${Number(value.toFixed(3))}`;
  if (unit) return `${Number(value.toFixed(3))} ${unit}`;
  return `${Number(value.toFixed(3))}`;
}

function formulaToPlainEnglish(metricName, threshold) {
  const formula = String(threshold?.formula || "").trim();
  const period = String(threshold?.delta_period || "").trim();
  if (formula) {
    return `Calculated using formula \"${formula}\"${period ? ` over ${period}` : ""}.`;
  }
  return `Calculated from telemetry metric ${metricName || "selected metric"}${period ? ` over ${period}` : ""}.`;
}

function stripBulletChars(value) {
  return String(value || "")
    .replace(/[•◦▪●‣]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeLabels(values, fallback = "N/A") {
  const clean = Array.from(
    new Set((values || []).map((v) => stripBulletChars(v)).filter(Boolean)),
  );
  if (clean.length === 0) return fallback;
  if (clean.length === 1) return clean[0];
  return `${clean[0]} +${clean.length - 1}`;
}

function formatTimestamp(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString();
}

function cleanRequirementText(value) {
  const raw = stripBulletChars(value);
  if (!raw) return "";
  return raw
    .replace(/^(\(\s*[a-zA-Z0-9]+\s*\)\s*)+/, "")
    .replace(/^\d+(\.\d+)*[\)\.\-:]?\s+/, "")
    .replace(/^[-*]\s+/, "")
    .trim();
}

function cleanNarrativeText(value) {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  return raw
    .split(/\r?\n+/)
    .map((line) => cleanRequirementText(line))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeLegendIcon(label) {
  return (
    <span
      title={label}
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--border)",
        color: "var(--text-tertiary)",
        fontSize: 10,
        cursor: "help",
      }}
    >
      i
    </span>
  );
}

function FilterGlyph({ type, title }) {
  if (type === "search") {
    return (
      <span className="catalog-filter-icon" title={title}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
    );
  }
  if (type === "control") {
    return (
      <span className="catalog-filter-icon" title={title}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="5" rx="1.5" />
          <rect x="4" y="15" width="16" height="5" rx="1.5" />
        </svg>
      </span>
    );
  }
  if (type === "requirement") {
    return (
      <span className="catalog-filter-icon" title={title}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 4h7l4 4v12H7z" />
          <path d="M14 4v4h4" />
          <path d="M9 13h6" />
          <path d="M9 17h6" />
        </svg>
      </span>
    );
  }
  if (type === "sort") {
    return (
      <span className="catalog-filter-icon" title={title}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8 6h11" />
          <path d="M8 12h8" />
          <path d="M8 18h5" />
          <path d="m3 8 2-2 2 2" />
          <path d="M5 6v12" />
        </svg>
      </span>
    );
  }
  if (type === "jurisdiction") {
    return (
      <span className="catalog-filter-icon" title={title}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18" />
          <path d="M12 3a14 14 0 0 0 0 18" />
        </svg>
      </span>
    );
  }
  if (type === "category") {
    return (
      <span className="catalog-filter-icon" title={title}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="6" rx="1.5" />
          <rect x="4" y="14" width="16" height="6" rx="1.5" />
        </svg>
      </span>
    );
  }
  if (type === "base") {
    return (
      <span className="catalog-filter-icon" title={title}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3l7 3v5c0 5-3.3 8.4-7 10-3.7-1.6-7-5-7-10V6z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </span>
    );
  }
  return (
    <span className="catalog-filter-icon" title={title}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 3.5h7l4 4V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
        <path d="M15 3.5V8h4" />
      </svg>
    </span>
  );
}
FilterGlyph.propTypes = {
  type: PropTypes.string.isRequired,
  title: PropTypes.string,
};

function LeaderboardSection({
  title,
  subtitle,
  items,
  emptyText,
  tone = "neutral",
  scaleMax = null,
}) {
  const maxScore = Number.isFinite(scaleMax) && scaleMax > 0
    ? scaleMax
    : Math.max(...items.map((item) => item.score || 0), 0);
  return (
    <section className={`catalog-leaderboard-section tone-${tone}`}>
      <div className="catalog-leaderboard-title">{title}</div>
      {subtitle ? <div className="catalog-leaderboard-subtitle">{subtitle}</div> : null}
      {items.length === 0 ? (
        <p className="section-copy" style={{ marginBottom: 0 }}>{emptyText}</p>
      ) : (
        <ul className="catalog-leaderboard-list">
          {items.map((item, index) => {
            const intensity = maxScore > 0 ? (item.score / maxScore) * 100 : 0;
            return (
              <li key={`${title}-${item.id}`} className="catalog-leaderboard-item">
                <div className="catalog-leaderboard-row">
                  <span className={`catalog-rank-badge rank-${Math.min(index + 1, 5)}`}>{index + 1}</span>
                  <div className="catalog-leaderboard-body">
                    <div className="catalog-leaderboard-name">{item.name}</div>
                    <div className="catalog-leaderboard-meta">{item.meta}</div>
                  </div>
                  <span className="catalog-leaderboard-score">{item.scoreText}</span>
                </div>
                <div className="catalog-leaderboard-bar-track">
                  <span
                    className="catalog-leaderboard-bar-fill"
                    style={{ width: `${Math.max(8, Math.round(intensity))}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

LeaderboardSection.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string,
  items: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    meta: PropTypes.string.isRequired,
    score: PropTypes.number.isRequired,
    scoreText: PropTypes.string.isRequired,
  })),
  emptyText: PropTypes.string.isRequired,
  tone: PropTypes.oneOf(["neutral", "positive", "negative", "accent"]),
  scaleMax: PropTypes.number,
};

function CatalogSearchPanel() {
  const { selectedApp, currentUser } = useApp();
  const showLeaderboardPanel = false;

  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "requirement", direction: "asc" });
  const [jurisdictionFilter, setJurisdictionFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const [allRequirements, setAllRequirements] = useState([]);
  const [loadingRequirements, setLoadingRequirements] = useState(false);
  const [requirementsError, setRequirementsError] = useState("");

  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [isCreatingRequirement, setIsCreatingRequirement] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [showInterpretForm, setShowInterpretForm] = useState(false);
  const [interpretAppId, setInterpretAppId] = useState(selectedApp?.id || "");
  const [interpretText, setInterpretText] = useState("");
  const [savingInterpretation, setSavingInterpretation] = useState(false);
  const [interpretError, setInterpretError] = useState("");
  const [interpretNotice, setInterpretNotice] = useState("");
  const [connectedApps, setConnectedApps] = useState([]);
  const [appScopeItems, setAppScopeItems] = useState([]);
  const [appInterpretations, setAppInterpretations] = useState([]);
  const [loadingAppContext, setLoadingAppContext] = useState(false);
  const [leaderboardScopeItems, setLeaderboardScopeItems] = useState([]);
  const [catalogControlsByRequirementId, setCatalogControlsByRequirementId] = useState(new Map());
  const [foundationControlIds, setFoundationControlIds] = useState(new Set());
  const [availableTelemetryMetrics, setAvailableTelemetryMetrics] = useState([]);
  const [telemetryCategoriesByMetric, setTelemetryCategoriesByMetric] = useState(new Map());
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [leaderboardComplianceSnapshots, setLeaderboardComplianceSnapshots] = useState([]);
  const [leaderboardTierSnapshots, setLeaderboardTierSnapshots] = useState([]);
  const [leaderboardError, setLeaderboardError] = useState("");
  const [assignModalRequirement, setAssignModalRequirement] = useState(null);
  const [assignTargetAppId, setAssignTargetAppId] = useState("");
  const [assigningRequirement, setAssigningRequirement] = useState(false);
  const [togglingRequirementStatusId, setTogglingRequirementStatusId] = useState("");
  const [assignNotice, setAssignNotice] = useState("");
  const [assignError, setAssignError] = useState("");
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [savingAdminRecord, setSavingAdminRecord] = useState(false);
  const [deletingAdminRecord, setDeletingAdminRecord] = useState(false);
  const [adminRecordNotice, setAdminRecordNotice] = useState("");
  const [adminRecordError, setAdminRecordError] = useState("");
  const [adminFormStep, setAdminFormStep] = useState(1);
  const [showAllMetricResults, setShowAllMetricResults] = useState(false);
  const [metricFilterQuery, setMetricFilterQuery] = useState("");
  const [adminDraft, setAdminDraft] = useState(createEmptyAdminDraft(selectedApp?.id || ""));

  const queryTrimmed = useMemo(() => query.trim(), [query]);
  const isGlobalAdmin = useMemo(
    () => ["admin", "secretariat_admin"].includes(String(currentUser?.role || "").toLowerCase()),
    [currentUser?.role],
  );
  const createMode = useMemo(
    () => Boolean(
      isGlobalAdmin
      && (isCreatingRequirement || String(selectedItem?.id || "").startsWith("__new__")),
    ),
    [isGlobalAdmin, isCreatingRequirement, selectedItem?.id],
  );
  const maxAdminFormStep = ADMIN_FORM_STEPS.length;
  const selectedTelemetryMetric = useMemo(
    () => availableTelemetryMetrics.find((metric) => metric.value === adminDraft.metric_name) || null,
    [availableTelemetryMetrics, adminDraft.metric_name],
  );
  const filteredTelemetryMetrics = useMemo(() => {
    const selectedCategory = canonicalGovernanceCategory(adminDraft.governance_category);
    const sortByLabel = (items) => items.sort((a, b) => String(a?.label || "").localeCompare(String(b?.label || "")));
    if (!selectedCategory) {
      return sortByLabel([...availableTelemetryMetrics]);
    }

    const scopedMetrics = availableTelemetryMetrics.filter((metric) => {
      const metricName = String(metric?.value || "").trim();
      const metricCategories = telemetryCategoriesByMetric.get(metricName) || new Set();
      if (metricCategories.has(selectedCategory)) return true;
      if (metricCategories.size > 0) return false;
      const inferredCategory = canonicalGovernanceCategory(
        metric?.governance_category
        || metric?.category
        || metric?.domain
        || governanceCategoryFromMetricName(metricName),
      );
      return inferredCategory === selectedCategory;
    });

    if (scopedMetrics.length) {
      return sortByLabel(scopedMetrics);
    }

    // Safe fallback: return all metrics if category tags are incomplete.
    return sortByLabel([...availableTelemetryMetrics]);
  }, [availableTelemetryMetrics, adminDraft.governance_category, telemetryCategoriesByMetric]);
  const searchedTelemetryMetrics = useMemo(() => {
    const needle = String(metricFilterQuery || "").trim().toLowerCase();
    if (!needle) return filteredTelemetryMetrics;
    return filteredTelemetryMetrics.filter((metric) => {
      const label = String(metric?.label || "").toLowerCase();
      const name = String(metric?.value || "").toLowerCase();
      const definition = String(
        metricDefinitionPlainEnglish(metric?.value, metric?.description, metric?.expression_preview) || "",
      ).toLowerCase();
      return label.includes(needle) || name.includes(needle) || definition.includes(needle);
    });
  }, [filteredTelemetryMetrics, metricFilterQuery]);
  const visibleTelemetryMetrics = useMemo(
    () => (showAllMetricResults ? searchedTelemetryMetrics : searchedTelemetryMetrics.slice(0, 6)),
    [searchedTelemetryMetrics, showAllMetricResults],
  );
  const hasAppScopeSelection = useMemo(
    () => (
      adminDraft.placement_requirement_type === "baseline"
      || (adminDraft.placement_application_ids || []).length > 0
    ),
    [adminDraft.placement_requirement_type, adminDraft.placement_application_ids],
  );

  function deriveTelemetryControlFields(metricName) {
    const metric = availableTelemetryMetrics.find((item) => item.value === metricName) || null;
    const readableName = metricNamePlainEnglish(metricName);
    const definition = metricCalculationNarrative(
      metric || {
        value: metricName,
        label: readableName,
        description: "",
        expression_preview: "",
        threshold: null,
        operator: "",
        window: "",
        aggregation: "",
      },
    );
    return {
      title: `${readableName} Control`,
      description: definition,
    };
  }

  useEffect(() => {
    let active = true;

    async function loadAllRequirements() {
      setLoadingRequirements(true);
      setRequirementsError("");
      try {
        let skip = 0;
        let total = Infinity;
        const merged = [];

        while (merged.length < total) {
          const response = await listRequirements({
            skip,
            limit: REQUIREMENTS_PAGE_LIMIT,
          });
          const items = Array.isArray(response?.items) ? response.items : [];
          total = Number(response?.total ?? items.length);
          merged.push(...items);
          if (items.length === 0) break;
          skip += items.length;
        }

        if (active) setAllRequirements(merged);
      } catch (err) {
        if (active) {
          const detail = err?.response?.data?.detail;
          setRequirementsError(
            typeof detail === "string" ? detail : "Failed to load requirements",
          );
        }
      } finally {
        if (active) setLoadingRequirements(false);
      }
    }

    loadAllRequirements();
    return () => {
      active = false;
    };
  }, [createMode, selectedItem?.id]);

  useEffect(() => {
    let active = true;

    async function loadCatalogControlLinks() {
      try {
        let skip = 0;
        let total = Infinity;
        const controls = [];

        while (controls.length < total) {
          const response = await listControls({ skip, limit: 200 });
          const items = Array.isArray(response?.items) ? response.items : [];
          total = Number(response?.total ?? items.length);
          controls.push(...items);
          if (items.length === 0) break;
          skip += items.length;
        }

        const foundationIds = new Set(
          controls
            .filter((control) => Boolean(control?.is_foundation))
            .map((control) => String(control?.id || "").trim())
            .filter(Boolean),
        );
        const metricCategoryMap = new Map();
        const metricsMap = new Map();
        const ensureMetricCategory = (metricName, rawCategory) => {
          const name = String(metricName || "").trim();
          if (!name) return;
          const category = canonicalGovernanceCategory(rawCategory);
          if (!metricCategoryMap.has(name)) {
            metricCategoryMap.set(name, new Set());
          }
          if (category) {
            metricCategoryMap.get(name).add(category);
          }
        };
        try {
          const systemKpis = await listAdminSystemKpis();
          (systemKpis || []).forEach((kpi) => {
            const metricName = String(kpi?.metric_name || "").trim();
            if (!metricName) return;
            const kpiCategory = canonicalGovernanceCategory(
              kpi?.governance_category
              || kpi?.category
              || kpi?.domain
              || governanceCategoryFromMetricName(metricName),
            );
            ensureMetricCategory(metricName, kpiCategory);
            const description = String(kpi?.description || "").trim();
            const rawLabel = String(kpi?.label || "").trim();
            const label = rawLabel && !isTechnicalTelemetryText(rawLabel)
              ? rawLabel
              : metricNamePlainEnglish(metricName);
            metricsMap.set(metricName, {
              value: metricName,
              label,
              description,
              expression_preview: String(kpi?.expression_preview || "").trim(),
              threshold: kpi?.threshold && typeof kpi.threshold === "object" ? kpi.threshold : null,
              operator: String(kpi?.operator || "").trim(),
              window: String(kpi?.window || "").trim(),
              aggregation: String(kpi?.aggregation || "").trim(),
              governance_category: kpiCategory,
            });
          });
        } catch {
          // Fall back to catalog-derived metrics below.
        }
        controls.forEach((control) => {
          const metricName = String(control?.metric_name || "").trim();
          if (!metricName) return;
          ensureMetricCategory(metricName, control?.domain || "");
          ensureMetricCategory(metricName, governanceCategoryFromMetricName(metricName));
          if (!metricsMap.has(metricName)) {
            metricsMap.set(metricName, {
              value: metricName,
              label: metricNamePlainEnglish(metricName),
              description: "",
              expression_preview: "",
              threshold: null,
              operator: "",
              window: "",
              aggregation: "",
            });
          }
        });
        // Ensure all known KPIs (including those not linked to a control row yet)
        // still resolve to at least one governance category via metric-name mapping.
        metricsMap.forEach((_value, metricName) => {
          ensureMetricCategory(metricName, governanceCategoryFromMetricName(metricName));
        });
        const metricOptions = Array.from(metricsMap.values()).sort((a, b) => a.label.localeCompare(b.label));

        const linkMap = new Map();
        const chunkSize = 8;
        for (let i = 0; i < controls.length; i += chunkSize) {
          const chunk = controls.slice(i, i + chunkSize);
          const settled = await Promise.allSettled(
            chunk.map((control) => listRequirements({
              controlId: control.id,
              skip: 0,
              limit: 200,
            })),
          );
          if (!active) return;
          settled.forEach((result, index) => {
            if (result.status !== "fulfilled") return;
            const control = chunk[index];
            const reqs = Array.isArray(result.value?.items) ? result.value.items : [];
            reqs.forEach((req) => {
              const reqId = String(req?.id || "").trim();
              if (!reqId) return;
              if (!linkMap.has(reqId)) linkMap.set(reqId, []);
              linkMap.get(reqId).push({
                id: String(control?.id || "").trim(),
                title: stripBulletChars(control?.title || ""),
                metric_name: control?.metric_name || null,
              });
              ensureMetricCategory(control?.metric_name, req?.category || "");
            });
          });
        }

        if (active) {
          setCatalogControlsByRequirementId(linkMap);
          setFoundationControlIds(foundationIds);
          setAvailableTelemetryMetrics(metricOptions);
          setTelemetryCategoriesByMetric(metricCategoryMap);
        }
      } catch {
        if (active) {
          setCatalogControlsByRequirementId(new Map());
          setFoundationControlIds(new Set());
          setAvailableTelemetryMetrics([]);
          setTelemetryCategoriesByMetric(new Map());
        }
      }
    }

    loadCatalogControlLinks();
    return () => {
      active = false;
    };
  }, []);

  const requirementMetaByTitle = useMemo(() => {
    const map = new Map();
    for (const item of allRequirements) {
      const key = normalizeText(item?.title);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          regulations: new Set(),
          jurisdictions: new Set(),
        });
      }
      const entry = map.get(key);
      if (item?.regulation_title) entry.regulations.add(item.regulation_title);
      if (item?.jurisdiction) entry.jurisdictions.add(item.jurisdiction);
    }
    return map;
  }, [allRequirements]);

  const jurisdictionOptions = useMemo(() => {
    const values = new Set();
    for (const item of allRequirements) {
      const titleKey = normalizeText(item?.title);
      const meta = requirementMetaByTitle.get(titleKey);
      const jurisdictionsForRow = Array.from(meta?.jurisdictions || []);
      if (item?.jurisdiction && !jurisdictionsForRow.includes(item.jurisdiction)) {
        jurisdictionsForRow.push(item.jurisdiction);
      }
      jurisdictionsForRow.forEach((value) => {
        const cleaned = stripBulletChars(value);
        if (cleaned) values.add(cleaned);
      });
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [allRequirements, requirementMetaByTitle]);

  const scopeByRequirementId = useMemo(() => {
    const map = new Map();
    for (const item of appScopeItems) {
      if (item?.requirement_id) map.set(String(item.requirement_id), item);
    }
    return map;
  }, [appScopeItems]);

  const scopeByRequirementTitle = useMemo(() => {
    const map = new Map();
    for (const item of appScopeItems) {
      const key = normalizeText(item?.title);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, item);
        continue;
      }
      const current = map.get(key);
      if (!current?.is_default && item?.is_default) map.set(key, item);
    }
    return map;
  }, [appScopeItems]);

  const globalScopeByRequirementId = useMemo(() => {
    const map = new Map();
    for (const item of leaderboardScopeItems) {
      const key = String(item?.requirement_id || "").trim();
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, item);
        continue;
      }
      const current = map.get(key);
      const currentControls = Array.isArray(current?.linked_controls) ? current.linked_controls.length : 0;
      const nextControls = Array.isArray(item?.linked_controls) ? item.linked_controls.length : 0;
      if ((!current?.is_default && item?.is_default) || nextControls > currentControls) {
        map.set(key, item);
      }
    }
    return map;
  }, [leaderboardScopeItems]);

  const globalScopeByRequirementTitle = useMemo(() => {
    const map = new Map();
    for (const item of leaderboardScopeItems) {
      const key = normalizeText(item?.title);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, item);
        continue;
      }
      const current = map.get(key);
      const currentControls = Array.isArray(current?.linked_controls) ? current.linked_controls.length : 0;
      const nextControls = Array.isArray(item?.linked_controls) ? item.linked_controls.length : 0;
      if ((!current?.is_default && item?.is_default) || nextControls > currentControls) {
        map.set(key, item);
      }
    }
    return map;
  }, [leaderboardScopeItems]);

  const catalogControlsByRequirementTitle = useMemo(() => {
    const map = new Map();
    for (const req of allRequirements) {
      const reqId = String(req?.id || "").trim();
      const titleKey = normalizeText(req?.title);
      if (!reqId || !titleKey) continue;
      const controls = catalogControlsByRequirementId.get(reqId) || [];
      if (controls.length === 0) continue;
      if (!map.has(titleKey)) map.set(titleKey, []);
      const existing = map.get(titleKey);
      controls.forEach((control) => {
        if (!existing.some((item) => item.id === control.id)) {
          existing.push(control);
        }
      });
    }
    return map;
  }, [allRequirements, catalogControlsByRequirementId]);

  const interpretationsByRequirementId = useMemo(() => {
    const map = new Map();
    for (const item of appInterpretations) {
      const key = String(item?.requirement_id || "").trim();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }, [appInterpretations]);

  const interpretationsByRequirementTitle = useMemo(() => {
    const map = new Map();
    for (const item of appInterpretations) {
      const key = normalizeText(item?.requirement_title);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }, [appInterpretations]);

  function resolveLinkedControls(item, detail = null, scopeItem = null) {
    const fromScope = Array.isArray(scopeItem?.linked_controls)
      ? scopeItem.linked_controls.filter((control) => Boolean(control?.id || control?.title))
      : [];
    if (fromScope.length > 0) return fromScope;

    const reqId = String(item?.id || detail?.id || "").trim();
    if (reqId && catalogControlsByRequirementId.has(reqId)) {
      return catalogControlsByRequirementId.get(reqId);
    }
    const titleKey = normalizeText(detail?.title || item?.title);
    if (titleKey && catalogControlsByRequirementTitle.has(titleKey)) {
      return catalogControlsByRequirementTitle.get(titleKey);
    }
    return [];
  }
  function isBaseRequirement(item, detail = null, scopeItem = null) {
    if (scopeItem?.is_default) return true;
    const linkedControls = resolveLinkedControls(item, detail, scopeItem);
    return linkedControls.some((control) => foundationControlIds.has(String(control?.id || "").trim()));
  }

  const filteredResults = useMemo(() => {
    const q = activeQuery.toLowerCase();
    const normalizedJurisdictionFilter = String(jurisdictionFilter || "").trim().toLowerCase();
    const rows = allRequirements.filter((item) => {
      if (q) {
        const haystack = [
          item.code,
          item.title,
          item.description,
          item.regulation_title,
          item.jurisdiction,
          item.category,
        ]
          .map((value) => String(value || "").toLowerCase())
            .join(" ");
        if (!haystack.includes(q)) return false;
      }

      const reqId = String(item?.id || "").trim();
      const titleKey = normalizeText(item?.title);
      const scopeItem = (
        scopeByRequirementId.get(reqId)
        || scopeByRequirementTitle.get(titleKey)
        || globalScopeByRequirementId.get(reqId)
        || globalScopeByRequirementTitle.get(titleKey)
        || null
      );

      if (normalizedJurisdictionFilter) {
        const meta = requirementMetaByTitle.get(titleKey);
        const jurisdictionsForRow = Array.from(meta?.jurisdictions || []);
        if (item?.jurisdiction && !jurisdictionsForRow.includes(item.jurisdiction)) {
          jurisdictionsForRow.push(item.jurisdiction);
        }
        const jurisdictionMatch = jurisdictionsForRow.some(
          (value) => stripBulletChars(value).toLowerCase() === normalizedJurisdictionFilter,
        );
        if (!jurisdictionMatch) return false;
      }

      if (typeFilter !== "all") {
        const isBase = isBaseRequirement(item, null, scopeItem);
        const rowType = isBase ? "secretariat" : "application_specific";
        if (rowType !== typeFilter) return false;
      }

      return true;
    });

    const toRowText = (item, key) => {
      const reqId = String(item?.id || "").trim();
      const titleKey = normalizeText(item?.title);
      const scopeItem = (
        scopeByRequirementId.get(reqId)
        || scopeByRequirementTitle.get(titleKey)
        || globalScopeByRequirementId.get(reqId)
        || globalScopeByRequirementTitle.get(titleKey)
        || null
      );
      if (key === "control") {
        const controls = resolveLinkedControls(item, null, scopeItem);
        const controlNames = controls
          .map((control) => stripBulletChars(control?.title || ""))
          .filter(Boolean);
        return summarizeLabels(controlNames, "Control mapping unavailable");
      }
      if (key === "requirement") {
        return cleanRequirementText(item?.title) || "Untitled requirement";
      }
      return cleanRequirementText(item?.title) || "";
    };

    return rows.sort((a, b) => {
      const direction = sortConfig.direction === "desc" ? -1 : 1;
      const av = toRowText(a, sortConfig.key);
      const bv = toRowText(b, sortConfig.key);
      const cmp = av.localeCompare(bv, undefined, { sensitivity: "base", numeric: true });
      if (cmp !== 0) return cmp * direction;
      return (a.title || "").localeCompare(b.title || "");
    });
  }, [
    activeQuery,
    allRequirements,
    sortConfig,
    jurisdictionFilter,
    typeFilter,
    requirementMetaByTitle,
    scopeByRequirementId,
    scopeByRequirementTitle,
    globalScopeByRequirementId,
    globalScopeByRequirementTitle,
    catalogControlsByRequirementId,
    catalogControlsByRequirementTitle,
    foundationControlIds,
  ]);

  useEffect(() => {
    setIsCreatingRequirement(false);
    setPage(1);
    setSelectedItem(null);
    setSelectedDetail(null);
    setSelectedRecord(null);
    setDetailError("");
    setShowInterpretForm(false);
    setInterpretText("");
    setInterpretError("");
    setInterpretNotice("");
    setAdminRecordNotice("");
    setAdminRecordError("");
    setAdminFormStep(1);
  }, [activeQuery, sortConfig, jurisdictionFilter, typeFilter]);

  useEffect(() => {
    function onKeyDown(event) {
      if (!selectedItem) return;
      const selectedIndex = filteredResults.findIndex((row) => row.id === selectedItem.id);
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      } else if (event.key === "ArrowLeft" && selectedIndex > 0) {
        event.preventDefault();
        selectResult(filteredResults[selectedIndex - 1]);
      } else if (event.key === "ArrowRight" && selectedIndex >= 0 && selectedIndex < filteredResults.length - 1) {
        event.preventDefault();
        selectResult(filteredResults[selectedIndex + 1]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedItem, filteredResults]);

  useEffect(() => {
    if (!selectedItem || !selectedRecord) return;
    const byId = interpretationsByRequirementId.get(String(selectedItem?.id || ""));
    const history = (Array.isArray(byId) && byId.length > 0)
      ? byId
      : (interpretationsByRequirementTitle.get(normalizeText(selectedDetail?.title || selectedItem?.title)) || []);
    setSelectedRecord((prev) => (
      prev
        ? { ...prev, interpretationHistory: history }
        : prev
    ));
  }, [appInterpretations, selectedItem, selectedDetail, interpretationsByRequirementId, interpretationsByRequirementTitle]);

  useEffect(() => {
    let active = true;

    async function loadApps() {
      try {
        const apps = await api.listApplications();
        if (!active) return;
        const activeApps = Array.isArray(apps)
          ? apps.filter((app) => app.status === "active")
          : [];
        setConnectedApps(activeApps);
        setInterpretAppId((prev) => {
          if (selectedApp?.id && activeApps.some((app) => app.id === selectedApp.id)) {
            return selectedApp.id;
          }
          if (prev && activeApps.some((app) => app.id === prev)) return prev;
          return "";
        });
      } catch {
        if (active) {
          setConnectedApps([]);
          setInterpretAppId("");
        }
      }
    }

    loadApps();
    return () => {
      active = false;
    };
  }, [selectedApp?.id]);

  useEffect(() => {
    if (!selectedApp?.id) return;
    setInterpretAppId((prev) => {
      if (connectedApps.some((app) => app.id === selectedApp.id)) return selectedApp.id;
      if (prev && connectedApps.some((app) => app.id === prev)) return prev;
      return "";
    });
  }, [selectedApp?.id, connectedApps]);

  useEffect(() => {
    setAssignTargetAppId((prev) => {
      if (selectedApp?.id && connectedApps.some((app) => app.id === selectedApp.id)) {
        return selectedApp.id;
      }
      if (prev && connectedApps.some((app) => app.id === prev)) {
        return prev;
      }
      return connectedApps[0]?.id || "";
    });
  }, [selectedApp?.id, connectedApps]);

  useEffect(() => {
    let active = true;

    async function loadAppContext() {
      if (!interpretAppId) {
        setAppScopeItems([]);
        setAppInterpretations([]);
        return;
      }
      setLoadingAppContext(true);
      try {
        const [scope, interpretations] = await Promise.all([
          api.getApplicationRequirements(interpretAppId, "limit=500"),
          api.getApplicationInterpretations(interpretAppId),
        ]);
        if (!active) return;
        setAppScopeItems(Array.isArray(scope?.items) ? scope.items : []);
        setAppInterpretations(Array.isArray(interpretations) ? interpretations : []);
      } catch {
        if (!active) return;
        setAppScopeItems([]);
        setAppInterpretations([]);
      } finally {
        if (active) setLoadingAppContext(false);
      }
    }

    loadAppContext();
    return () => {
      active = false;
    };
  }, [interpretAppId]);

  useEffect(() => {
    let active = true;

    async function loadSystemLeaderboardData() {
      const appIds = connectedApps.map((app) => app.id).filter(Boolean);
      if (appIds.length === 0) {
        setLeaderboardScopeItems([]);
        setLeaderboardRows([]);
        setLeaderboardComplianceSnapshots([]);
        setLeaderboardTierSnapshots([]);
        setLeaderboardError("");
        return;
      }
      setLoadingLeaderboard(true);
      setLeaderboardError("");
      try {
        const [scopeSettled, dashboardSettled, complianceSettled, tierSettled] = await Promise.all([
          Promise.allSettled(appIds.map((appId) => api.getApplicationRequirements(appId, "limit=500"))),
          Promise.allSettled(
            appIds.flatMap((appId) => (
              DASHBOARD_STEPS.map((step) => api.getApplicationDashboardStep(appId, step))
            )),
          ),
          Promise.allSettled(appIds.map((appId) => api.getCompliance(appId))),
          Promise.allSettled(appIds.map((appId) => api.getTier(appId))),
        ]);
        if (!active) return;

        const scopeItems = scopeSettled
          .filter((result) => result.status === "fulfilled")
          .flatMap((result) => (Array.isArray(result.value?.items) ? result.value.items : []));
        const rows = dashboardSettled
          .filter((result) => result.status === "fulfilled")
          .flatMap((result) => (Array.isArray(result.value?.rows) ? result.value.rows : []));
        const complianceSnapshots = complianceSettled
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value);
        const tierSnapshots = tierSettled
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value);

        const failures = (
          scopeSettled.filter((result) => result.status === "rejected").length
          + dashboardSettled.filter((result) => result.status === "rejected").length
          + complianceSettled.filter((result) => result.status === "rejected").length
          + tierSettled.filter((result) => result.status === "rejected").length
        );

        setLeaderboardScopeItems(scopeItems);
        setLeaderboardRows(rows);
        setLeaderboardComplianceSnapshots(complianceSnapshots);
        setLeaderboardTierSnapshots(tierSnapshots);
        if (failures > 0) {
          setLeaderboardError("Some system analytics segments could not be loaded; leaderboard uses available data.");
        }
      } catch {
        if (!active) return;
        setLeaderboardScopeItems([]);
        setLeaderboardRows([]);
        setLeaderboardComplianceSnapshots([]);
        setLeaderboardTierSnapshots([]);
        setLeaderboardError("Failed to load system leaderboard signals.");
      } finally {
        if (active) setLoadingLeaderboard(false);
      }
    }

    loadSystemLeaderboardData();
    return () => {
      active = false;
    };
  }, [connectedApps, showLeaderboardPanel]);

  function runSearch(event) {
    event.preventDefault();
    setActiveQuery(queryTrimmed);
  }

  function clearSearchAndFilters() {
    setQuery("");
    setActiveQuery("");
    setSortConfig({ key: "requirement", direction: "asc" });
    setJurisdictionFilter("");
    setTypeFilter("all");
    setAssignNotice("");
    setAssignError("");
  }

  function startNewRequirementFlow() {
    const scopedAppId = interpretAppId || selectedApp?.id || "";
    setIsCreatingRequirement(true);
    setSelectedItem({ id: "__new__", title: "New Requirement", category: "Risk & Compliance" });
    setSelectedDetail({
      id: "",
      regulation_id: "",
      regulation_title: "",
      jurisdiction: "",
      code: "",
      title: "New Requirement",
      description: "",
      category: "Risk & Compliance",
    });
    setSelectedRecord({
      controls: [],
      scopeItem: null,
      measureRows: [],
      regulations: [],
      jurisdictions: [],
      interpretationHistory: [],
    });
    setLoadingDetail(false);
    setDetailError("");
    setShowInterpretForm(false);
    setInterpretText("");
    setInterpretError("");
    setInterpretNotice("");
    setAdminRecordNotice("");
    setAdminRecordError("");
    setAdminFormStep(1);
    setAdminDraft(createEmptyAdminDraft(scopedAppId));
  }

  function onSortColumn(columnKey) {
    if (columnKey !== "control" && columnKey !== "requirement") return;
    setSortConfig((prev) => {
      if (prev.key === columnKey) {
        return {
          key: columnKey,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { key: columnKey, direction: "asc" };
    });
  }

  function sortIndicator(columnKey) {
    if (sortConfig.key !== columnKey) return "↕";
    return sortConfig.direction === "asc" ? "↑" : "↓";
  }

  function resolveScopeItem(item, detail = null) {
    const reqId = String(item?.id || detail?.id || "").trim();
    const byId = (
      scopeByRequirementId.get(reqId)
      || globalScopeByRequirementId.get(reqId)
    );
    if (byId) return byId;
    const titleKey = normalizeText(detail?.title || item?.title);
    if (!titleKey) return null;
    return (
      scopeByRequirementTitle.get(titleKey)
      || globalScopeByRequirementTitle.get(titleKey)
      || null
    );
  }

  function resolveInterpretations(item, detail = null) {
    const byId = interpretationsByRequirementId.get(String(item?.id || detail?.id || ""));
    if (Array.isArray(byId) && byId.length > 0) return byId;
    const titleKey = normalizeText(detail?.title || item?.title);
    const byTitle = interpretationsByRequirementTitle.get(titleKey);
    return Array.isArray(byTitle) ? byTitle : [];
  }

  function pickScopeItem(scopeItems, item, detail) {
    if (!Array.isArray(scopeItems) || scopeItems.length === 0) return null;
    return (
      scopeItems.find((entry) => entry.requirement_id === item?.id)
      || scopeItems.find((entry) => entry.code === detail?.code)
      || scopeItems.find((entry) => normalizeText(entry?.title) === normalizeText(detail?.title || item?.title))
      || null
    );
  }

  async function loadScopeItemForApp(appId, item, detail) {
    if (!appId || !item?.id) return null;

    const terms = [detail?.code, item?.code, detail?.title, item?.title]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    for (const term of terms) {
      const requirementScope = await api.getApplicationRequirements(
        appId,
        `q=${encodeURIComponent(term)}&limit=200`,
      );
      const scopeItems = Array.isArray(requirementScope?.items) ? requirementScope.items : [];
      const matched = pickScopeItem(scopeItems, item, detail);
      if (matched) return matched;
    }

    const fallbackScope = await api.getApplicationRequirements(appId, "limit=200");
    const fallbackItems = Array.isArray(fallbackScope?.items) ? fallbackScope.items : [];
    return pickScopeItem(fallbackItems, item, detail);
  }

  async function selectResult(item) {
    setIsCreatingRequirement(false);
    setSelectedItem(item);
    setSelectedDetail(null);
    setSelectedRecord(null);
    setDetailError("");
    setInterpretNotice("");
    setInterpretError("");
    setShowInterpretForm(false);
    setInterpretText("");
    setAdminRecordNotice("");
    setAdminRecordError("");
    setAdminFormStep(1);

    if (!item?.id) {
      setDetailError("Selected result does not have a resolvable id");
      return;
    }

    setLoadingDetail(true);
    try {
      const detail = await getCatalogItemDetail({ ...item, type: "requirement" });
      let scopeItem = resolveScopeItem(item, detail);
      let measureRows = [];
      const appIdForContext = interpretAppId || selectedApp?.id;
      if (appIdForContext) {
        if (!scopeItem) {
          scopeItem = await loadScopeItemForApp(appIdForContext, item, detail);
        }

        const category = scopeItem?.category || detail?.category || item?.category;
        const step = STEP_BY_CATEGORY[category];
        if (step) {
          const dashboardStep = await api.getApplicationDashboardStep(appIdForContext, step);
          const rows = Array.isArray(dashboardStep?.rows) ? dashboardStep.rows : [];
          const normalizedTitle = normalizeText(detail?.title || item?.title);
          measureRows = rows.filter(
            (row) => row?.requirement_id === item.id
              || normalizeText(row?.requirement_title) === normalizedTitle,
          );
        }
      }

      const normalizedTitle = normalizeText(detail?.title || item?.title);
      const relatedMeta = requirementMetaByTitle.get(normalizedTitle);
      const regulations = Array.from(relatedMeta?.regulations || []);
      const jurisdictions = Array.from(relatedMeta?.jurisdictions || []);
      if (detail?.regulation_title && !regulations.includes(detail.regulation_title)) {
        regulations.push(detail.regulation_title);
      }
      if (detail?.jurisdiction && !jurisdictions.includes(detail.jurisdiction)) {
        jurisdictions.push(detail.jurisdiction);
      }

      const controls = resolveLinkedControls(item, detail, scopeItem).filter((control) => Boolean(control?.id));

      setSelectedDetail(detail);
      setSelectedRecord({
        controls,
        scopeItem,
        measureRows,
        regulations: regulations.sort((a, b) => a.localeCompare(b)),
        jurisdictions: jurisdictions.sort((a, b) => a.localeCompare(b)),
        interpretationHistory: resolveInterpretations(item, detail),
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setDetailError(typeof detail === "string" ? detail : err?.message || "Failed to load detail");
    } finally {
      setLoadingDetail(false);
    }
  }

  function closeModal() {
    setIsCreatingRequirement(false);
    setSelectedItem(null);
    setSelectedDetail(null);
    setSelectedRecord(null);
    setLoadingDetail(false);
    setDetailError("");
    setShowInterpretForm(false);
    setInterpretText("");
    setInterpretError("");
    setInterpretNotice("");
    setAdminRecordNotice("");
    setAdminRecordError("");
    setAdminFormStep(1);
  }

  function openAssignRequirementModal(item) {
    const normalizedCategory = canonicalGovernanceCategory(item?.category || "");
    if (!normalizedCategory) {
      setAssignError("This requirement is missing a valid Governance Category and cannot be assigned yet.");
      return;
    }
    setAssignError("");
    setAssignNotice("");
    setAssignModalRequirement(item);
    setAssignTargetAppId((prev) => {
      if (selectedApp?.id && connectedApps.some((app) => app.id === selectedApp.id)) return selectedApp.id;
      if (prev && connectedApps.some((app) => app.id === prev)) return prev;
      return connectedApps[0]?.id || "";
    });
  }

  function closeAssignRequirementModal() {
    if (assigningRequirement) return;
    setAssignModalRequirement(null);
  }

  async function assignRequirementToApplication() {
    const requirementId = String(assignModalRequirement?.id || "").trim();
    const appId = String(assignTargetAppId || "").trim();
    if (!requirementId) {
      setAssignError("Requirement selection is invalid.");
      return;
    }
    if (!appId) {
      setAssignError("Choose an application before assigning.");
      return;
    }

    setAssignError("");
    setAssignNotice("");
    setAssigningRequirement(true);
    try {
      const scope = await api.getApplicationRequirements(appId, "limit=500");
      const selectedIds = Array.isArray(scope?.items)
        ? scope.items.filter((row) => Boolean(row?.selected)).map((row) => String(row?.requirement_id || "").trim()).filter(Boolean)
        : [];
      const mergedIds = Array.from(new Set([...selectedIds, requirementId]));
      await api.setApplicationRequirements(appId, mergedIds);
      addNewRequirementMarker(appId, requirementId);

      if (interpretAppId === appId) {
        await refreshScopeData(appId);
      }

      setAssignNotice("Requirement assigned to Governance detail scope.");
      setAssignModalRequirement(null);
    } catch (err) {
      setAssignError(err?.message || "Failed to assign requirement to the selected application.");
    } finally {
      setAssigningRequirement(false);
    }
  }

  async function toggleRequirementStatus(item) {
    if (!isGlobalAdmin) return;
    const requirementId = String(item?.id || "").trim();
    if (!requirementId) {
      setAssignError("Requirement status cannot be updated because requirement id is missing.");
      return;
    }

    const currentStatus = String(item?.policy_status || "").trim().toLowerCase() === "inactive"
      ? "Inactive"
      : "Active";
    const targetStatus = currentStatus === "Active" ? "Inactive" : "Active";

    setAssignError("");
    setAssignNotice("");
    setTogglingRequirementStatusId(requirementId);
    try {
      await updateAdminRequirementStatus(requirementId, targetStatus);
      setAllRequirements((prev) => prev.map((row) => (
        String(row?.id || "").trim() === requirementId
          ? { ...row, policy_status: targetStatus }
          : row
      )));
      setSelectedDetail((prev) => (
        prev && String(prev?.id || "").trim() === requirementId
          ? { ...prev, policy_status: targetStatus }
          : prev
      ));
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("aigov:requirements-updated", {
            detail: {
              reason: "policy_status_toggle",
              requirement_id: requirementId,
              policy_status: targetStatus,
            },
          }),
        );
      }
      setAssignNotice(`Requirement status updated to ${targetStatus}.`);
    } catch (err) {
      setAssignError(err?.response?.data?.detail || err?.message || "Failed to update requirement status.");
    } finally {
      setTogglingRequirementStatusId("");
    }
  }

  async function refreshInterpretationData(appId) {
    if (!appId) {
      setAppInterpretations([]);
      return;
    }
    const interpretations = await api.getApplicationInterpretations(appId);
    setAppInterpretations(Array.isArray(interpretations) ? interpretations : []);
  }

  async function refreshScopeData(appId) {
    if (!appId) {
      setAppScopeItems([]);
      return [];
    }
    const scope = await api.getApplicationRequirements(appId, "limit=500");
    const items = Array.isArray(scope?.items) ? scope.items : [];
    setAppScopeItems(items);
    return items;
  }

  async function saveInterpretation(event) {
    event.preventDefault();
    setInterpretError("");
    setInterpretNotice("");

    const targetAppId = interpretAppId || selectedApp?.id;
    if (!targetAppId) {
      setInterpretError("Select a connected application first to create interpretation.");
      return;
    }
    if (!selectedItem?.id) {
      setInterpretError("Select a requirement first.");
      return;
    }
    let linkedControls = resolveLinkedControls(selectedItem, selectedDetail, selectedRecord?.scopeItem || null)
      .filter((control) => Boolean(control?.id));
    if (!linkedControls.length && selectedItem?.id) {
      try {
        const scopeItem = await loadScopeItemForApp(targetAppId, selectedItem, selectedDetail);
        const resolved = Array.isArray(scopeItem?.linked_controls)
          ? scopeItem.linked_controls.filter((control) => Boolean(control?.id))
          : [];
        if (resolved.length) {
          linkedControls = resolved;
          setSelectedRecord((prev) => (
            prev
              ? { ...prev, controls: resolved, scopeItem }
              : {
                controls: resolved,
                scopeItem,
                measureRows: [],
                regulations: [],
                jurisdictions: [],
                interpretationHistory: [],
              }
          ));
        }
      } catch {
        // Keep the original validation message if fallback lookup fails.
      }
    }
    if (!linkedControls.length) {
      setInterpretError("This requirement has no linked controls, so interpretation cannot be applied.");
      return;
    }
    if (!interpretText.trim()) {
      setInterpretError("Interpretation text is required.");
      return;
    }

    setSavingInterpretation(true);
    try {
      const payloadBase = {
        requirement_id: selectedItem.id,
        interpretation_text: interpretText.trim(),
        set_by: currentUser?.email || "application_owner",
      };

      const writes = await Promise.allSettled(
        linkedControls.map((control) => api.createApplicationInterpretation(targetAppId, {
          ...payloadBase,
          control_id: control.id,
        })),
      );

      const failed = writes.filter((result) => result.status === "rejected");
      if (failed.length > 0) {
        setInterpretError(`Interpretation saved partially (${linkedControls.length - failed.length}/${linkedControls.length} controls).`);
      } else {
        setInterpretNotice(`Interpretation saved across ${linkedControls.length} linked control(s) for this requirement.`);
      }
      await refreshInterpretationData(targetAppId);
      await selectResult(selectedItem);
      setShowInterpretForm(false);
      setInterpretText("");
    } catch (err) {
      setInterpretError(err?.message || "Failed to create interpretation");
    } finally {
      setSavingInterpretation(false);
    }
  }

  useEffect(() => {
    if (createMode) return;
    if (!selectedDetail) return;
    const firstControl = (selectedRecord?.controls || [])[0] || {};
    const resolvedCategory = selectedDetail?.category || selectedRecord?.scopeItem?.category || "Risk & Compliance";
    const baselineNow = Boolean(
      selectedRecord?.scopeItem?.is_default
      || (selectedItem ? isBaseRequirement(selectedItem, selectedDetail, selectedRecord?.scopeItem || null) : false),
    );
    const selectedAppId = interpretAppId || selectedApp?.id || "";
    setAdminDraft((prev) => ({
      ...prev,
      requirement_id: String(selectedDetail?.id || selectedItem?.id || ""),
      policy_id: String(selectedDetail?.regulation_id || ""),
      policy_title: selectedDetail?.regulation_title || "",
      policy_jurisdiction: selectedDetail?.jurisdiction || "",
      policy_source: selectedDetail?.policy_source || "",
      policy_description: cleanNarrativeText(selectedDetail?.policy_description || ""),
      policy_type: selectedDetail?.policy_type || prev.policy_type || "Global Policy",
      policy_status: selectedDetail?.policy_status || prev.policy_status || "Active",
      requirement_title: cleanNarrativeText(selectedDetail?.title || ""),
      requirement_description: cleanNarrativeText(selectedDetail?.description || ""),
      governance_category: resolvedCategory,
      risk_statement: cleanNarrativeText(selectedDetail?.risk_statement || prev.risk_statement || ""),
      control_id: String(firstControl?.id || ""),
      control_title: cleanNarrativeText(firstControl?.title || ""),
      control_description: cleanNarrativeText(firstControl?.description || ""),
      metric_name: firstControl?.metric_name || prev.metric_name || "",
      placement_requirement_type: baselineNow ? "baseline" : "application_specific",
      placement_dashboard_inclusion: baselineNow ? "baseline" : "assigned",
      placement_apply_to_all_apps: baselineNow,
      placement_application_ids: baselineNow ? [] : (selectedAppId ? [selectedAppId] : prev.placement_application_ids),
    }));
  }, [createMode, selectedDetail, selectedItem, selectedRecord?.controls, selectedRecord?.scopeItem, interpretAppId, selectedApp?.id, foundationControlIds, catalogControlsByRequirementId, catalogControlsByRequirementTitle]);

  useEffect(() => {
    setAdminFormStep((prev) => Math.min(prev, maxAdminFormStep));
  }, [maxAdminFormStep]);

  useEffect(() => {
    if (adminDraft.control_measure_type !== "system_telemetry") return;
    const metricName = String(adminDraft.metric_name || "").trim();
    if (!metricName) return;
    const telemetryFields = deriveTelemetryControlFields(metricName);
    if (
      adminDraft.control_title === telemetryFields.title
      && adminDraft.control_description === telemetryFields.description
    ) {
      return;
    }
    setAdminDraft((prev) => ({
      ...prev,
      control_title: telemetryFields.title,
      control_description: telemetryFields.description,
    }));
  }, [availableTelemetryMetrics, adminDraft.control_measure_type, adminDraft.metric_name]);

  useEffect(() => {
    setShowAllMetricResults(false);
  }, [adminDraft.governance_category]);

  function updateAdminDraft(field, value) {
    setAdminDraft((prev) => {
      if (field === "control_measure_type") {
        if (value === "system_telemetry") {
          const metricName = String(prev.metric_name || "").trim();
          const telemetryFields = metricName ? deriveTelemetryControlFields(metricName) : null;
          return {
            ...prev,
            control_measure_type: value,
            threshold_operator: "lte",
            threshold_unit: "%",
            formula_expression: prev.formula_expression || "",
            control_title: telemetryFields?.title || prev.control_title,
            control_description: telemetryFields?.description || prev.control_description,
          };
        }
        return {
          ...prev,
          control_measure_type: value,
          metric_name: prev.metric_name || prev.control_title || "",
          formula_expression: "",
          threshold_operator: "eq",
          threshold_unit: "manual",
          threshold_value: "",
          control_title: prev.control_title || "",
          control_description: prev.control_description || "",
        };
      }
      if (field === "metric_name") {
        const metricName = String(value || "").trim();
        if (prev.control_measure_type === "evidence_based") {
          return {
            ...prev,
            metric_name: value,
            control_title: metricName,
          };
        }
        const telemetryFields = metricName ? deriveTelemetryControlFields(metricName) : null;
        return {
          ...prev,
          metric_name: value,
          formula_expression: value ? `latest(${value})` : "",
          control_title: telemetryFields?.title || prev.control_title,
          control_description: telemetryFields?.description || prev.control_description,
        };
      }
      if (field === "placement_requirement_type") {
        if (value === "baseline") {
          return {
            ...prev,
            placement_requirement_type: "baseline",
            placement_dashboard_inclusion: "baseline",
            placement_apply_to_all_apps: true,
            placement_application_ids: [],
          };
        }
        return {
          ...prev,
          placement_requirement_type: "application_specific",
          placement_dashboard_inclusion: "assigned",
          placement_apply_to_all_apps: false,
        };
      }
      return { ...prev, [field]: value };
    });
  }

  function togglePlacementApp(appId) {
    setAdminDraft((prev) => {
      const current = new Set(prev.placement_application_ids || []);
      if (current.has(appId)) current.delete(appId);
      else current.add(appId);
      return { ...prev, placement_application_ids: Array.from(current) };
    });
  }

  async function saveAdminRequirement(event) {
    event.preventDefault();
    setAdminRecordError("");
    setAdminRecordNotice("");

    if (!isGlobalAdmin) {
      setAdminRecordError("Global Admin access is required to modify catalog records.");
      return;
    }
    const manualMode = adminDraft.control_measure_type === "evidence_based";
    const resolvedControlTitle = manualMode
      ? (adminDraft.metric_name.trim() || adminDraft.control_title.trim())
      : adminDraft.control_title.trim();
    const resolvedControlDescription = manualMode
      ? (adminDraft.control_description.trim() || null)
      : (adminDraft.control_description.trim() || null);

    if (!adminDraft.requirement_title.trim() || !adminDraft.policy_title.trim() || !resolvedControlTitle) {
      setAdminRecordError("Requirement, Policy, and Control titles are required.");
      return;
    }
    const requiredAdminFields = [
      { label: "Requirement Description", value: adminDraft.requirement_description },
      { label: "Primary Risk Statement", value: adminDraft.risk_statement },
      { label: "Policy Jurisdiction", value: adminDraft.policy_jurisdiction },
      { label: "Policy Type", value: adminDraft.policy_type },
      { label: "Policy Status", value: adminDraft.policy_status },
      { label: "Policy Source", value: adminDraft.policy_source },
      { label: "Policy Description", value: adminDraft.policy_description },
    ];
    const missingRequiredFields = requiredAdminFields
      .filter((field) => !String(field.value || "").trim())
      .map((field) => field.label);
    if (missingRequiredFields.length > 0) {
      setAdminRecordError(`These fields are required: ${missingRequiredFields.join(", ")}`);
      return;
    }
    if (adminDraft.control_measure_type === "system_telemetry" && !adminDraft.metric_name.trim()) {
      setAdminRecordError("Metric is required when Measurement Source is Telemetry.");
      return;
    }
    if (manualMode && !resolvedControlDescription) {
      setAdminRecordError("Metric Definition is required when Measurement Source is Manual.");
      return;
    }

    setSavingAdminRecord(true);
    try {
      const normalizedRequirementId = (
        createMode || String(adminDraft.requirement_id || "").startsWith("__new__")
      ) ? null : (adminDraft.requirement_id || null);
      const thresholdValue = Number(adminDraft.threshold_value);
      const requirementType = adminDraft.placement_requirement_type === "application_specific"
        ? "application_specific"
        : "baseline";
      const resolvedDashboardInclusion = requirementType === "baseline" ? "baseline" : "assigned";
      const resolvedAppIds = requirementType === "baseline" ? [] : (adminDraft.placement_application_ids || []);
      const payload = {
        requirement_id: normalizedRequirementId,
        policy_id: adminDraft.policy_id || null,
        policy_title: adminDraft.policy_title.trim(),
        policy_jurisdiction: adminDraft.policy_jurisdiction.trim(),
        policy_source: adminDraft.policy_source.trim(),
        policy_description: adminDraft.policy_description.trim(),
        policy_type: adminDraft.policy_type.trim(),
        policy_status: adminDraft.policy_status.trim(),
        requirement_title: adminDraft.requirement_title.trim(),
        requirement_description: adminDraft.requirement_description.trim(),
        governance_category: adminDraft.governance_category,
        risk_statement: adminDraft.risk_statement.trim(),
        control_id: adminDraft.control_id || null,
        control_title: resolvedControlTitle,
        control_description: resolvedControlDescription,
        control_measure_type: adminDraft.control_measure_type,
        metric_name: adminDraft.metric_name.trim() || null,
        formula_expression: adminDraft.formula_expression.trim() || null,
        threshold: Number.isFinite(thresholdValue)
          ? {
            operator: adminDraft.threshold_operator || "lte",
            value: thresholdValue,
            unit: adminDraft.threshold_unit || "%",
          }
          : null,
        placement: {
          requirement_type: requirementType,
          dashboard_inclusion: resolvedDashboardInclusion,
          application_ids: resolvedAppIds,
          apply_to_all_apps: requirementType === "baseline",
        },
        set_by: currentUser?.email || "governance_admin",
      };

      const saved = await saveAdminRequirementRecord(payload);
      setAdminRecordNotice(
        `Saved to catalog and linked to ${saved?.assigned_app_count ?? 0} application(s).`,
      );
      setIsCreatingRequirement(false);

      let skip = 0;
      let total = Infinity;
      const merged = [];
      while (merged.length < total) {
        const response = await listRequirements({ skip, limit: REQUIREMENTS_PAGE_LIMIT });
        const items = Array.isArray(response?.items) ? response.items : [];
        total = Number(response?.total ?? items.length);
        merged.push(...items);
        if (items.length === 0) break;
        skip += items.length;
      }
      setAllRequirements(merged);

      const selected = merged.find((item) => String(item?.id) === String(saved?.requirement_id));
      if (selected) await selectResult(selected);
    } catch (err) {
      setAdminRecordError(err?.response?.data?.detail || err?.message || "Failed to save catalog record.");
    } finally {
      setSavingAdminRecord(false);
    }
  }

  async function deleteAdminRequirement() {
    setAdminRecordError("");
    setAdminRecordNotice("");
    if (!isGlobalAdmin) {
      setAdminRecordError("Global Admin access is required to delete catalog records.");
      return;
    }
    if (!selectedItem?.id || createMode || String(selectedItem.id).startsWith("__new__")) {
      setAdminRecordError("Select a requirement first.");
      return;
    }
    const confirmed = window.confirm("Delete this requirement permanently from the database?");
    if (!confirmed) return;

    setDeletingAdminRecord(true);
    try {
      await deleteAdminRequirementRecord(selectedItem.id);

      let skip = 0;
      let total = Infinity;
      const merged = [];
      while (merged.length < total) {
        const response = await listRequirements({ skip, limit: REQUIREMENTS_PAGE_LIMIT });
        const items = Array.isArray(response?.items) ? response.items : [];
        total = Number(response?.total ?? items.length);
        merged.push(...items);
        if (items.length === 0) break;
        skip += items.length;
      }
      setAllRequirements(merged);
      closeModal();
    } catch (err) {
      setAdminRecordError(err?.response?.data?.detail || err?.message || "Failed to delete catalog record.");
    } finally {
      setDeletingAdminRecord(false);
    }
  }

  const total = filteredResults.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, total);
  const pageItems = filteredResults.slice(pageStart, pageEnd);
  const trendingTickerItems = useMemo(() => {
    const dedup = new Map();
    for (const item of allRequirements) {
      const title = cleanRequirementText(item?.title || "");
      if (!title) continue;
      const key = normalizeText(title);
      if (!key || dedup.has(key)) continue;
      dedup.set(key, {
        id: String(item?.id || key),
        title,
        description: cleanNarrativeText(item?.description || "") || "No requirement definition available.",
      });
      if (dedup.size >= 10) break;
    }
    return Array.from(dedup.values());
  }, [allRequirements]);
  const selectedIndex = useMemo(
    () => filteredResults.findIndex((item) => item.id === selectedItem?.id),
    [filteredResults, selectedItem?.id],
  );

  const fallbackMeasureRows = useMemo(() => {
    if (!selectedRecord) return [];
    if (selectedRecord.measureRows.length > 0) return selectedRecord.measureRows;

    return selectedRecord.controls.map((control) => ({
      control_id: control.id,
      control_code: control.code,
      control_title: control.title,
      metric_name: control.metric_name,
      value: null,
      result: "NO_DATA",
      threshold: control.default_threshold,
      interpretation_text: "No live value for this app in the current time window.",
    }));
  }, [selectedRecord]);

  const selectedIsBaseRequirement = useMemo(() => {
    if (!selectedItem) return false;
    return isBaseRequirement(selectedItem, selectedDetail, selectedRecord?.scopeItem || null);
  }, [selectedItem, selectedDetail, selectedRecord?.scopeItem, foundationControlIds, catalogControlsByRequirementId, catalogControlsByRequirementTitle]);

  const canCreateInterpretation = Boolean(selectedItem?.id);
  const canSaveInterpretation = Boolean(selectedItem?.id && interpretAppId);
  const hasConnectedApps = connectedApps.length > 0;

  const populationOverview = useMemo(() => {
    const complianceRates = leaderboardComplianceSnapshots
      .map((item) => Number(item?.pass_rate))
      .filter((value) => Number.isFinite(value));

    const fallbackCompliance = (() => {
      const evaluatedRows = leaderboardRows.filter((row) => {
        const result = String(row?.benchmark_result || row?.result || "").toUpperCase();
        return result === "PASS" || result === "FAIL";
      });
      if (!evaluatedRows.length) return null;
      const passCount = evaluatedRows.filter((row) => String(row?.benchmark_result || row?.result || "").toUpperCase() === "PASS").length;
      return passCount / evaluatedRows.length;
    })();

    const complianceRate = complianceRates.length
      ? complianceRates.reduce((sum, value) => sum + value, 0) / complianceRates.length
      : fallbackCompliance;

    const tierToLevel = (tierValue) => {
      const text = String(tierValue || "").trim().toLowerCase();
      if (text === "very high" || text === "very_high" || text === "critical") return 4;
      if (text === "high") return 3;
      if (text === "medium" || text === "common") return 2;
      if (text === "low" || text === "foundation") return 1;
      return null;
    };

    const tierLevels = leaderboardTierSnapshots
      .map((snapshot) => tierToLevel(snapshot?.current_tier))
      .filter((value) => Number.isFinite(value));

    const fallbackTierLevels = connectedApps
      .map((app) => tierToLevel(app?.current_tier))
      .filter((value) => Number.isFinite(value));

    const levels = tierLevels.length ? tierLevels : fallbackTierLevels;
    const avgTierLevel = levels.length
      ? levels.reduce((sum, value) => sum + value, 0) / levels.length
      : null;

    const avgRiskScore = (() => {
      const rawScores = leaderboardTierSnapshots
        .map((snapshot) => Number(snapshot?.raw_score))
        .filter((value) => Number.isFinite(value));
      if (!rawScores.length) return null;
      return rawScores.reduce((sum, value) => sum + value, 0) / rawScores.length;
    })();

    const avgTierLabel = (() => {
      if (!Number.isFinite(avgTierLevel)) return "N/A";
      if (avgTierLevel < 1.5) return "Low";
      if (avgTierLevel < 2.5) return "Medium";
      if (avgTierLevel < 3.5) return "High";
      return "Very High";
    })();

    const tierDistribution = { Low: 0, Medium: 0, High: 0, "Very High": 0 };
    const sourceTiers = leaderboardTierSnapshots.length
      ? leaderboardTierSnapshots.map((snapshot) => snapshot?.current_tier)
      : connectedApps.map((app) => app?.current_tier);
    sourceTiers.forEach((tier) => {
      const level = tierToLevel(tier);
      if (level === 1) tierDistribution.Low += 1;
      if (level === 2) tierDistribution.Medium += 1;
      if (level === 3) tierDistribution.High += 1;
      if (level === 4) tierDistribution["Very High"] += 1;
    });

    return {
      populationCount: connectedApps.length,
      complianceRate,
      avgTierLabel,
      avgTierLevel,
      avgRiskScore,
      tierDistribution,
    };
  }, [leaderboardComplianceSnapshots, leaderboardTierSnapshots, connectedApps, leaderboardRows]);

  const kpiPerformanceItems = useMemo(() => {
    const map = new Map();
    for (const row of leaderboardRows) {
      const metric = String(row?.metric_name || "").trim();
      if (!metric) continue;
      if (!map.has(metric)) {
        map.set(metric, {
          id: metric,
          name: humanizeMetricName(metric),
          total: 0,
          evaluated: 0,
          pass: 0,
          fail: 0,
          withData: 0,
          noData: 0,
        });
      }
      const entry = map.get(metric);
      entry.total += 1;
      if (typeof row?.value === "number" && !Number.isNaN(row.value)) {
        entry.withData += 1;
      } else {
        entry.noData += 1;
      }
      const outcome = String(row?.benchmark_result || row?.result || "").toUpperCase();
      if (outcome === "PASS") {
        entry.pass += 1;
        entry.evaluated += 1;
      } else if (outcome === "FAIL") {
        entry.fail += 1;
        entry.evaluated += 1;
      }
    }

    return Array.from(map.values()).map((entry) => {
      const passRatePct = entry.evaluated > 0 ? (entry.pass / entry.evaluated) * 100 : null;
      const dataCoveragePct = entry.total > 0 ? (entry.withData / entry.total) * 100 : 0;
      const rankingScore = passRatePct === null
        ? dataCoveragePct * 0.35
        : passRatePct * 0.8 + dataCoveragePct * 0.2;
      return {
        id: entry.id,
        name: entry.name,
        score: rankingScore,
        passRatePct,
        dataCoveragePct,
        evaluated: entry.evaluated,
        total: entry.total,
        pass: entry.pass,
        fail: entry.fail,
        scoreText: passRatePct === null ? "No benchmark" : `${Math.round(passRatePct)}% pass`,
        meta: `Pass ${entry.pass}/${entry.evaluated || entry.total} | Data ${Math.round(dataCoveragePct)}%`,
      };
    });
  }, [leaderboardRows]);

  const topKpiItems = useMemo(() => (
    kpiPerformanceItems
      .filter((item) => Number.isFinite(item.passRatePct))
      .sort((a, b) => b.score - a.score || b.evaluated - a.evaluated || a.name.localeCompare(b.name))
      .slice(0, 5)
  ), [kpiPerformanceItems]);

  const worstKpiItems = useMemo(() => (
    kpiPerformanceItems
      .filter((item) => Number.isFinite(item.passRatePct))
      .sort((a, b) => a.score - b.score || b.fail - a.fail || a.name.localeCompare(b.name))
      .slice(0, 5)
  ), [kpiPerformanceItems]);

  const nonBaselineRequirementItems = useMemo(() => {
    const map = new Map();
    for (const scopeItem of leaderboardScopeItems) {
      if (scopeItem?.is_default) continue;
      const key = normalizeText(scopeItem?.title);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: cleanRequirementText(scopeItem?.title) || "Untitled requirement",
          scopeHits: 0,
          regulationSet: new Set(),
          jurisdictionSet: new Set(),
        });
      }
      const entry = map.get(key);
      entry.scopeHits += 1;
      if (scopeItem?.regulation_title) entry.regulationSet.add(scopeItem.regulation_title);
      if (scopeItem?.jurisdiction) entry.jurisdictionSet.add(scopeItem.jurisdiction);
    }

    return Array.from(map.values())
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        score: entry.scopeHits,
        scoreText: `${entry.scopeHits} apps`,
        meta: `${entry.regulationSet.size} regs | ${entry.jurisdictionSet.size} jurisdictions`,
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 5);
  }, [leaderboardScopeItems]);

  const complianceRatePct = Number.isFinite(populationOverview.complianceRate)
    ? Math.max(0, Math.min(100, populationOverview.complianceRate * 100))
    : null;
  const avgRiskLevelPct = Number.isFinite(populationOverview.avgTierLevel)
    ? Math.max(0, Math.min(100, (populationOverview.avgTierLevel / 4) * 100))
    : null;

  return (
    <div className={`catalog-layout${showLeaderboardPanel ? "" : " catalog-layout-single-panel"}`}>
      {showLeaderboardPanel ? (
      <aside className="card catalog-leaderboard-panel">
        <div className="catalog-leaderboard-header">
          <div className="catalog-leaderboard-heading-wrap">
            <span className="catalog-leaderboard-kicker">Risk Directive Style</span>
            <h3 className="catalog-leaderboard-heading">Leader Board</h3>
          </div>
          <span className="catalog-leaderboard-context-pill">System-wide</span>
        </div>
        <p className="catalog-leaderboard-copy">
          Live system-wide benchmark analytics for compliance posture, risk rating, KPI performance, and optional requirement adoption.
        </p>
        <div className="catalog-leaderboard-level-track" aria-hidden="true">
          <span className="catalog-leaderboard-level-dot is-active" />
          <span className="catalog-leaderboard-level-dot" />
          <span className="catalog-leaderboard-level-dot" />
          <span className="catalog-leaderboard-level-dot" />
        </div>
        {loadingLeaderboard ? (
          <p className="section-copy" style={{ marginBottom: "0.5rem" }}>Refreshing leaderboard signals...</p>
        ) : null}
        {leaderboardError ? (
          <p className="section-copy" style={{ marginBottom: "0.5rem", color: "var(--warning)" }}>{leaderboardError}</p>
        ) : null}
        <section className="catalog-leaderboard-section tone-accent">
          <div className="catalog-leaderboard-title">Population Averages</div>
          <div className="catalog-population-grid">
            <div className="catalog-population-card">
              <div className="catalog-population-label">Compliance Rate</div>
              <div className="catalog-population-value">
                {complianceRatePct === null ? "N/A" : `${Math.round(complianceRatePct)}%`}
              </div>
              <div className="catalog-population-track">
                <span
                  className="catalog-population-fill is-compliance"
                  style={{ width: `${complianceRatePct === null ? 0 : Math.max(6, Math.round(complianceRatePct))}%` }}
                />
              </div>
              <div className="catalog-population-meta">
                Across {populationOverview.populationCount} active app(s)
              </div>
            </div>
            <div className="catalog-population-card">
              <div className="catalog-population-label">Risk Rating</div>
              <div className="catalog-population-value">
                {populationOverview.avgTierLabel}
                {Number.isFinite(populationOverview.avgRiskScore) ? ` (${Math.round(populationOverview.avgRiskScore)})` : ""}
              </div>
              <div className="catalog-population-track">
                <span
                  className="catalog-population-fill is-risk"
                  style={{ width: `${avgRiskLevelPct === null ? 0 : Math.max(6, Math.round(avgRiskLevelPct))}%` }}
                />
              </div>
              <div className="catalog-population-meta">
                Low {populationOverview.tierDistribution.Low} | Medium {populationOverview.tierDistribution.Medium} | High {populationOverview.tierDistribution.High} | Very High {populationOverview.tierDistribution["Very High"]}
              </div>
            </div>
          </div>
        </section>
        <LeaderboardSection
          title="Top 5 Highest Performing KPIs"
          subtitle="Best benchmark pass-rate metrics across the current system population"
          items={topKpiItems}
          tone="positive"
          scaleMax={100}
          emptyText="No KPI benchmark performance data yet."
        />
        <LeaderboardSection
          title="Top 5 Worst Performing KPIs"
          subtitle="Metrics with the weakest benchmark pass-rate across the population"
          items={worstKpiItems}
          tone="negative"
          scaleMax={100}
          emptyText="No underperforming KPI metrics found."
        />
        <LeaderboardSection
          title="Most Popular Non-Baseline Requirements"
          subtitle="Optional requirements most frequently adopted by application teams"
          items={nonBaselineRequirementItems}
          tone="accent"
          emptyText="No optional (non-baseline) requirement adoption data yet."
        />
      </aside>
      ) : null}
      <section className="card catalog-panel">
      <div className="catalog-header-row">
        <div className="catalog-header-title-group">
          <h2 className="card-title" style={{ marginBottom: 0, borderBottom: "none", paddingBottom: 0 }}>
            Controls
          </h2>
          <span className="chip">{allRequirements.length} total</span>
        </div>
        <form onSubmit={runSearch} className="catalog-filter-inline catalog-filter-inline-header">
          <label
            className={`catalog-filter-field${query.trim() ? " is-active" : ""}`}
            title="Search by requirement title, regulation, or jurisdiction."
          >
            <FilterGlyph type="search" title="Search" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search requirements"
              className="query-input catalog-filter-input"
            />
          </label>

          <button type="submit" className="btn-primary catalog-btn-primary" disabled={loadingRequirements} title="Apply search">
            Apply
          </button>
          <button
            type="button"
            className="btn-secondary catalog-btn-secondary"
            onClick={clearSearchAndFilters}
            disabled={loadingRequirements}
            title="Reset search and sorting"
          >
            Reset
          </button>
        </form>
      </div>
      <p className="section-copy" style={{ marginTop: "0.45rem" }}>
        Browse and search the full regulatory requirements database.
      </p>

      {requirementsError ? <p className="error-text">{requirementsError}</p> : null}

      <div className="pagination-row" style={{ marginTop: "0.4rem" }}>
        <p className="pagination-meta">
          {loadingRequirements
            ? "Loading requirements..."
            : `Showing ${pageStart + 1}-${pageEnd} of ${total}`}
        </p>
        <div className="pagination-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={safePage <= 1 || loadingRequirements}
          >
            Prev
          </button>
          <span className="chip">Page {safePage} / {pageCount}</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
            disabled={safePage >= pageCount || loadingRequirements}
          >
            Next
          </button>
        </div>
      </div>

      {assignNotice ? <p className="section-copy" style={{ marginTop: "0.4rem", color: "var(--success)" }}>{assignNotice}</p> : null}
      {assignError ? <p className="error-text" style={{ marginTop: "0.4rem" }}>{assignError}</p> : null}

      <div className="catalog-list-wrap">
          <div className="catalog-section-header">
            <span className="catalog-section-header-title">Requirement List</span>
            {isGlobalAdmin ? (
              <button
                type="button"
                className="catalog-section-icon-action"
                onClick={startNewRequirementFlow}
                disabled={loadingRequirements}
                title="Create new requirement"
                aria-label="Create new requirement"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
            ) : null}
          </div>
          {pageItems.length > 0 ? (
            <>
          <div className="catalog-table-header">
            <div className={`catalog-header-cell${sortConfig.key === "control" ? " is-sort-active" : ""}`}>
              <button
                type="button"
                className={`catalog-sort-btn${sortConfig.key === "control" ? " is-active" : ""}`}
                onClick={() => onSortColumn("control")}
                title="Sort by control"
              >
                <span className="catalog-sort-label">
                  <FilterGlyph type="control" title="Control" />
                  <span>Control</span>
                </span>
                <span className="catalog-sort-indicator" aria-hidden="true">{sortIndicator("control")}</span>
              </button>
            </div>
            <div className={`catalog-header-cell${sortConfig.key === "requirement" ? " is-sort-active" : ""}`}>
              <button
                type="button"
                className={`catalog-sort-btn${sortConfig.key === "requirement" ? " is-active" : ""}`}
                onClick={() => onSortColumn("requirement")}
                title="Sort by requirement"
              >
                <span className="catalog-sort-label">
                  <FilterGlyph type="requirement" title="Requirement" />
                  <span>Requirement</span>
                </span>
                <span className="catalog-sort-indicator" aria-hidden="true">{sortIndicator("requirement")}</span>
              </button>
            </div>
            <div className="catalog-header-cell">
              <label className="catalog-header-select-wrap" title="Filter by geography">
                <span className="catalog-header-select-icon">
                  <FilterGlyph type="jurisdiction" title="Geography filter" />
                </span>
                <select
                  className={`catalog-header-filter${jurisdictionFilter ? " is-populated" : ""}`}
                  value={jurisdictionFilter}
                  onChange={(event) => setJurisdictionFilter(event.target.value)}
                  aria-label="Filter by geography"
                >
                  <option value="">Geography: All</option>
                  {jurisdictionOptions.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className={`catalog-header-cell${typeFilter !== "all" ? " is-filter-active" : ""}`}>
              <label className="catalog-header-select-wrap" title="Filter by requirement type">
                <span className="catalog-header-select-icon">
                  <FilterGlyph type="base" title="Type filter" />
                </span>
                <select
                  className={`catalog-header-filter${typeFilter !== "all" ? " is-populated" : ""}`}
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                  aria-label="Filter by requirement type"
                >
                  <option value="all">Type: All</option>
                  <option value="secretariat">Type: Secretariat</option>
                  <option value="application_specific">Type: Application Specific</option>
                </select>
              </label>
            </div>
          </div>
          <ul className="catalog-row-list">
            {pageItems.map((item) => {
              const scopeItem = resolveScopeItem(item);
              const titleKey = normalizeText(item?.title);
              const meta = requirementMetaByTitle.get(titleKey);
              const jurisdictionsForRow = Array.from(meta?.jurisdictions || []);
              if (item?.jurisdiction && !jurisdictionsForRow.includes(item.jurisdiction)) {
                jurisdictionsForRow.push(item.jurisdiction);
              }
              const controls = resolveLinkedControls(item, null, scopeItem);
              const controlNames = controls
                .map((control) => stripBulletChars(control?.title || ""))
                .filter(Boolean);
              const controlCell = controlNames.length > 0
                ? summarizeLabels(controlNames)
                : "Control mapping unavailable";
              const isBase = isBaseRequirement(item, null, scopeItem);
              const requirementTypeLabel = isBase ? "Secretariat" : "Application Specific";
              const hasGovernanceCategory = Boolean(canonicalGovernanceCategory(item?.category || ""));
              const currentPolicyStatus = String(item?.policy_status || "").trim().toLowerCase() === "inactive"
                ? "Inactive"
                : "Active";
              const nextPolicyStatus = currentPolicyStatus === "Active" ? "Inactive" : "Active";
              const isStatusToggleBusy = togglingRequirementStatusId === String(item?.id || "").trim();
              return (
                <li key={item.id} className="catalog-row-item">
                  <div className="catalog-row-item-inner">
                    <button
                      type="button"
                      className={`catalog-row-btn${selectedItem?.id === item.id ? " active" : ""}`}
                      onClick={() => selectResult(item)}
                    >
                      <span className="catalog-row-col">{controlCell}</span>
                      <span className="catalog-row-col catalog-row-requirement">{cleanRequirementText(item.title) || "Untitled requirement"}</span>
                      <span className="catalog-row-col">{summarizeLabels(jurisdictionsForRow.map((value) => stripBulletChars(value)))}</span>
                      <span className="catalog-row-col">
                        {isBase ? (
                          <span className="catalog-badge-yes">{requirementTypeLabel}</span>
                        ) : (
                          <span className="catalog-badge-no">{requirementTypeLabel}</span>
                        )}
                      </span>
                    </button>
                    <div className="catalog-row-actions">
                      <button
                        type="button"
                        className="catalog-row-icon-action"
                        onClick={() => openAssignRequirementModal(item)}
                        disabled={assigningRequirement || connectedApps.length === 0 || !hasGovernanceCategory}
                        title={
                          !hasGovernanceCategory
                            ? "Requirement must have a valid Governance Category before assignment."
                            : (connectedApps.length === 0 ? "No connected application available to assign." : "Assign this requirement to an application dashboard.")
                        }
                        aria-label="Assign requirement"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M5 12h9" />
                          <path d="m11 6 6 6-6 6" />
                          <path d="M19 5v14" />
                        </svg>
                      </button>
                      {isGlobalAdmin ? (
                        <button
                          type="button"
                          className={`catalog-row-icon-action ${currentPolicyStatus === "Active" ? "is-status-active" : "is-status-inactive"}`}
                          onClick={() => toggleRequirementStatus(item)}
                          disabled={isStatusToggleBusy}
                          title={`${currentPolicyStatus} - click to set ${nextPolicyStatus}`}
                          aria-label={`Set requirement status to ${nextPolicyStatus}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M5 3v18" />
                            <path d="M5 4h11l-2.5 4L16 12H5z" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
            </>
          ) : (
            !loadingRequirements && <p className="section-copy" style={{ margin: "0.35rem 0.2rem" }}>No matching requirements found.</p>
          )}
      </div>
      <div className="catalog-list-trending">
        <div className="catalog-list-trending-header">
          <span className="catalog-list-trending-title">Trending Requirements</span>
          <span className="catalog-list-trending-subtitle">System-wide latest requirement highlights</span>
        </div>
        {trendingTickerItems.length ? (
          <div className="catalog-list-trending-window">
            <div className="catalog-list-trending-track">
              {[...trendingTickerItems, ...trendingTickerItems].map((item, idx) => (
                <div key={`catalog-trending-${item.id}-${idx}`} className="catalog-list-trending-item">
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="section-copy" style={{ margin: "0.35rem 0" }}>
            No requirement highlights available yet.
          </p>
        )}
      </div>

      {assignModalRequirement ? (
        <div
          className="catalog-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Assign requirement to application"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeAssignRequirementModal();
          }}
        >
          <div className="catalog-modal catalog-animate-enter" style={{ width: "min(520px, 100%)" }}>
            <div className="catalog-modal-header">
              <div className="catalog-modal-heading">
                <h3>Assign Requirement</h3>
                <p>{cleanRequirementText(assignModalRequirement?.title) || "Untitled requirement"}</p>
              </div>
            </div>
            <div className="catalog-modal-section catalog-modal-mini-section" style={{ marginTop: 0 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="detail-label">Chosen Application</span>
                <select
                  className="query-input catalog-contrast-select"
                  value={assignTargetAppId}
                  onChange={(event) => setAssignTargetAppId(event.target.value)}
                  disabled={assigningRequirement}
                >
                  <option value="">Select application</option>
                  {connectedApps.map((app) => (
                    <option key={app.id} value={app.id}>{app.name || app.id}</option>
                  ))}
                </select>
              </label>
            </div>
            {assignError ? <p className="error-text" style={{ marginTop: 0 }}>{assignError}</p> : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.45rem", marginTop: "0.65rem" }}>
              <button type="button" className="btn-secondary" onClick={closeAssignRequirementModal} disabled={assigningRequirement}>
                Cancel
              </button>
              <button type="button" className="btn-primary catalog-action-btn" onClick={assignRequirementToApplication} disabled={assigningRequirement || !assignTargetAppId}>
                {assigningRequirement ? "Assigning..." : "Assign"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedItem ? (
        <div
          className="catalog-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Requirement detail"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div className="catalog-modal catalog-animate-enter">
            <div className="catalog-modal-header">
              <div className="catalog-modal-heading">
                <h3>{createMode ? "Create Requirement" : "Requirement Detail"}</h3>
                <p>
                  {createMode
                    ? `Step ${adminFormStep} of ${maxAdminFormStep}: ${ADMIN_FORM_STEPS[adminFormStep - 1]}`
                    : (cleanNarrativeText(selectedDetail?.title || selectedItem?.title) || "Untitled requirement")}
                </p>
              </div>
              <div className="catalog-modal-nav">
                {!createMode ? (
                  <>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={selectedIndex <= 0}
                      onClick={() => {
                        if (selectedIndex > 0) selectResult(filteredResults[selectedIndex - 1]);
                      }}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={selectedIndex < 0 || selectedIndex >= filteredResults.length - 1}
                      onClick={() => {
                        if (selectedIndex >= 0 && selectedIndex < filteredResults.length - 1) {
                          selectResult(filteredResults[selectedIndex + 1]);
                        }
                      }}
                    >
                      Next
                    </button>
                  </>
                ) : null}
                <button type="button" className="btn-secondary" onClick={closeModal}>
                  Close
                </button>
              </div>
            </div>

            {!createMode && !hasConnectedApps ? (
              <p className="section-copy" style={{ marginBottom: "0.45rem" }}>
                No connected applications available. Connect an application to enable interpretation actions.
              </p>
            ) : !createMode ? (
              <label className="catalog-modal-app-select">
                <span className="detail-label">
                  Application Context {makeLegendIcon("Detail, baseline flag, and interpretation history are shown for this selected app context.")}
                </span>
                <select
                  className="query-input"
                  value={interpretAppId}
                  onChange={(event) => setInterpretAppId(event.target.value)}
                  disabled={savingInterpretation}
                >
                  <option value="">Select application</option>
                  {connectedApps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name || app.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {!createMode && loadingAppContext ? (
              <p className="section-copy" style={{ marginBottom: "0.45rem" }}>Refreshing app context...</p>
            ) : null}
            {loadingDetail ? <p className="section-copy">Loading detail...</p> : null}
            {detailError ? <p className="error-text">{detailError}</p> : null}

            {!loadingDetail && !detailError && selectedDetail ? (
              <>
                {!createMode ? (
                  <div className="catalog-modal-flow">
                    <span className="catalog-flow-chip is-active">1. Read Requirement Record</span>
                    <span className="catalog-flow-chip">2. Review KPI Mapping</span>
                    <span className="catalog-flow-chip">3. Populate App Interpretation</span>
                    {isGlobalAdmin ? <span className="catalog-flow-chip">4. Requirement Update</span> : null}
                  </div>
                ) : null}

                {!createMode ? (
                  <div className="catalog-modal-section catalog-modal-card">
                  <div className="catalog-modal-card-title">
                    1. Requirement Record {makeLegendIcon("Use the form builder section below to create or edit requirement records.")}
                  </div>
                    <div className="detail-grid" style={{ marginBottom: "0.7rem" }}>
                    <div className="detail-row">
                      <span className="detail-label">Requirement</span>
                      <span className="detail-value" style={{ whiteSpace: "normal" }}>
                        {cleanNarrativeText(selectedDetail.title) || "Untitled requirement"}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Interpretation (base text)</span>
                      <span className="detail-value" style={{ whiteSpace: "normal" }}>
                        {cleanNarrativeText(selectedDetail.description) || "No base interpretation text available."}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Governance Category</span>
                      <span className="detail-value">{selectedDetail.category || selectedRecord?.scopeItem?.category || "Unassigned"}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Base Requirement</span>
                      <span className="detail-value">
                        {selectedIsBaseRequirement
                          ? "Yes - included in base governance requirements."
                          : "No - optional requirement that can be added to a selected application dashboard."}
                      </span>
                    </div>
                    </div>
                  <>
                    <div className="catalog-modal-section catalog-modal-mini-section">
                      <div className="catalog-modal-section-title">
                        Regulations {makeLegendIcon("All regulation records linked to this requirement text in the database.")}
                      </div>
                      <div className="suggestions-wrap" style={{ marginBottom: "0.25rem" }}>
                        {(selectedRecord?.regulations || []).length ? (
                          selectedRecord.regulations.map((name) => <span key={name} className="chip">{name}</span>)
                        ) : (
                          <span className="section-copy" style={{ marginBottom: 0 }}>No regulation links found.</span>
                        )}
                      </div>
                    </div>

                    <div className="catalog-modal-section catalog-modal-mini-section">
                      <div className="catalog-modal-section-title">
                        Jurisdictions {makeLegendIcon("All jurisdictions linked to the regulatory records above.")}
                      </div>
                      <div className="suggestions-wrap" style={{ marginBottom: "0.25rem" }}>
                        {(selectedRecord?.jurisdictions || []).length ? (
                          selectedRecord.jurisdictions.map((name) => <span key={name} className="chip">{name}</span>)
                        ) : (
                          <span className="section-copy" style={{ marginBottom: 0 }}>No jurisdiction links found.</span>
                        )}
                      </div>
                    </div>
                  </>
                </div>
                ) : null}

                {!createMode ? (
                  <div className="catalog-modal-section catalog-modal-card">
                  <div className="catalog-modal-card-title">
                    2. Control and KPI Mapping {makeLegendIcon("Telemetry-backed control, measure, value, and formula records linked to this requirement.")}
                  </div>
                  {fallbackMeasureRows.length ? (
                    <div className="catalog-measure-list">
                      {fallbackMeasureRows.map((row, index) => (
                        <div
                          key={`${row.control_id || "ctrl"}-${row.metric_name || "metric"}-${index}`}
                          className="catalog-measure-card"
                        >
                          <p><strong>Control:</strong> {row.control_title || "Untitled control"}</p>
                          <p><strong>Measure:</strong> {humanizeMetricName(row.metric_name)}</p>
                          <p><strong>Value:</strong> {formatMetricValue(row.value, row.threshold)}{row.result ? ` (${row.result})` : ""}</p>
                          <p><strong>Formula:</strong> {formulaToPlainEnglish(row.metric_name, row.threshold)}</p>
                          <p><strong>Interpretation:</strong> {row.interpretation_text || "No interpretation available."}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="section-copy" style={{ marginBottom: 0 }}>
                      No linked controls or KPI bindings found for this requirement.
                    </p>
                  )}
                  </div>
                ) : null}

                {!createMode ? (
                  <div className="catalog-modal-section catalog-modal-card">
                  <div className="catalog-modal-section-header">
                    <div className="catalog-modal-card-title">
                      3. User Interpretation History {makeLegendIcon("Previously saved app-specific interpretations for this requirement.")}
                    </div>
                    <button
                      type="button"
                      className="btn-primary catalog-action-btn"
                      title="Draft a new app-specific interpretation. KPI binding and governance category remain inherited."
                      disabled={!canCreateInterpretation || !hasConnectedApps}
                      onClick={() => {
                        setShowInterpretForm((prev) => !prev);
                        setInterpretError("");
                        setInterpretNotice("");
                      }}
                    >
                      {showInterpretForm ? "Hide Form" : "Create Interpretation"}
                    </button>
                  </div>
                  <p className="catalog-modal-helper-text">
                    Populate after reading: choose application context above, review prior interpretations, then add your new interpretation.
                  </p>

                  {(selectedRecord?.interpretationHistory || []).length ? (
                    <ul className="catalog-history-list">
                      {selectedRecord.interpretationHistory.map((historyItem) => (
                        <li key={historyItem.id} className="catalog-history-item">
                          <p className="catalog-history-meta">
                            {historyItem.set_by || "unknown_user"} - {formatTimestamp(historyItem.set_at)}
                          </p>
                          <p>{historyItem.interpretation_text || "No text provided."}</p>
                          {historyItem.control_title ? (
                            <p className="catalog-history-subtle">Control: {historyItem.control_title}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="section-copy" style={{ marginBottom: 0 }}>
                      No app-specific interpretations saved yet for this requirement in the selected app context.
                    </p>
                  )}

                  {showInterpretForm ? (
                    <form onSubmit={saveInterpretation} className="catalog-interpret-form catalog-animate-enter">
                      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)" }}>
                        New Interpretation {makeLegendIcon("Creates an app-specific interpretation for this requirement using existing KPI and governance category mappings.")}
                      </div>

                      <p className="section-copy" style={{ marginBottom: 0 }}>
                        This interpretation is attached to the requirement and inherited KPI mapping; metric definition remains locked.
                      </p>

                      <label style={{ display: "grid", gap: 4 }}>
                        <span className="detail-label">Interpretation text</span>
                        <textarea
                          className="query-input"
                          value={interpretText}
                          onChange={(event) => setInterpretText(event.target.value)}
                          rows={4}
                          placeholder="Write app-specific interpretation for this requirement..."
                          disabled={savingInterpretation}
                        />
                      </label>

                      {interpretError ? <p className="error-text" style={{ marginBottom: 0 }}>{interpretError}</p> : null}
                      {interpretNotice ? <p className="section-copy" style={{ marginBottom: 0, color: "var(--success)" }}>{interpretNotice}</p> : null}

                      <div style={{ display: "flex", gap: "0.45rem" }}>
                        <button type="submit" className="btn-primary catalog-action-btn" disabled={savingInterpretation || !canCreateInterpretation || !canSaveInterpretation}>
                          {savingInterpretation ? "Saving..." : "Save Interpretation"}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setShowInterpretForm(false);
                            setInterpretError("");
                          }}
                          disabled={savingInterpretation}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
                  </div>
                ) : null}

                {isGlobalAdmin ? (
                  <div className={`catalog-modal-section catalog-modal-card${createMode ? " catalog-admin-builder" : ""}`}>
                    <div className="catalog-modal-section-header">
                      <div className="catalog-modal-card-title">
                        {createMode ? "New Requirement Wizard" : "Requirement Record Editor"}
                        {makeLegendIcon("Global Admin only. Step-based form for creating or editing requirement records.")}
                      </div>
                    </div>
                    {createMode ? (
                      <div className="catalog-modal-section catalog-modal-mini-section catalog-scope-top">
                        <div className="catalog-modal-section-title">
                          Requirement Scope {makeLegendIcon("Choose who this requirement applies to: Secretariat (system-wide) or a specific application.")}
                        </div>
                        <div className="catalog-scope-options catalog-scope-options-compact">
                          <label className="catalog-scope-option">
                            <input
                              type="radio"
                              name="requirement-scope-top"
                              value="baseline"
                              checked={adminDraft.placement_requirement_type === "baseline"}
                              onChange={(event) => updateAdminDraft("placement_requirement_type", event.target.value)}
                              disabled={savingAdminRecord || deletingAdminRecord}
                            />
                            <span className="catalog-scope-option-text">
                              Secretariat {makeLegendIcon("System-wide requirement visible across all connected applications.")}
                            </span>
                          </label>
                          <label className="catalog-scope-option">
                            <input
                              type="radio"
                              name="requirement-scope-top"
                              value="application_specific"
                              checked={adminDraft.placement_requirement_type === "application_specific"}
                              onChange={(event) => updateAdminDraft("placement_requirement_type", event.target.value)}
                              disabled={savingAdminRecord || deletingAdminRecord}
                            />
                            <span className="catalog-scope-option-text">
                              Specific Application {makeLegendIcon("Requirement is scoped only to the selected application(s).")}
                            </span>
                          </label>
                        </div>
                        {adminDraft.placement_requirement_type === "baseline" ? (
                          <p className="catalog-modal-helper-text">
                            Secretariat requirements are auto-assigned across all active connected applications.
                          </p>
                        ) : (
                          <>
                            {(connectedApps || []).length ? (
                              <div className="suggestions-wrap catalog-scope-chip-wrap">
                                {(connectedApps || []).map((app) => {
                                  const appId = String(app?.id || "");
                                  const selected = (adminDraft.placement_application_ids || []).includes(appId);
                                  return (
                                    <button
                                      key={appId}
                                      type="button"
                                      className={`chip catalog-scope-chip${selected ? " is-active" : ""}`}
                                      onClick={() => togglePlacementApp(appId)}
                                      disabled={savingAdminRecord || deletingAdminRecord}
                                    >
                                      {selected ? "Selected: " : ""}{app?.name || appId}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="catalog-modal-helper-text">
                                No active connected applications are available for assignment.
                              </p>
                            )}
                            {!hasAppScopeSelection ? (
                              <p className="error-text" style={{ marginBottom: 0 }}>
                                Select at least one application for Specific Application scope.
                              </p>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                    <p className="catalog-modal-helper-text catalog-admin-helper">
                      {createMode
                        ? "Choose scope at the top, then complete each step. Create is enabled on the final step."
                        : "Edit this requirement directly using the same four-step flow."}
                    </p>
                    <div className="catalog-modal-flow catalog-wizard-stepper">
                      {ADMIN_FORM_STEPS.map((stepLabel, index) => {
                        const stepNumber = index + 1;
                        return (
                          <button
                            key={stepLabel}
                            type="button"
                            className={`catalog-flow-chip${adminFormStep === stepNumber ? " is-active" : ""}`}
                            onClick={() => setAdminFormStep(stepNumber)}
                            disabled={savingAdminRecord || deletingAdminRecord}
                          >
                            <span className="catalog-flow-chip-index">{stepNumber}</span>
                            <span className="catalog-flow-chip-copy">{stepLabel}</span>
                          </button>
                        );
                      })}
                    </div>
                    <form onSubmit={saveAdminRequirement} className="catalog-interpret-form catalog-admin-form catalog-animate-enter">
                      {adminFormStep === 1 ? (
                        <div className="catalog-modal-section catalog-modal-mini-section catalog-wizard-stage">
                        <div className="catalog-modal-section-header">
                          <div className="catalog-modal-section-title">
                            Requirement Profile {makeLegendIcon("Define the core requirement record and its governance placement.")}
                          </div>
                        </div>
                        <div className="detail-grid catalog-wizard-grid">
                          <label className="catalog-wizard-field">
                            <span className="detail-label">
                              Requirement Title {makeLegendIcon("Short unique title for the requirement record.")}
                            </span>
                            <input className="query-input catalog-field-input" value={adminDraft.requirement_title} onChange={(event) => updateAdminDraft("requirement_title", event.target.value)} disabled={savingAdminRecord || deletingAdminRecord} />
                          </label>
                          <label className="catalog-wizard-field">
                            <span className="detail-label">
                              Governance Category {makeLegendIcon("Select one of the 9 governance categories this requirement belongs to.")}
                            </span>
                            <select className="query-input catalog-field-input catalog-contrast-select" value={adminDraft.governance_category} onChange={(event) => updateAdminDraft("governance_category", event.target.value)} disabled={savingAdminRecord || deletingAdminRecord}>
                              {GOVERNANCE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                            </select>
                          </label>
                          <label className="catalog-wizard-field catalog-wizard-field-full">
                            <span className="detail-label">
                              Requirement Description (Required) {makeLegendIcon("Plain-English summary of the obligation this requirement represents.")}
                            </span>
                            <textarea className="query-input catalog-field-input" rows={4} maxLength={1200} value={adminDraft.requirement_description} onChange={(event) => updateAdminDraft("requirement_description", event.target.value)} disabled={savingAdminRecord || deletingAdminRecord} placeholder="Plain-English summary of one distinct obligation." required />
                          </label>
                          <label className="catalog-wizard-field catalog-wizard-field-full">
                            <span className="detail-label">
                              Primary Risk Statement (Required) {makeLegendIcon("Describe the key governance risk this requirement is intended to mitigate.")}
                            </span>
                            <input className="query-input catalog-field-input" value={adminDraft.risk_statement} onChange={(event) => updateAdminDraft("risk_statement", event.target.value)} placeholder="Plain-English risk addressed by this requirement" disabled={savingAdminRecord || deletingAdminRecord} required />
                          </label>
                        </div>
                        </div>
                      ) : null}

                      {adminFormStep === 2 ? (
                        <div className="catalog-modal-section catalog-modal-mini-section catalog-wizard-stage">
                        <div className="catalog-modal-section-header">
                          <div className="catalog-modal-section-title">
                            Policy Mapping {makeLegendIcon("Link this requirement to its governing policy metadata.")}
                          </div>
                        </div>
                        <div className="detail-grid catalog-wizard-grid">
                          <label className="catalog-wizard-field">
                            <span className="detail-label">
                              Policy Title {makeLegendIcon("Official policy or regulation title linked to this requirement.")}
                            </span>
                            <input className="query-input catalog-field-input" value={adminDraft.policy_title} onChange={(event) => updateAdminDraft("policy_title", event.target.value)} disabled={savingAdminRecord || deletingAdminRecord} />
                          </label>
                          <label className="catalog-wizard-field">
                            <span className="detail-label">
                              Policy Jurisdiction (Required) {makeLegendIcon("Geographic or organizational jurisdiction where the policy applies.")}
                            </span>
                            <input className="query-input catalog-field-input" value={adminDraft.policy_jurisdiction} onChange={(event) => updateAdminDraft("policy_jurisdiction", event.target.value)} disabled={savingAdminRecord || deletingAdminRecord} required />
                          </label>
                          <label className="catalog-wizard-field">
                            <span className="detail-label">
                              Policy Source (Required) {makeLegendIcon("Official source body or document origin for the policy (for example: UN CEB, EU Parliament, OECD).")}
                            </span>
                            <input className="query-input catalog-field-input" value={adminDraft.policy_source} onChange={(event) => updateAdminDraft("policy_source", event.target.value)} disabled={savingAdminRecord || deletingAdminRecord} required />
                          </label>
                          <label className="catalog-wizard-field">
                            <span className="detail-label">
                              Policy Type (Required) {makeLegendIcon("Classify policy scope: global, regional, domain, enterprise, divisional, or application.")}
                            </span>
                            <select className="query-input catalog-field-input catalog-contrast-select" value={adminDraft.policy_type} onChange={(event) => updateAdminDraft("policy_type", event.target.value)} disabled={savingAdminRecord || deletingAdminRecord} required>
                              {POLICY_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
                            </select>
                          </label>
                          <label className="catalog-wizard-field">
                            <span className="detail-label">
                              Policy Status (Required) {makeLegendIcon("Active policies are available to non-admin users; inactive policies are hidden from standard views.")}
                            </span>
                            <select className="query-input catalog-field-input catalog-contrast-select" value={adminDraft.policy_status} onChange={(event) => updateAdminDraft("policy_status", event.target.value)} disabled={savingAdminRecord || deletingAdminRecord} required>
                              <option value="Active">Active</option>
                              <option value="Inactive">Inactive</option>
                            </select>
                          </label>
                          <label className="catalog-wizard-field catalog-wizard-field-full">
                            <span className="detail-label">
                              Policy Description (Required) {makeLegendIcon("Plain-English objective and intended governance outcome of this policy document.")}
                            </span>
                            <textarea className="query-input catalog-field-input" rows={4} value={adminDraft.policy_description} onChange={(event) => updateAdminDraft("policy_description", event.target.value)} disabled={savingAdminRecord || deletingAdminRecord} placeholder="Summarize what this policy is intended to achieve in practice." required />
                          </label>
                        </div>
                        </div>
                      ) : null}

                      {adminFormStep === 3 ? (
                        <div className="catalog-modal-section catalog-modal-mini-section catalog-wizard-stage">
                        <div className="catalog-modal-section-title">
                          Control and KPI Mapping {makeLegendIcon("Define how conformance is measured through telemetry or manual attestation KPI definitions.")}
                        </div>
                        <div className="detail-grid catalog-wizard-grid">
                        <div className="catalog-wizard-mode-panel">
                          <label className="catalog-wizard-field">
                            <span className="detail-label">
                              Governance Category {makeLegendIcon("Select the governance category for this KPI mapping. Telemetry metric results are filtered to this category.")}
                            </span>
                            <select
                              className="query-input catalog-field-input catalog-contrast-select"
                              value={adminDraft.governance_category}
                              onChange={(event) => updateAdminDraft("governance_category", event.target.value)}
                              disabled={savingAdminRecord || deletingAdminRecord}
                            >
                              {GOVERNANCE_CATEGORIES.map((category) => (
                                <option key={category} value={category}>{category}</option>
                              ))}
                            </select>
                          </label>
                          <span className="detail-label catalog-wizard-inline-label">
                            Measurement Source {makeLegendIcon("Telemetry uses system metrics; Manual requires user-defined KPI attestation details.")}
                          </span>
                          <div className="catalog-measure-mode-wrap">
                          <label className="catalog-measure-mode">
                            <input
                              type="radio"
                              name="control-measure-source"
                              value="system_telemetry"
                              checked={adminDraft.control_measure_type === "system_telemetry"}
                              onChange={(event) => updateAdminDraft("control_measure_type", event.target.value)}
                              disabled={savingAdminRecord || deletingAdminRecord}
                            />
                            <span className="catalog-scope-option-text">
                              Telemetry {makeLegendIcon("Select one existing KPI from platform telemetry; control details are auto-generated.")}
                            </span>
                          </label>
                          <label className="catalog-measure-mode">
                            <input
                              type="radio"
                              name="control-measure-source"
                              value="evidence_based"
                              checked={adminDraft.control_measure_type === "evidence_based"}
                              onChange={(event) => updateAdminDraft("control_measure_type", event.target.value)}
                              disabled={savingAdminRecord || deletingAdminRecord}
                            />
                            <span className="catalog-scope-option-text">
                              Manual {makeLegendIcon("Define KPI name and definition for evidence-based manual attestation.")}
                            </span>
                          </label>
                          </div>
                        </div>
                        {adminDraft.control_measure_type === "system_telemetry" ? (
                          <div className="catalog-wizard-field catalog-wizard-field-full">
                              <span className="detail-label">
                                Metric Name and Definition {makeLegendIcon("Choose one available telemetry KPI to auto-populate control title and description.")}
                              </span>
                              <div className="catalog-metric-toolbar">
                                <span className="catalog-modal-helper-text" style={{ margin: 0 }}>
                                  {searchedTelemetryMetrics.length} metric{searchedTelemetryMetrics.length === 1 ? "" : "s"} for {adminDraft.governance_category}
                                </span>
                                {searchedTelemetryMetrics.length > 6 ? (
                                  <button
                                    type="button"
                                    className="btn-secondary btn-xs"
                                    onClick={() => setShowAllMetricResults((prev) => !prev)}
                                    disabled={savingAdminRecord || deletingAdminRecord}
                                  >
                                    {showAllMetricResults ? "Show less" : `Show all (${searchedTelemetryMetrics.length})`}
                                  </button>
                                ) : null}
                              </div>
                              <div className="catalog-metric-browser">
                              <label className="catalog-metric-filter-field">
                                <span className="catalog-metric-filter-icon" aria-hidden="true">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="11" cy="11" r="7" />
                                    <path d="m20 20-3.5-3.5" />
                                  </svg>
                                </span>
                                <input
                                  type="text"
                                  className="query-input catalog-field-input catalog-metric-filter-input"
                                  placeholder="Filter telemetry KPIs"
                                  value={metricFilterQuery}
                                  onChange={(event) => setMetricFilterQuery(event.target.value)}
                                  disabled={savingAdminRecord || deletingAdminRecord}
                                />
                              </label>
                              <div className="catalog-metric-picker catalog-metric-picker-compact" role="listbox" aria-label="Telemetry metrics">
                                {searchedTelemetryMetrics.length ? (
                                  visibleTelemetryMetrics.map((metric) => {
                                    const active = adminDraft.metric_name === metric.value;
                                    return (
                                      <button
                                        key={metric.value}
                                        type="button"
                                        className={`catalog-metric-option${active ? " is-active" : ""}`}
                                        onClick={() => updateAdminDraft("metric_name", metric.value)}
                                        disabled={savingAdminRecord || deletingAdminRecord}
                                      >
                                        <span className="catalog-metric-option-title">{metric.label}</span>
                                        <span className="catalog-metric-option-subtitle">
                                          {metricDefinitionPlainEnglish(metric.value, metric.description, metric.expression_preview)}
                                        </span>
                                      </button>
                                    );
                                  })
                                ) : (
                                  <p className="catalog-modal-helper-text" style={{ margin: "0.3rem 0" }}>
                                    No telemetry metrics match the current governance category or filter.
                                  </p>
                                )}
                              </div>
                              <div className="catalog-metric-preview">
                                <div className="catalog-metric-preview-title-wrap">
                                  <span className="catalog-metric-preview-icon" aria-hidden="true">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M3 6h18" />
                                      <path d="M7 12h10" />
                                      <path d="M10 18h4" />
                                    </svg>
                                  </span>
                                  <p className="catalog-metric-preview-title">
                                    {selectedTelemetryMetric
                                      ? metricNamePlainEnglish(selectedTelemetryMetric.value)
                                      : "Select a telemetry KPI"}
                                  </p>
                                </div>
                                <p className="catalog-metric-preview-copy">
                                  {selectedTelemetryMetric
                                    ? metricCalculationNarrative(selectedTelemetryMetric)
                                    : "Choose one KPI from the list to preview plain-English definition and calculation logic."}
                                </p>
                              </div>
                              </div>
                          </div>
                        ) : (
                          <>
                            <p className="catalog-modal-helper-text" style={{ marginBottom: 0 }}>
                              Control requires manual attestation and evidence of conformance with the requirement.
                            </p>
                            <label className="catalog-wizard-field">
                              <span className="detail-label">
                                Metric Name {makeLegendIcon("Enter the KPI name used for this manual control attestation.")}
                              </span>
                              <input
                                className="query-input catalog-field-input"
                                value={adminDraft.metric_name}
                                onChange={(event) => updateAdminDraft("metric_name", event.target.value)}
                                disabled={savingAdminRecord || deletingAdminRecord}
                                placeholder="Example: Human Oversight Evidence Coverage"
                              />
                            </label>
                            <label className="catalog-wizard-field catalog-wizard-field-full">
                              <span className="detail-label">
                                Metric Definition {makeLegendIcon("Describe in plain English how this KPI value is assessed and what evidence is required.")}
                              </span>
                              <textarea
                                className="query-input catalog-field-input"
                                rows={3}
                                value={adminDraft.control_description}
                                onChange={(event) => updateAdminDraft("control_description", event.target.value)}
                                disabled={savingAdminRecord || deletingAdminRecord}
                                placeholder="Example: Percentage of reviewed samples with signed monthly oversight evidence."
                              />
                            </label>
                          </>
                        )}
                        </div>
                        </div>
                      ) : null}

                      {adminRecordError ? <p className="error-text" style={{ marginBottom: 0 }}>{adminRecordError}</p> : null}
                      {adminRecordNotice ? <p className="section-copy" style={{ marginBottom: 0, color: "var(--success)" }}>{adminRecordNotice}</p> : null}

                      <div className="catalog-wizard-footer">
                        <div className="catalog-wizard-footer-left">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setAdminFormStep((prev) => Math.max(1, prev - 1))}
                            disabled={savingAdminRecord || deletingAdminRecord || adminFormStep === 1}
                          >
                            Previous Step
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setAdminFormStep((prev) => Math.min(maxAdminFormStep, prev + 1))}
                            disabled={savingAdminRecord || deletingAdminRecord || adminFormStep === maxAdminFormStep}
                          >
                            Next Step
                          </button>
                        </div>
                        <div className="catalog-wizard-footer-right">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={closeModal}
                          disabled={savingAdminRecord || deletingAdminRecord}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={deleteAdminRequirement}
                          disabled={savingAdminRecord || deletingAdminRecord || !selectedItem?.id || createMode || String(selectedItem?.id || "").startsWith("__new__")}
                        >
                          {deletingAdminRecord ? "Deleting..." : "Delete"}
                        </button>
                        <button
                          type="submit"
                          className="btn-primary catalog-action-btn"
                          disabled={
                            savingAdminRecord
                            || deletingAdminRecord
                            || adminFormStep !== maxAdminFormStep
                            || !hasAppScopeSelection
                          }
                        >
                          {savingAdminRecord ? "Saving..." : (createMode ? "Create" : "Save")}
                        </button>
                        </div>
                      </div>
                    </form>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      </section>
    </div>
  );
}

export default CatalogSearchPanel;











