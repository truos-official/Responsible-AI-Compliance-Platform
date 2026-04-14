import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApp } from "../context/AppContext.jsx";

const API = "http://localhost:8000/api/v1";

const GOVERNANCE_CATEGORIES = [
  { step: 1, label: "Corporate Oversight", short: "CO", color: "#0ea5e9" },
  { step: 2, label: "Risk & Compliance", short: "RC", color: "#22c55e" },
  { step: 3, label: "Technical Architecture", short: "TA", color: "#f59e0b" },
  { step: 4, label: "Data Readiness", short: "DR", color: "#8b5cf6" },
  { step: 5, label: "Data Integration", short: "DI", color: "#14b8a6" },
  { step: 6, label: "Security", short: "SE", color: "#ef4444" },
  { step: 7, label: "Infrastructure", short: "IN", color: "#6366f1" },
  { step: 8, label: "Solution Design", short: "SD", color: "#06b6d4" },
  { step: 9, label: "System Performance", short: "SP", color: "#f97316" },
];

const EQUAL_WEIGHT = 1 / GOVERNANCE_CATEGORIES.length;

const RISK_DEFINITION_ROWS = [
  {
    level: "Very High",
    band: "0-24/100",
    tone: "very-high",
    definition:
      "The application has critical, widespread non-conformance with governance requirements. Multiple categories are failing simultaneously. Regulatory exposure is immediate. Continued operation without remediation poses legal, reputational, and operational risk to the organization. Action required before next review cycle.",
    requirement:
      "The Head of Entity is required to implement specific remedial or monitoring measures, including consultations with the Executive Committee, through the AI Committee, and continuous monitoring of the AI system. If the Very High Risks cannot be properly mitigated, then adoption and use of the AI system may be prohibited by the Executive Committee.",
  },
  {
    level: "High",
    band: "25-49/100",
    tone: "high",
    definition:
      "The application has significant, material non-conformance across multiple requirements. Individual governance categories are failing or near-failing. Controls are compromised to a degree that creates measurable risk of harm. Remediation plan required within 30 days.",
    requirement:
      "The Head of Entity shall implement specific remedial or monitoring measures, including consultations with the AI Committee and continuous monitoring of the AI system.",
  },
  {
    level: "Medium",
    band: "50-74/100",
    tone: "medium",
    definition:
      "The application has partial non-conformance with governance requirements in one or more categories. Controls are present but below thresholds. Risk of harm is contained but trending adverse. Remediation plan required within 90 days.",
    requirement:
      "The Head of Entity shall implement specific remedial or monitoring measures, including continuous monitoring of the AI system.",
  },
  {
    level: "Low",
    band: ">=75/100",
    tone: "low",
    definition:
      "The application is substantially conformant with active governance requirements. Most metrics are within thresholds. Minor deviations may exist but do not represent material governance exposure. Continue scheduled monitoring.",
    requirement:
      "No specific obligations beyond existing institutional safeguarding, including enterprise risk management and data protection.",
  },
];

const RISK_TONE_STYLES = {
  "very-high": { bg: "#fff1f2", border: "#fecdd3", text: "#9f1239", dot: "#e11d48" },
  high: { bg: "#fff7ed", border: "#fed7aa", text: "#9a3412", dot: "#ea580c" },
  medium: { bg: "#fffbeb", border: "#fde68a", text: "#92400e", dot: "#d97706" },
  low: { bg: "#ecfdf3", border: "#bbf7d0", text: "#166534", dot: "#16a34a" },
};

function buildEqualCategoryWeights() {
  return Object.fromEntries(
    GOVERNANCE_CATEGORIES.map((item) => [item.label, EQUAL_WEIGHT])
  );
}

function sumWeights(weights) {
  return Object.values(weights || {}).reduce((acc, value) => acc + (Number(value) || 0), 0);
}

function normalizeWeights(weights) {
  const raw = { ...(weights || {}) };
  const total = sumWeights(raw);
  if (total <= 0) {
    return buildEqualCategoryWeights();
  }
  const next = {};
  Object.keys(raw).forEach((key) => {
    next[key] = (Number(raw[key]) || 0) / total;
  });
  return next;
}

function distributeWithFixedValue(weights, fixedKey, fixedValue) {
  const keys = Object.keys(weights || {});
  const others = keys.filter((key) => key !== fixedKey);
  const next = { ...(weights || {}), [fixedKey]: fixedValue };
  if (!others.length) {
    return { [fixedKey]: 1 };
  }

  const remainder = Math.max(0, 1 - fixedValue);
  const otherSum = others.reduce((acc, key) => acc + (Number(weights[key]) || 0), 0);
  if (otherSum <= 0) {
    const even = remainder / others.length;
    others.forEach((key) => {
      next[key] = even;
    });
    return normalizeWeights(next);
  }

  others.forEach((key) => {
    next[key] = ((Number(weights[key]) || 0) / otherSum) * remainder;
  });
  return normalizeWeights(next);
}

function computeCategoryCompliancePct(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return 0;
  }
  const completed = safeRows.filter((row) => (
    typeof row?.value === "number" && !Number.isNaN(row.value) && row.value > 0
  )).length;
  return Math.round((completed / safeRows.length) * 100);
}

function deriveRiskTierFromCompliance(scorePct) {
  if (typeof scorePct !== "number" || Number.isNaN(scorePct)) return "N/A";
  if (scorePct >= 75) return "Low";
  if (scorePct >= 50) return "Medium";
  if (scorePct >= 25) return "High";
  return "Very High";
}

function weightedScore(weights, categoryCompliance) {
  return Math.round(
    GOVERNANCE_CATEGORIES.reduce((sum, category) => {
      const w = Number(weights?.[category.label]) || 0;
      const compliance = Number(categoryCompliance?.[category.label]) || 0;
      return sum + (w * compliance);
    }, 0)
  );
}

function scoreTone(score) {
  if (score >= 75) return { bg: "#ecfdf3", fg: "#166534", border: "#bbf7d0" };
  if (score >= 50) return { bg: "#fff7ed", fg: "#9a3412", border: "#fed7aa" };
  if (score >= 25) return { bg: "#fff1f2", fg: "#b91c1c", border: "#fecdd3" };
  return { bg: "#fee2e2", fg: "#7f1d1d", border: "#fca5a5" };
}

function toPctLabel(value) {
  const safe = Number(value);
  if (Number.isNaN(safe)) return "0%";
  return `${Math.round(safe * 100)}%`;
}

export default function AlignmentWeightsPanel() {
  const { selectedApp, currentUser } = useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [catalog, setCatalog] = useState([]);
  const [categoryWeights, setCategoryWeights] = useState(buildEqualCategoryWeights());
  const [categoryCompliance, setCategoryCompliance] = useState(() => (
    Object.fromEntries(GOVERNANCE_CATEGORIES.map((item) => [item.label, 0]))
  ));
  const [activeRiskLevel, setActiveRiskLevel] = useState("Medium");

  const loadRiskConfig = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/admin/risk-category-weights`);
      if (!res.ok) throw new Error("Failed to load risk category settings.");
      const data = await res.json();
      setCatalog(Array.isArray(data.kpi_catalog) ? data.kpi_catalog : []);
      setCategoryWeights(buildEqualCategoryWeights());
    } catch (e) {
      setError(e.message || "Failed to load risk category settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCategoryCompliance = useCallback(async () => {
    if (!selectedApp?.id) {
      setCategoryCompliance(Object.fromEntries(GOVERNANCE_CATEGORIES.map((item) => [item.label, 0])));
      return;
    }
    try {
      const results = await Promise.allSettled(
        GOVERNANCE_CATEGORIES.map((category) =>
          api.getApplicationDashboardStep(selectedApp.id, category.step)
        )
      );
      const next = {};
      GOVERNANCE_CATEGORIES.forEach((category, idx) => {
        const outcome = results[idx];
        if (outcome.status !== "fulfilled") {
          next[category.label] = 0;
          return;
        }
        const rows = Array.isArray(outcome.value?.rows) ? outcome.value.rows : [];
        next[category.label] = computeCategoryCompliancePct(rows);
      });
      setCategoryCompliance(next);
    } catch {
      setCategoryCompliance(Object.fromEntries(GOVERNANCE_CATEGORIES.map((item) => [item.label, 0])));
    }
  }, [selectedApp?.id]);

  useEffect(() => {
    loadRiskConfig();
  }, [loadRiskConfig]);

  useEffect(() => {
    loadCategoryCompliance();
  }, [loadCategoryCompliance]);

  const totalWeight = sumWeights(categoryWeights);
  const canSave = Math.abs(totalWeight - 1) <= 0.001 && catalog.length > 0;
  const score = weightedScore(categoryWeights, categoryCompliance);
  const tier = deriveRiskTierFromCompliance(score);
  const tone = scoreTone(score);
  const computedRiskDefinition = useMemo(
    () => RISK_DEFINITION_ROWS.find((row) => row.level === tier) || RISK_DEFINITION_ROWS[2],
    [tier]
  );
  const computedRiskToneStyle = RISK_TONE_STYLES[computedRiskDefinition?.tone] || RISK_TONE_STYLES.medium;
  const activeRiskDefinition = useMemo(
    () => RISK_DEFINITION_ROWS.find((row) => row.level === activeRiskLevel) || RISK_DEFINITION_ROWS[2],
    [activeRiskLevel]
  );
  const riskToneStyle = RISK_TONE_STYLES[activeRiskDefinition?.tone] || RISK_TONE_STYLES.medium;

  useEffect(() => {
    if (tier && RISK_DEFINITION_ROWS.some((row) => row.level === tier)) {
      setActiveRiskLevel(tier);
    }
  }, [tier]);

  const complianceChartData = useMemo(
    () => GOVERNANCE_CATEGORIES.map((category) => ({
      ...category,
      compliance: Number(categoryCompliance?.[category.label]) || 0,
      weight: Number(categoryWeights?.[category.label]) || 0,
    })),
    [categoryCompliance, categoryWeights]
  );

  const onWeightChange = (label, pctValue) => {
    const bounded = Math.max(0, Math.min(1, Number(pctValue) || 0));
    setCategoryWeights((prev) => distributeWithFixedValue(prev, label, bounded));
    setSuccess("");
  };

  const onResetEqual = () => {
    setCategoryWeights(buildEqualCategoryWeights());
    setSuccess("");
  };

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const metricsByCategory = {};
      const allMetricNames = [];
      (catalog || []).forEach((item) => {
        const metricName = String(item?.metric_name || "").trim();
        const category = String(item?.governance_category || "").trim();
        if (!metricName) return;
        allMetricNames.push(metricName);
        if (!metricsByCategory[category]) {
          metricsByCategory[category] = [];
        }
        metricsByCategory[category].push(metricName);
      });

      const nextMetricWeights = {};
      GOVERNANCE_CATEGORIES.forEach((category) => {
        const metrics = metricsByCategory[category.label] || [];
        if (!metrics.length) return;
        const categoryWeight = Number(categoryWeights?.[category.label]) || 0;
        const perMetric = categoryWeight / metrics.length;
        metrics.forEach((metricName) => {
          nextMetricWeights[metricName] = perMetric;
        });
      });

      const unseen = [...new Set(allMetricNames)].filter((metricName) => !(metricName in nextMetricWeights));
      if (unseen.length) {
        const assignedSum = sumWeights(nextMetricWeights);
        const remaining = Math.max(0, 1 - assignedSum);
        const fill = remaining / unseen.length;
        unseen.forEach((metricName) => {
          nextMetricWeights[metricName] = fill;
        });
      }

      const normalizedMetricWeights = normalizeWeights(nextMetricWeights);
      const payload = {
        kpi_weights: normalizedMetricWeights,
        set_by: currentUser?.email || "system@aigov.local",
        reason: `System-generated category-level weighting update${selectedApp?.id ? ` (${selectedApp.id})` : ""}`,
      };

      const res = await fetch(`${API}/admin/risk-category-weights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Save failed" }));
        throw new Error(err.detail || "Save failed");
      }

      setSuccess("Category weight settings saved.");
      await loadRiskConfig();
    } catch (e) {
      setError(e.message || "Failed to save category weight settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: "grid", gap: "0.9rem" }}>
        {loading ? <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>Loading risk configuration...</p> : null}
        {error ? <p style={{ fontSize: "0.8rem", color: "#dc2626", margin: 0 }}>{error}</p> : null}
        {success ? <p style={{ fontSize: "0.8rem", color: "#16a34a", margin: 0 }}>{success}</p> : null}
      </div>

      <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "320px minmax(0, 1fr)", gap: "1rem" }}>
        <aside style={{ position: "sticky", top: "0.8rem", alignSelf: "start", display: "grid", gap: "0.7rem" }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)", padding: "0.8rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
              <strong style={{ fontSize: "0.8rem" }}>Compliance Calculator</strong>
              <span
                style={{
                  fontSize: "0.68rem",
                  color: tone.fg,
                  background: tone.bg,
                  border: `1px solid ${tone.border}`,
                  borderRadius: 999,
                  padding: "0.12rem 0.45rem",
                  fontWeight: 700,
                }}
              >
                {tier} Risk
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginBottom: "0.7rem" }}>
              <div
                title="Weighted combined compliance score across all governance categories."
                style={{
                  width: 74,
                  height: 74,
                  borderRadius: "50%",
                  background: `conic-gradient(var(--un-blue) 0 ${Math.max(0, Math.min(100, score))}%, rgba(148,163,184,0.25) ${Math.max(0, Math.min(100, score))}% 100%)`,
                  display: "grid",
                  placeItems: "center",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ width: 54, height: 54, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center", fontSize: "0.84rem", fontWeight: 700 }}>
                  {score}
                </div>
              </div>
              <div style={{ display: "grid", gap: "0.3rem", minWidth: 0 }}>
                <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>Weighted Score</span>
                <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>{score}/100</span>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.55rem", marginTop: "0.2rem", display: "grid", gap: "0.5rem" }}>
              {complianceChartData.map((item) => (
                <div key={`risk-slider-${item.label}`} style={{ display: "grid", gap: "0.18rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.3rem" }}>
                    <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "62%" }}>
                      {item.label}
                    </span>
                    <span style={{ fontSize: "0.66rem", color: "var(--text-tertiary)" }}>
                      {item.compliance}% compliance
                    </span>
                    <span style={{ fontSize: "0.66rem", fontWeight: 700, color: "var(--un-blue-dark)" }}>
                      {toPctLabel(item.weight)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(item.weight * 100)}
                    onChange={(event) => onWeightChange(item.label, Number(event.target.value) / 100)}
                    title={`${item.label} weight`}
                    style={{ width: "100%" }}
                  />
                </div>
              ))}
            </div>

            <div style={{ marginTop: "0.55rem", paddingTop: "0.55rem", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: "0.4rem" }}>
              <button
                type="button"
                onClick={onResetEqual}
                disabled={saving}
                title="Reset all category sliders to equal weights"
                aria-label="Equalize category weights"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text-secondary)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.5 : 1,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-3.2-6.9" />
                  <path d="M21 3v6h-6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={!canSave || saving}
                title={saving ? "Saving..." : "Save category weighting settings"}
                aria-label="Save category weighting settings"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: `1px solid ${canSave ? "var(--un-blue)" : "var(--border)"}`,
                  background: canSave ? "var(--un-blue-light)" : "var(--surface-3)",
                  color: canSave ? "var(--un-blue-dark)" : "var(--text-tertiary)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: !canSave || saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </button>
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)", padding: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.45rem" }}>
              <strong style={{ fontSize: "0.78rem" }}>Risk Definitions</strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.3rem", marginBottom: "0.55rem" }}>
              {RISK_DEFINITION_ROWS.map((row) => (
                <button
                  key={`risk-tab-${row.level}`}
                  type="button"
                  onClick={() => setActiveRiskLevel(row.level)}
                  style={{
                    borderRadius: 999,
                    border: `1px solid ${activeRiskLevel === row.level ? riskToneStyle.border : "var(--border)"}`,
                    background: activeRiskLevel === row.level ? riskToneStyle.bg : "var(--surface)",
                    color: activeRiskLevel === row.level ? riskToneStyle.text : "var(--text-secondary)",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    padding: "0.2rem 0.35rem",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.level}
                </button>
              ))}
            </div>
            <div
              style={{
                border: `1px solid ${riskToneStyle.border}`,
                borderRadius: 10,
                background: riskToneStyle.bg,
                padding: "0.5rem 0.55rem",
                display: "grid",
                gap: "0.42rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.45rem" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.74rem", fontWeight: 700, color: riskToneStyle.text }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: riskToneStyle.dot, display: "inline-flex" }} />
                  {activeRiskDefinition.level}
                </span>
              </div>
              <div style={{ display: "grid", gap: "0.28rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <span style={{ fontSize: "0.66rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Risk Definition
                  </span>
                  <span
                    title={activeRiskDefinition.definition}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      color: "var(--text-secondary)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      cursor: "help",
                    }}
                  >
                    i
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <span style={{ fontSize: "0.66rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Recommendation
                  </span>
                  <span
                    title={activeRiskDefinition.requirement}
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      color: "var(--text-secondary)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      cursor: "help",
                    }}
                  >
                    i
                  </span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section style={{ display: "grid", gap: "0.8rem" }}>
          <div
            style={{
              border: `1px solid ${computedRiskToneStyle.border}`,
              borderRadius: 14,
              background: `linear-gradient(160deg, ${computedRiskToneStyle.bg} 0%, rgba(15,23,42,0.03) 100%)`,
              padding: "0.85rem 0.95rem",
              boxShadow: "0 8px 18px rgba(15, 23, 42, 0.06)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.8rem", alignItems: "center" }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  border: `1px solid ${computedRiskToneStyle.border}`,
                  background: `conic-gradient(${computedRiskToneStyle.dot} 0 ${Math.max(0, Math.min(100, score))}%, rgba(148,163,184,0.22) ${Math.max(0, Math.min(100, score))}% 100%)`,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
                title={`Total compliance score: ${score}/100`}
              >
                <div style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={computedRiskToneStyle.dot} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3 4.5 7v5.4c0 4.5 3 7.8 7.5 9.6 4.5-1.8 7.5-5.1 7.5-9.6V7L12 3z" />
                    <path d="M8.5 12 11 14.5 15.5 10" />
                  </svg>
                </div>
              </div>
              <div style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.45rem" }}>
                  <strong style={{ fontSize: "0.88rem", color: "var(--text-primary)" }}>Risk Directive</strong>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      borderRadius: 999,
                      border: `1px solid ${computedRiskToneStyle.border}`,
                      background: computedRiskToneStyle.bg,
                      color: computedRiskToneStyle.text,
                      padding: "0.14rem 0.5rem",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {computedRiskDefinition.level} Risk
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.74rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                    Compliance Score: {score}/100
                  </span>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--text-tertiary)" }} />
                  <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
                    Auto-updates from live category values
                  </span>
                </div>
                <div style={{ display: "grid", gap: "0.28rem", marginTop: "0.15rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <span style={{ fontSize: "0.66rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Risk Definition
                    </span>
                    <span
                      title={computedRiskDefinition.definition}
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        border: "1px solid var(--border)",
                        background: "var(--surface)",
                        color: "var(--text-secondary)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.62rem",
                        fontWeight: 700,
                        cursor: "help",
                      }}
                    >
                      i
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.74rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                    {computedRiskDefinition.definition}
                  </p>
                </div>
                <div style={{ display: "grid", gap: "0.28rem", marginTop: "0.2rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <span style={{ fontSize: "0.66rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Recommendation
                    </span>
                    <span
                      title={computedRiskDefinition.requirement}
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        border: "1px solid var(--border)",
                        background: "var(--surface)",
                        color: "var(--text-secondary)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.62rem",
                        fontWeight: 700,
                        cursor: "help",
                      }}
                    >
                      i
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.74rem", color: "var(--text-primary)", lineHeight: 1.45, fontWeight: 600 }}>
                    {computedRiskDefinition.requirement}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-2)", padding: "0.75rem 0.85rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.45rem" }}>
              <strong style={{ fontSize: "0.82rem" }}>Category Compliance Snapshot</strong>
            </div>
            <div style={{ display: "grid", gap: "0.4rem" }}>
              {complianceChartData.map((item) => (
                <div key={`risk-row-${item.label}`} style={{ display: "grid", gap: "0.15rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem" }}>
                    <span style={{ color: "var(--text-primary)" }}>{item.label}</span>
                    <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>{item.compliance}%</span>
                  </div>
                  <div style={{ width: "100%", height: 7, background: "rgba(148,163,184,0.25)", borderRadius: 999, overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, item.compliance))}%`, background: item.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </section>
      </div>
    </div>
  );
}
