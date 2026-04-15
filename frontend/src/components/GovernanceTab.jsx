import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { api } from '../api/client.js';
import { useApp } from '../context/AppContext.jsx';
import { normalizeRiskTier } from './shared/TierBadge.jsx';
import { PeerBenchmarkInline } from './shared/PeerBenchmarkInline.jsx';

const STEP_DEFS = [
  { num: 1, label: 'Corporate Oversight' },
  { num: 2, label: 'Risk & Compliance' },
  { num: 3, label: 'Technical Architecture' },
  { num: 4, label: 'Data Readiness' },
  { num: 5, label: 'Data Integration' },
  { num: 6, label: 'Security' },
  { num: 7, label: 'Infrastructure' },
  { num: 8, label: 'Solution Design' },
  { num: 9, label: 'System Performance' },
];
const NEW_REQUIREMENT_MARKER_KEY_PREFIX = 'aigov.new_requirements';
const HIDDEN_REQUIREMENT_ROW_KEY_PREFIX = 'aigov.hidden_requirement_rows';

function newRequirementMarkerStorageKey(appId) {
  return `${NEW_REQUIREMENT_MARKER_KEY_PREFIX}.${String(appId || '').trim()}`;
}

function loadNewRequirementMarkers(appId) {
  if (!appId || typeof window === 'undefined') return new Set();
  const raw = window.localStorage.getItem(newRequirementMarkerStorageKey(appId));
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((value) => String(value || '').trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function consumeNewRequirementMarkers(appId, requirementIds) {
  if (!appId || typeof window === 'undefined' || !Array.isArray(requirementIds) || requirementIds.length === 0) {
    return;
  }
  const key = newRequirementMarkerStorageKey(appId);
  const current = loadNewRequirementMarkers(appId);
  let changed = false;
  requirementIds.forEach((id) => {
    const normalized = String(id || '').trim();
    if (normalized && current.has(normalized)) {
      current.delete(normalized);
      changed = true;
    }
  });
  if (changed) {
    if (current.size === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(Array.from(current)));
    }
  }
}

function hiddenRequirementRowStorageKey(appId) {
  return `${HIDDEN_REQUIREMENT_ROW_KEY_PREFIX}.${String(appId || '').trim()}`;
}

function buildDashboardRowKey(row) {
  const controlId = String(row?.control_id || '').trim();
  const metricName = String(row?.metric_name || '').trim();
  const requirementId = String(row?.requirement_id || '').trim();
  return `${controlId}::${metricName}::${requirementId}`;
}

function isUuidLike(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
}

function loadHiddenRequirementRows(appId) {
  if (!appId || typeof window === 'undefined') return new Set();
  const raw = window.localStorage.getItem(hiddenRequirementRowStorageKey(appId));
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((value) => String(value || '').trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function persistHiddenRequirementRows(appId, rowKeys) {
  if (!appId || typeof window === 'undefined') {
    return;
  }
  const storageKey = hiddenRequirementRowStorageKey(appId);
  const normalized = Array.from(new Set((rowKeys || []).map((value) => String(value || '').trim()).filter(Boolean)));
  if (!normalized.length) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(normalized));
}

const BASELINE_STEP2_KPI_COUNT = 10;

const THRESHOLD_OPERATOR_OPTIONS = [
  { value: 'lte', label: '<= (less than or equal)' },
  { value: 'gte', label: '>= (greater than or equal)' },
  { value: 'lt', label: '< (less than)' },
  { value: 'gt', label: '> (greater than)' },
  { value: 'eq', label: '= (equal)' },
  { value: 'between', label: 'between (min and max)' },
];

const INDUSTRY_LIBRARY = [
  { id: 'all', label: 'All Industries', keywords: [] },
  { id: 'healthcare', label: 'Healthcare & Life Sciences', keywords: ['health', 'medical', 'hospital', 'hipaa', 'fda', 'mdr', 'clinical'] },
  { id: 'financial', label: 'Financial Services & Banking', keywords: ['finance', 'financial', 'bank', 'basel', 'finra', 'credit', 'loan'] },
  { id: 'criminal_justice', label: 'Criminal Justice & Public Safety', keywords: ['criminal', 'justice', 'law enforcement', 'police', 'public safety'] },
  { id: 'hr', label: 'Human Resources & Employment', keywords: ['hr', 'employment', 'hiring', 'workforce', 'eeoc', 'labor'] },
  { id: 'education', label: 'Education & Research', keywords: ['education', 'school', 'student', 'ferpa', 'research', 'academic'] },
  { id: 'humanitarian', label: 'Humanitarian & Development', keywords: ['humanitarian', 'refugee', 'unhcr', 'aid', 'development'] },
  { id: 'government', label: 'Government & Public Sector', keywords: ['government', 'public sector', 'secretariat', 'un ', 'un-', 'dpk', 'state'] },
  { id: 'enterprise', label: 'General Enterprise', keywords: ['enterprise', 'nist', 'iso', 'ai act', 'cross-industry'] },
];

const REGION_LAYOUT = [
  { key: 'Americas', color: '#00A3FF' },
  { key: 'Europe', color: '#4DD4A6' },
  { key: 'Africa/Middle East', color: '#F6B14A' },
  { key: 'APAC', color: '#7B8CFF' },
  { key: 'Global', color: '#FF8CA8' },
];

function mapJurisdictionToRegion(jurisdiction) {
  const text = String(jurisdiction || '').toLowerCase();
  if (!text) {
    return 'Global';
  }
  if (
    text.includes('international')
    || text.includes('global')
    || text.includes('worldwide')
    || text.includes('un ')
    || text.includes('united nations')
  ) {
    return 'Global';
  }
  if (
    text.includes('us')
    || text.includes('united states')
    || text.includes('canada')
    || text.includes('america')
    || text.includes('brazil')
    || text.includes('mexico')
  ) {
    return 'Americas';
  }
  if (
    text.includes('eu')
    || text.includes('europe')
    || text.includes('uk')
    || text.includes('france')
    || text.includes('germany')
    || text.includes('italy')
    || text.includes('spain')
  ) {
    return 'Europe';
  }
  if (
    text.includes('africa')
    || text.includes('middle east')
    || text.includes('gcc')
    || text.includes('saudi')
    || text.includes('uae')
  ) {
    return 'Africa/Middle East';
  }
  if (
    text.includes('asia')
    || text.includes('apac')
    || text.includes('india')
    || text.includes('china')
    || text.includes('japan')
    || text.includes('australia')
    || text.includes('singapore')
  ) {
    return 'APAC';
  }
  return 'Global';
}

function normalizeJurisdictionKey(jurisdiction) {
  const raw = String(jurisdiction || '').trim();
  if (!raw) {
    return '';
  }
  const lower = raw.toLowerCase();
  if (lower === 'intl' || lower === 'international' || lower === 'worldwide' || lower === 'global') {
    return 'Worldwide';
  }
  if (lower === 'eu' || lower === 'uk' || lower === 'us') {
    return lower.toUpperCase();
  }
  if (/^us-[a-z]{2}$/i.test(raw)) {
    return raw.toUpperCase();
  }
  if (lower === 'un' || lower === 'united nations') {
    return 'United Nations';
  }
  return raw;
}

function isDisplayableJurisdiction(jurisdiction) {
  const normalized = normalizeJurisdictionKey(jurisdiction);
  if (!normalized) {
    return false;
  }
  const lower = normalized.toLowerCase();
  if (lower === 'placeholder' || lower === 'unknown' || lower === 'n/a') {
    return false;
  }
  return true;
}

function formatJurisdictionLabel(jurisdiction) {
  const normalized = normalizeJurisdictionKey(jurisdiction);
  if (!normalized) {
    return 'N/A';
  }
  const upper = normalized.toUpperCase();
  const usStateNames = {
    CA: 'California',
    CO: 'Colorado',
    IL: 'Illinois',
    NY: 'New York',
    TX: 'Texas',
    UT: 'Utah',
    WA: 'Washington',
  };
  if (/^US-[A-Z]{2}$/.test(upper)) {
    const code = upper.split('-')[1];
    return usStateNames[code] ? `United States (${usStateNames[code]})` : `United States (${code})`;
  }
  if (upper === 'US') {
    return 'United States';
  }
  if (upper === 'EU') {
    return 'European Union';
  }
  if (upper === 'UK') {
    return 'United Kingdom';
  }
  if (normalized === 'United Nations') {
    return 'UN System';
  }
  return normalized;
}

function normalizeRegulationUniverseTitle(title, jurisdiction) {
  const rawTitle = String(title || '').trim();
  const normalizedJurisdiction = normalizeJurisdictionKey(jurisdiction);
  const lowerTitle = rawTitle.toLowerCase();
  const isUnDocumentCode = /^(a\/hrc\/\d+\/\d+|a\/\d+\/\d+|e\/c\.\d+\/\d+\/\d+|k\d{7}|n\d{7}|ceb[_-]\d{4})/i.test(rawTitle);
  const isChinaDocumentCode = /^(a\/\d+\/\d+|china[\s_-]*\w+|[a-z]{1,3}\/\d+\/\d+)/i.test(rawTitle);
  if (
    normalizedJurisdiction === 'United Nations'
    || lowerTitle.startsWith('un ai governance source')
    || lowerTitle.startsWith('united nations -')
    || isUnDocumentCode
  ) {
    return 'UN Policies';
  }
  if (
    String(normalizedJurisdiction || '').toLowerCase() === 'china'
    || lowerTitle.startsWith('china ai governance source')
    || lowerTitle.startsWith('china -')
    || lowerTitle.startsWith("people's republic of china")
    || lowerTitle.startsWith('prc -')
    || isChinaDocumentCode && lowerTitle.includes('china')
  ) {
    return 'China Policies';
  }
  return rawTitle;
}

function isValidRegulationTitle(title) {
  const normalized = String(title || '').trim();
  if (!normalized) {
    return false;
  }
  const lower = normalized.toLowerCase();
  if (lower.startsWith('unlinked')) {
    return false;
  }
  if (lower.includes('phase 3')) {
    return false;
  }
  return true;
}
function normalizeRequirementItem(raw) {
  return {
    id: raw.requirement_id || raw.id || '',
    code: raw.code || 'N/A',
    title: raw.title || '',
    description: raw.description || '',
    regulation_title: raw.regulation_title || null,
    jurisdiction: raw.jurisdiction || null,
    category: raw.category || null,
    selected: Boolean(raw.selected),
    is_default: Boolean(raw.is_default),
    added_at: raw.added_at || null,
    linked_controls: Array.isArray(raw.linked_controls)
      ? raw.linked_controls
        .map((control) => ({
          id: control?.id || '',
          code: control?.code || 'N/A',
          title: control?.title || '',
          metric_name: control?.metric_name || null,
          default_threshold: control?.default_threshold && typeof control.default_threshold === 'object'
            ? control.default_threshold
            : null,
        }))
        .filter((control) => Boolean(control.id))
      : [],
  };
}

function matchesIndustryRequirement(requirement, categoryId) {
  if (!requirement || !categoryId || categoryId === 'all') {
    return true;
  }
  const category = INDUSTRY_LIBRARY.find((item) => item.id === categoryId);
  if (!category || !category.keywords.length) {
    return true;
  }
  const haystack = [
    requirement.code,
    requirement.title,
    requirement.category,
    requirement.regulation_title,
    requirement.jurisdiction,
  ].join(' ').toLowerCase();
  return category.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}


function fmtPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'N/A';
  }
  return `${Math.round(value * 100)}%`;
}

const STEP2_METRIC_META = {
  'governance.owner_assignment_pct': {
    label: 'Owner accountability coverage',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Checks whether an accountable application owner is assigned in the registry.',
  },
  'governance.division_assignment_pct': {
    label: 'Division accountability coverage',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Checks whether the application is mapped to a division-level governance owner.',
  },
  'governance.profile_completeness_pct': {
    label: 'Application profile completeness',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Percentage of required governance profile fields completed at registration.',
  },
  'governance.telemetry_pipeline_health_pct': {
    label: 'Telemetry pipeline health',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Whether the telemetry pipeline is currently healthy and ingesting data as expected.',
  },
  'governance.telemetry_freshness_hours': {
    label: 'Telemetry freshness',
    unitSuffix: 'h',
    percentAutoScale: false,
    measure: 'Hours since the latest telemetry reading was ingested for this application.',
  },
  'governance.compliance_pass_rate_pct': {
    label: 'Compliance pass rate',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Share of scoped controls currently passing configured thresholds.',
  },
  'ai.resources.compute_cost': {
    label: 'Compute cost',
    unitSuffix: ' USD',
    percentAutoScale: false,
    measure: 'Latest AI compute spend captured from telemetry for governance FinOps oversight.',
  },
  'ai.resources.token_usage': {
    label: 'Token usage',
    unitSuffix: ' tokens',
    percentAutoScale: false,
    measure: 'Latest model token consumption captured from telemetry for governance FinOps oversight.',
  },
  'ai.resources.active_users': {
    label: 'Active users',
    unitSuffix: ' users',
    percentAutoScale: false,
    measure: 'Latest active-user count captured from telemetry for governance scale oversight.',
  },
  'ai.resources.cost_per_token': {
    label: 'Cost per token',
    unitSuffix: ' USD/token',
    percentAutoScale: false,
    decimalPlaces: 4,
    measure: 'Average compute cost divided by token usage for the current telemetry window.',
  },
  'ai.resources.frontier_model_count': {
    label: 'Frontier model count',
    unitSuffix: ' models',
    percentAutoScale: false,
    measure: 'Number of frontier AI models currently used by the application solution stack.',
  },
  'ai.core.error_rate': {
    label: 'AI response error rate',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Percentage of AI responses that fail validation or return an error in the current monitoring window.',
  },
  'ai.oversight.override_rate': {
    label: 'Human override rate',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Percentage of AI outputs that were overridden by human reviewers in the current monitoring window.',
  },
  'ai.oversight.feedback_positive_rate': {
    label: 'Thumbs-up feedback rate',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Percentage of user feedback events marked thumbs-up versus total thumbs-up/down feedback events.',
  },
  'ai.core.drift_score': {
    label: 'Model drift score',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Percentage drift score comparing current model behavior to its approved baseline behavior.',
  },
  'ai.transparency.disclosure_rate': {
    label: 'AI disclosure coverage',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Percentage of relevant interactions where AI usage was disclosed to end users.',
  },
  'ai.transparency.doc_completeness': {
    label: 'Documentation completeness',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Percentage of required governance documentation fields that are currently completed.',
  },
  'ai.rag.citation_coverage': {
    label: 'Citation coverage',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Percentage of grounded response claims that include supporting citations from the retrieval layer.',
  },
  'ai.rag.retrieval_latency_p95': {
    label: 'Retrieval latency p95',
    unitSuffix: 'ms',
    percentAutoScale: false,
    measure: '95th percentile latency for the retrieval step before generation begins.',
  },
  'ai.model.accuracy': {
    label: 'Model accuracy',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Percentage of evaluated model outputs that meet expected quality and correctness criteria.',
  },
  'ai.model.hallucination_rate': {
    label: 'Hallucination rate',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Percentage of outputs flagged as ungrounded or unsupported by retrieved evidence.',
  },
  'ai.data.quality_score': {
    label: 'Data quality score',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Composite score of data completeness, validity, and consistency for AI inputs.',
  },
  'ai.data.bias_score': {
    label: 'Data bias score',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Bias indicator derived from disparity checks across relevant groups.',
  },
  'ai.risk.error_to_limit_ratio': {
    label: 'Error rate vs allowed limit',
    unitSuffix: '%',
    percentAutoScale: false,
    ratioToPercent: true,
    measure: 'Current error rate divided by the approved error limit, expressed as percentage of limit utilization.',
  },
  'ai.risk.override_to_target_ratio': {
    label: 'Override rate vs target',
    unitSuffix: '%',
    percentAutoScale: false,
    ratioToPercent: true,
    clampMax100: true,
    measure: 'Current human override rate divided by the target override threshold, expressed as percentage of target utilization.',
  },
  'ai.risk.drift_to_limit_ratio': {
    label: 'Drift score vs allowed limit',
    unitSuffix: '%',
    percentAutoScale: false,
    ratioToPercent: true,
    measure: 'Current drift score divided by the approved drift limit, expressed as percentage of limit utilization.',
  },
  'ai.risk.disclosure_gap_pct': {
    label: 'Disclosure gap to target',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Gap between current disclosure coverage and target disclosure threshold, expressed as a percentage.',
  },
  'ai.risk.doc_completeness_gap_pct': {
    label: 'Documentation gap to target',
    unitSuffix: '%',
    percentAutoScale: true,
    measure: 'Gap between current documentation completeness and target completeness threshold, expressed as a percentage.',
  },
};

function humanizeMetricName(metricName) {
  if (!metricName) {
    return 'Measure';
  }
  const tail = String(metricName).split('.').pop() || String(metricName);
  return tail
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getStep2MetricMeta(metricName) {
  if (metricName && STEP2_METRIC_META[metricName]) {
    return STEP2_METRIC_META[metricName];
  }
  return {
    label: humanizeMetricName(metricName),
    unitSuffix: '',
    percentAutoScale: false,
    ratioToPercent: false,
    clampMax100: false,
    decimalPlaces: 0,
    measure: 'Calculated from live application telemetry for this mandatory requirement.',
  };
}

function formatStep2MetricValue(metricName, value) {
  const scaled = toStep2DisplayNumber(metricName, value);
  if (scaled === null) {
    return 'N/A';
  }
  const meta = getStep2MetricMeta(metricName);
  const decimalPlaces = Number.isInteger(meta.decimalPlaces) ? meta.decimalPlaces : 0;
  const rounded = decimalPlaces > 0 ? Number(scaled).toFixed(decimalPlaces) : `${Math.round(scaled)}`;
  return meta.unitSuffix ? `${rounded}${meta.unitSuffix}` : `${rounded}`;
}

function getGovernanceRowStatusLabel(row, applicationSpecificView = false) {
  const status = row?.display_result || row?.result || 'N/A';
  if (applicationSpecificView && status === 'INSUFFICIENT_DATA') {
    return 'MANUAL';
  }
  return status;
}

function getGovernanceRowValueLabel(row, applicationSpecificView = false) {
  const status = row?.display_result || row?.result || 'N/A';
  if (status === 'MANUAL') {
    return 'Manual';
  }
  if (applicationSpecificView && status === 'INSUFFICIENT_DATA') {
    return 'Unavailable';
  }
  const formatted = formatStep2MetricValue(row?.metric_name, row?.value);
  return formatted === 'N/A' ? 'Unavailable' : formatted;
}

function isManualGovernanceRow(row) {
  const status = String(row?.display_result || row?.result || '').toUpperCase();
  return status === 'MANUAL' || Boolean(row?.is_manual);
}

function getManualGovernanceState(row) {
  return typeof row?.value === 'number' && !Number.isNaN(row.value) && row.value >= 100
    ? 'completed'
    : 'pending';
}

function summarizeGovernanceRowStatus(row) {
  const status = String(row?.display_result || row?.result || '').toUpperCase();
  if (isManualGovernanceRow(row)) {
    return getManualGovernanceState(row) === 'completed' ? 'PASS' : 'FAIL';
  }
  if (status === 'PASS' || status === 'FAIL') {
    return status;
  }
  return 'INSUFFICIENT_DATA';
}

function computeGovernanceStatusCounts(rows = []) {
  return (rows || []).reduce((acc, row) => {
    const normalized = summarizeGovernanceRowStatus(row);
    if (normalized === 'PASS') acc.pass += 1;
    else if (normalized === 'FAIL') acc.fail += 1;
    else acc.noData += 1;
    return acc;
  }, { pass: 0, fail: 0, noData: 0 });
}

function computeCategoryCompliancePct(...rowGroups) {
  const rows = rowGroups.flatMap((group) => (Array.isArray(group) ? group : []));
  const total = rows.length;
  if (!total) return 0;
  const completed = rows.filter((row) => (
    typeof row?.value === 'number' && !Number.isNaN(row.value) && row.value > 0
  )).length;
  return Math.round((completed / total) * 100);
}

function deriveRiskTierFromComplianceScore(scorePct) {
  if (typeof scorePct !== 'number' || Number.isNaN(scorePct)) {
    return null;
  }
  if (scorePct >= 75) return 'Low';
  if (scorePct >= 50) return 'Medium';
  if (scorePct >= 25) return 'High';
  return 'Very High';
}

function toStep2DisplayNumber(metricName, value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  const meta = getStep2MetricMeta(metricName);
  let scaled = value;
  if (meta.unitSuffix === '%' && meta.ratioToPercent) {
    // Ratio metrics can arrive either as 0..1 (ratio) or already as 0..100 (percent).
    scaled = Math.abs(value) <= 1 ? value * 100 : value;
  } else if (meta.unitSuffix === '%' && meta.percentAutoScale) {
    scaled = Math.abs(value) <= 1 ? value * 100 : value;
  }
  if (meta.unitSuffix === '%' && meta.clampMax100) {
    scaled = Math.min(100, scaled);
  }
  return scaled;
}

function getStep2InterpretationText(row) {
  const metricLabel = getStep2MetricMeta(row?.metric_name).label;
  if ((row?.display_result || row?.result) === 'MANUAL') {
    return `${metricLabel} is configured as a manual KPI and requires user attestation/evidence input.`;
  }
  if (row?.benchmark_result === 'PASS') {
    return `${metricLabel} meets the configured benchmark test against industry and peer baselines.`;
  }
  if (row?.benchmark_result === 'FAIL') {
    return `${metricLabel} misses one or more benchmark targets (industry baseline and/or peer baseline).`;
  }
  if (row?.benchmark_result === 'INSUFFICIENT_DATA') {
    return `Telemetry is not yet sufficient to benchmark ${metricLabel.toLowerCase()} against industry or peers.`;
  }
  if (row?.result === 'PASS') {
    return `${metricLabel} is within the acceptable operating range.`;
  }
  if (row?.result === 'FAIL') {
    return `${metricLabel} is outside the acceptable operating range and needs follow-up action.`;
  }
  return `Telemetry is not yet sufficient to evaluate ${metricLabel.toLowerCase()}.`;
}

function buildStep2BenchmarkComparison(row, label, benchmark) {
  const current = toStep2DisplayNumber(row?.metric_name, row?.value);
  const baseline = toStep2DisplayNumber(row?.metric_name, benchmark);
  if (current === null || baseline === null) {
    return null;
  }
  const delta = current - baseline;
  const atParity = Math.abs(delta) < 1e-9;
  const higherBetter = String(row?.threshold?.direction || '').toLowerCase() !== 'lower_better';
  const better = atParity ? null : (higherBetter ? delta > 0 : delta < 0);
  return {
    label,
    current,
    baseline,
    delta,
    atParity,
    better,
    trendArrow: atParity ? '\u2192' : (delta > 0 ? '\u2191' : '\u2193'),
    currentText: formatStep2MetricValue(row.metric_name, row?.value),
    baselineText: formatStep2MetricValue(row.metric_name, benchmark),
    deltaText: formatStep2MetricValue(row.metric_name, Math.abs(delta)),
  };
}

function renderStep2BenchmarkInline(row) {
  const current = toStep2DisplayNumber(row?.metric_name, row?.value);
  if (current === null) {
    return <span className="peer-inline-muted">No current application value available yet.</span>;
  }

  const industryValue = toStep2DisplayNumber(row?.metric_name, row?.industry_benchmark);
  const peerValue = toStep2DisplayNumber(row?.metric_name, row?.peer_benchmark ?? row?.peer_avg);

  const points = [
    { key: 'kpi', label: 'KPI', value: current, valueText: formatStep2MetricValue(row.metric_name, row?.value), tone: 'kpi' },
    { key: 'industry', label: 'Industry', value: industryValue, valueText: formatStep2MetricValue(row.metric_name, row?.industry_benchmark), tone: 'industry' },
    { key: 'peer', label: 'Peer', value: peerValue, valueText: formatStep2MetricValue(row.metric_name, row?.peer_benchmark ?? row?.peer_avg), tone: 'peer' },
  ].filter((item) => item.value !== null);

  if (points.length < 2) {
    return <span className="peer-inline-muted">Industry and peer benchmarks are not available yet.</span>;
  }

  const minValue = Math.min(...points.map((item) => item.value));
  const maxValue = Math.max(...points.map((item) => item.value));
  const span = Math.max(maxValue - minValue, Math.abs(maxValue || 1) * 0.1, 1);
  const rangeMin = minValue - span * 0.12;
  const rangeMax = maxValue + span * 0.12;
  const toPosition = (value) => {
    if (rangeMax <= rangeMin) {
      return 50;
    }
    return Math.max(0, Math.min(100, ((value - rangeMin) / (rangeMax - rangeMin)) * 100));
  };

  const comparisons = [
    buildStep2BenchmarkComparison(row, 'Industry', row?.industry_benchmark),
    buildStep2BenchmarkComparison(row, 'Peer', row?.peer_benchmark ?? row?.peer_avg),
  ].filter(Boolean);

  return (
    <div className="step2-benchmark-combined">
      <div className="step2-benchmark-combined-top">
        {comparisons.length ? (
          comparisons.map((comparison) => (
            <span key={`${row.metric_name}-${comparison.label}`} className={`step2-benchmark-chip tone-${comparison.atParity ? 'neutral' : comparison.better ? 'better' : 'worse'}`}>
              {comparison.label}: {comparison.atParity ? 'at baseline' : `${comparison.better ? 'better' : 'worse'} by ${comparison.deltaText}`} ({comparison.trendArrow})
            </span>
          ))
        ) : (
          <span className="peer-inline-muted">Benchmark comparison unavailable.</span>
        )}
      </div>
      <div className="step2-benchmark-track-wrap">
        <span className="step2-benchmark-track-line" />
        {points.map((point) => (
          <span
            key={`${row.metric_name}-${point.key}`}
            className={`step2-benchmark-dot dot-${point.tone}`}
            style={{ left: `${toPosition(point.value)}%` }}
            title={`${point.label}: ${point.valueText}`}
          />
        ))}
      </div>
      <div className="step2-benchmark-legend">
        {[
          { key: 'kpi', label: 'KPI', value: current, valueText: formatStep2MetricValue(row.metric_name, row?.value), tone: 'kpi' },
          { key: 'industry', label: 'Industry', value: industryValue, valueText: formatStep2MetricValue(row.metric_name, row?.industry_benchmark), tone: 'industry' },
          { key: 'peer', label: 'Peer', value: peerValue, valueText: formatStep2MetricValue(row.metric_name, row?.peer_benchmark ?? row?.peer_avg), tone: 'peer' },
        ].map((point) => (
          <span key={`${row.metric_name}-legend-${point.key}`} className="step2-benchmark-legend-item">
            <span className={`step2-benchmark-swatch dot-${point.tone}`} />
            {point.label}: {point.value === null ? (point.key === 'peer' ? 'No peer data' : 'No benchmark data') : point.valueText}
          </span>
        ))}
      </div>
    </div>
  );
}
function extractFormulaMetricRefs(formula) {
  if (!formula) {
    return [];
  }
  const matches = String(formula).match(/ai\.[a-z0-9_.]+/gi) || [];
  return Array.from(new Set(matches.map((item) => item.toLowerCase())));
}

function getSourceSystemLabel(sourceSystem) {
  const source = String(sourceSystem || '').toLowerCase();
  if (source === 'otel') {
    return 'live OpenTelemetry application metrics';
  }
  if (source === 'calculated') {
    return 'derived KPI calculations from existing telemetry metrics';
  }
  if (source === 'github_actions') {
    return 'CI/CD governance signals from GitHub Actions';
  }
  if (source === 'your_feedback') {
    return 'human oversight and feedback event logs';
  }
  return 'governance telemetry sources configured for this KPI';
}

function getStep2ValueSourceLegend(row) {
  const threshold = row?.threshold || {};
  const formula = String(threshold.formula || '').trim();
  const calcType = String(threshold.calculation_type || '').toLowerCase();
  const sourceSystem = String(threshold.source_system || '').toLowerCase();
  const sourceLabel = getSourceSystemLabel(sourceSystem);
  const dependencies = extractFormulaMetricRefs(formula);
  const dependencyLabels = dependencies
    .map((metric) => `${getStep2MetricMeta(metric).label} (${metric})`);

  if (formula && (calcType === 'derived' || sourceSystem === 'calculated')) {
    if (dependencyLabels.length) {
      return `Derived from ${dependencyLabels.join(', ')} using formula "${formula}". Source: ${sourceLabel}.`;
    }
    return `Derived using formula "${formula}". Source: ${sourceLabel}.`;
  }

  if (formula) {
    return `Directly read from ${getStep2MetricMeta(row?.metric_name).label} (${row?.metric_name}) using "${formula}". Source: ${sourceLabel}.`;
  }

  return `Directly read from ${getStep2MetricMeta(row?.metric_name).label} (${row?.metric_name}). Source: ${sourceLabel}.`;
}

function getStep1ValueSourceLegend(row) {
  const byMetric = {
    'governance.owner_assignment_pct': 'Derived from application registry field owner_email.',
    'governance.division_assignment_pct': 'Derived from application registry field division_id.',
    'governance.profile_completeness_pct': 'Derived from required registration fields in the application profile.',
    'governance.telemetry_pipeline_health_pct': 'Derived from telemetry status heartbeat for the connected application.',
    'governance.telemetry_freshness_hours': 'Derived from timestamp of latest telemetry reading ingested by the platform.',
    'governance.compliance_pass_rate_pct': 'Derived from live compliance calculator output for scoped controls.',
    'ai.resources.compute_cost': 'Directly read from telemetry metric ai.resources.compute_cost (USD).',
    'ai.resources.token_usage': 'Directly read from telemetry metric ai.resources.token_usage (token count).',
    'ai.resources.active_users': 'Directly read from telemetry metric ai.resources.active_users (distinct active users).',
    'ai.resources.cost_per_token': 'Derived from ai.resources.compute_cost divided by ai.resources.token_usage.',
    'ai.resources.frontier_model_count': 'Derived from frontier model telemetry attributes or explicit frontier model count metric.',
    'ai.oversight.feedback_positive_rate': 'Derived from thumbs-up/down feedback telemetry events emitted by the connected application.',
  };
  return byMetric[row?.metric_name] || 'Derived from live governance system data for this application.';
}

function toRatio(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  if (Math.abs(value) <= 1) {
    return value;
  }
  return value / 100;
}

function buildCorporateOversightRows(selectedApp, snapshot, summary, stepRows = []) {
  const app = selectedApp || {};
  const profile = summary && typeof summary === 'object' ? summary : app;
  const telemetry = snapshot?.telemetry || {};
  const compliance = snapshot?.compliance || {};
  const apiRows = Array.isArray(stepRows) ? stepRows.filter((row) => row?.requirement_id) : [];
  // Step 1 should be rendered from scoped DB/API rows when available.
  if (apiRows.length > 0) {
    return apiRows;
  }

  const ownerAssigned = Boolean(app.owner_email || profile.owner_email);
  const divisionAssigned = Boolean(app.division_id || profile.division_id);

  const requiredFields = [
    profile?.name,
    profile?.domain,
    profile?.ai_system_type,
    profile?.decision_type,
    profile?.autonomy_level,
    app?.owner_email || profile?.owner_email,
    app?.division_id || profile?.division_id,
  ];
  const filledFields = requiredFields.filter((value) => Boolean(String(value || '').trim())).length;
  const profileCompleteness = requiredFields.length ? (filledFields / requiredFields.length) : 0;

  const telemetryStatus = String(telemetry?.status || '').toLowerCase();
  const telemetryHealthy = ['healthy', 'ok', 'active', 'running'].includes(telemetryStatus);

  let freshnessHours = null;
  if (telemetry?.latest_reading) {
    const latestMs = Date.parse(telemetry.latest_reading);
    if (!Number.isNaN(latestMs)) {
      freshnessHours = (Date.now() - latestMs) / 36e5;
    }
  }

  const complianceRatio = toRatio(compliance?.pass_rate);

  const baseRows = [
    {
      control_id: 'co-control-owner-assignment',
      requirement_id: 'co-req-owner-assignment',
      control_title: 'Accountability Owner Assignment',
      requirement_title: 'An accountable owner must be explicitly assigned for governance accountability.',
      metric_name: 'governance.owner_assignment_pct',
      value: ownerAssigned ? 1 : 0,
      result: ownerAssigned ? 'PASS' : 'FAIL',
      threshold: { direction: 'higher_better' },
      industry_benchmark: 0.95,
      peer_benchmark: 0.9,
    },
    {
      control_id: 'co-control-division-governance-ownership',
      requirement_id: 'co-req-division-governance-ownership',
      control_title: 'Division Governance Ownership',
      requirement_title: 'Each application must be mapped to a division or governance accountability unit.',
      metric_name: 'governance.division_assignment_pct',
      value: divisionAssigned ? 1 : 0,
      result: divisionAssigned ? 'PASS' : 'FAIL',
      threshold: { direction: 'higher_better' },
      industry_benchmark: 0.95,
      peer_benchmark: 0.9,
    },
    {
      control_id: 'co-control-registration-completeness',
      requirement_id: 'co-req-registration-completeness',
      control_title: 'Governance Registration Completeness',
      requirement_title: 'Corporate oversight requires a complete application governance profile.',
      metric_name: 'governance.profile_completeness_pct',
      value: profileCompleteness,
      result: profileCompleteness >= 0.85 ? 'PASS' : 'FAIL',
      threshold: { direction: 'higher_better' },
      industry_benchmark: 0.9,
      peer_benchmark: 0.85,
    },
    {
      control_id: 'co-control-telemetry-pipeline-health',
      requirement_id: 'co-req-telemetry-pipeline-health',
      control_title: 'Telemetry Pipeline Operational Health',
      requirement_title: 'Oversight monitoring requires a healthy telemetry ingestion pipeline.',
      metric_name: 'governance.telemetry_pipeline_health_pct',
      value: telemetryStatus ? (telemetryHealthy ? 1 : 0) : null,
      result: !telemetryStatus ? 'INSUFFICIENT_DATA' : (telemetryHealthy ? 'PASS' : 'FAIL'),
      threshold: { direction: 'higher_better' },
      industry_benchmark: 0.9,
      peer_benchmark: 0.85,
    },
    {
      control_id: 'co-control-telemetry-recency',
      requirement_id: 'co-req-telemetry-recency',
      control_title: 'Telemetry Recency Oversight',
      requirement_title: 'Oversight KPIs must be based on fresh telemetry data.',
      metric_name: 'governance.telemetry_freshness_hours',
      value: typeof freshnessHours === 'number' && !Number.isNaN(freshnessHours) ? freshnessHours : null,
      result: freshnessHours === null ? 'INSUFFICIENT_DATA' : (freshnessHours <= 24 ? 'PASS' : 'FAIL'),
      threshold: { direction: 'lower_better' },
      industry_benchmark: 12,
      peer_benchmark: 18,
    },
    {
      control_id: 'co-control-compliance-monitoring-coverage',
      requirement_id: 'co-req-compliance-monitoring-coverage',
      control_title: 'Compliance Monitoring Coverage',
      requirement_title: 'Corporate oversight requires ongoing control compliance monitoring.',
      metric_name: 'governance.compliance_pass_rate_pct',
      value: complianceRatio,
      result: complianceRatio === null ? 'INSUFFICIENT_DATA' : (complianceRatio >= 0.75 ? 'PASS' : 'FAIL'),
      threshold: { direction: 'higher_better' },
      industry_benchmark: 0.8,
      peer_benchmark: 0.75,
    },
  ];

  const finopsMetricNames = new Set([
    'ai.resources.compute_cost',
    'ai.resources.token_usage',
    'ai.resources.active_users',
    'ai.resources.cost_per_token',
    'ai.resources.frontier_model_count',
  ]);
  const finopsTelemetryRows = Array.isArray(stepRows)
    ? stepRows
      .filter((row) => finopsMetricNames.has(row?.metric_name))
      .map((row) => ({
        ...row,
        threshold: row?.threshold || { direction: 'lower_better' },
      }))
    : [];

  return [...baseRows, ...finopsTelemetryRows];
}

function resolveDefaultControlId(requirementId, requirements, currentControlId = '') {
  const requirement = requirements.find((item) => item.id === requirementId);
  const controls = requirement?.linked_controls || [];
  if (!controls.length) {
    return '';
  }
  if (currentControlId && controls.some((item) => item.id === currentControlId)) {
    return currentControlId;
  }
  return controls[0].id;
}

function parseNumericInput(rawValue) {
  const normalized = String(rawValue ?? '').trim();
  if (!normalized) {
    return null;
  }
  const value = Number(normalized);
  if (Number.isNaN(value)) {
    return null;
  }
  return value;
}

function sameStringSet(valuesA, valuesB) {
  const setA = new Set(valuesA || []);
  const setB = new Set(valuesB || []);
  if (setA.size !== setB.size) {
    return false;
  }
  for (const value of setA) {
    if (!setB.has(value)) {
      return false;
    }
  }
  return true;
}

function toNumeric(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function buildThresholdOverrideFromDraft(draft) {
  if (!draft.thresholdEnabled) {
    return { thresholdOverride: null, validationError: '' };
  }
  if (draft.thresholdOperator === 'between') {
    const minValue = parseNumericInput(draft.thresholdMin);
    const maxValue = parseNumericInput(draft.thresholdMax);
    if (minValue === null || maxValue === null) {
      return {
        thresholdOverride: null,
        validationError: 'Threshold override requires numeric min and max values.',
      };
    }
    if (minValue > maxValue) {
      return {
        thresholdOverride: null,
        validationError: 'Threshold override requires min_value <= max_value.',
      };
    }
    return {
      thresholdOverride: {
        operator: 'between',
        min_value: minValue,
        max_value: maxValue,
      },
      validationError: '',
    };
  }

  const value = parseNumericInput(draft.thresholdValue);
  if (value === null) {
    return {
      thresholdOverride: null,
      validationError: 'Threshold override requires a numeric value.',
    };
  }
  return {
    thresholdOverride: {
      operator: draft.thresholdOperator,
      value,
    },
    validationError: '',
  };
}

function formatThresholdOverride(override) {
  if (!override || typeof override !== 'object') {
    return 'N/A';
  }
  const operator = override.operator || 'N/A';
  if (operator === 'between') {
    return `between ${override.min_value ?? '?'} and ${override.max_value ?? '?'}`;
  }
  return `${operator} ${override.value ?? '?'}`;
}

function isMorePermissiveThreshold(override, baseline) {
  if (!override || !baseline || typeof override !== 'object' || typeof baseline !== 'object') {
    return false;
  }
  const overrideOp = String(override.operator || '');
  const baselineOp = String(baseline.operator || '');
  if (!overrideOp || !baselineOp || overrideOp !== baselineOp) {
    return false;
  }

  if (overrideOp === 'between') {
    const oMin = toNumeric(override.min_value);
    const oMax = toNumeric(override.max_value);
    const bMin = toNumeric(baseline.min_value);
    const bMax = toNumeric(baseline.max_value);
    if (oMin === null || oMax === null || bMin === null || bMax === null) {
      return false;
    }
    return oMin < bMin || oMax > bMax;
  }

  const oValue = toNumeric(override.value);
  const bValue = toNumeric(baseline.value);
  if (oValue === null || bValue === null) {
    return false;
  }

  if (overrideOp === 'lte' || overrideOp === 'lt') {
    return oValue > bValue;
  }
  if (overrideOp === 'gte' || overrideOp === 'gt') {
    return oValue < bValue;
  }
  return false;
}

function SystemGeoMap({ regionCounts }) {
  const getCount = (key) => Number(regionCounts?.[key] || 0);
  const rows = REGION_LAYOUT
    .map((region) => ({ ...region, count: getCount(region.key) }))
    .sort((a, b) => b.count - a.count);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const maxCount = Math.max(1, ...rows.map((row) => row.count));

  let cursor = 0;
  const stops = rows
    .filter((row) => row.count > 0)
    .map((row) => {
      const start = cursor;
      const pct = (row.count / total) * 100;
      cursor += pct;
      return `${row.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    });
  const donutBackground = stops.length
    ? `conic-gradient(${stops.join(', ')})`
    : 'conic-gradient(rgba(255,255,255,0.12) 0% 100%)';

  return (
    <div className="system-geo-wrap">
      <div className="system-geo-summary">
        <div className="system-geo-donut" style={{ background: donutBackground }}>
          <div className="system-geo-donut-center">
            <strong>{total}</strong>
            <span>total</span>
          </div>
        </div>
        <div className="system-geo-summary-copy">
          <div className="system-geo-summary-title">Regional Coverage</div>
          <div className="system-geo-summary-subtitle">
            Share of mapped jurisdiction references across governance regulations.
          </div>
        </div>
      </div>

      <div className="system-geo-bars">
        {rows.map((row) => {
          const share = total > 0 ? (row.count / total) * 100 : 0;
          const barWidth = row.count > 0 ? Math.max(8, (row.count / maxCount) * 100) : 0;
          return (
            <div key={`geo-${row.key}`} className="system-geo-row">
              <div className="system-geo-row-head">
                <span className="system-geo-label">
                  <span className="system-geo-dot" style={{ background: row.color }} />
                  {row.key}
                </span>
                <span className="system-geo-value">
                  {row.count} <em>{Math.round(share)}%</em>
                </span>
              </div>
              <div className="system-geo-track">
                <span
                  className="system-geo-fill"
                  style={{
                    width: `${barWidth}%`,
                    background: `linear-gradient(90deg, ${row.color}, rgba(255,255,255,0.2))`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

SystemGeoMap.propTypes = {
  regionCounts: PropTypes.objectOf(PropTypes.number),
};

SystemGeoMap.defaultProps = {
  regionCounts: {},
};

function pctFromTotals(value, total) {
  const numerator = Number(value || 0);
  const denominator = Number(total || 0);
  if (denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function CoverageTrack({ label, value, total, tone }) {
  const safeValue = Math.max(0, Number(value || 0));
  const safeTotal = Math.max(0, Number(total || 0));
  const percent = pctFromTotals(safeValue, safeTotal);
  const displayTotal = safeTotal > 0 ? safeTotal : 0;
  const gradient = tone === 'teal'
    ? 'linear-gradient(90deg, #2dd4bf, #67e8f9)'
    : tone === 'amber'
      ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
      : tone === 'rose'
        ? 'linear-gradient(90deg, #fb7185, #fda4af)'
        : 'linear-gradient(90deg, #00a3ff, #7dd3fc)';

  return (
    <div className="coverage-track-row">
      <div className="coverage-track-head">
        <span>{label}</span>
        <strong>
          {safeValue}/{displayTotal} <em>{percent}%</em>
        </strong>
      </div>
      <div className="coverage-track-bar">
        <span className="coverage-track-fill" style={{ width: `${percent}%`, background: gradient }} />
      </div>
    </div>
  );
}

CoverageTrack.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.number,
  total: PropTypes.number,
  tone: PropTypes.oneOf(['blue', 'teal', 'amber', 'rose']),
};

CoverageTrack.defaultProps = {
  value: 0,
  total: 0,
  tone: 'blue',
};

function StepBasicPanel({ activeStep, selectedApp, snapshot, fmtDateTime, fmtNum }) {
  if (activeStep === 1) {
    const telemetry = snapshot?.telemetry;
    const compliance = snapshot?.compliance;
    return (
      <div className="grid-2">
        <div className="card card-flat">
          <div className="section-label">Application Profile</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <div><strong>Name:</strong> {selectedApp?.name || 'N/A'}</div>
            <div><strong>Domain:</strong> {selectedApp?.domain || 'N/A'}</div>
            <div><strong>AI System Type:</strong> {selectedApp?.ai_system_type || 'N/A'}</div>
            <div><strong>Decision Type:</strong> {selectedApp?.decision_type || 'N/A'}</div>
            <div><strong>Autonomy:</strong> {selectedApp?.autonomy_level || 'N/A'}</div>
          </div>
        </div>
        <div className="card card-flat">
          <div className="section-label">Corporate Oversight Signals</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <div><strong>Owner:</strong> {selectedApp?.owner_email || 'N/A'}</div>
            <div><strong>Division:</strong> {selectedApp?.division_id || 'N/A'}</div>
            <div><strong>Telemetry Status:</strong> {telemetry?.status || 'N/A'}</div>
            <div><strong>KPI Readings:</strong> {telemetry?.total_readings ?? 'N/A'}</div>
            <div><strong>Compliance Pass Rate:</strong> {fmtPercent(compliance?.pass_rate)}</div>
            <div><strong>Last KPI Ingest:</strong> {fmtDateTime(telemetry?.latest_reading)}</div>
          </div>
        </div>
      </div>
    );
  }


  return null;
}

StepBasicPanel.propTypes = {
  activeStep: PropTypes.number,
  selectedApp: PropTypes.shape({
    name: PropTypes.string,
    domain: PropTypes.string,
    ai_system_type: PropTypes.string,
    decision_type: PropTypes.string,
    autonomy_level: PropTypes.string,
    owner_email: PropTypes.string,
    division_id: PropTypes.string,
    consent_scope: PropTypes.string,
    status: PropTypes.string,
    registered_at: PropTypes.string,
  }),
  snapshot: PropTypes.shape({
    tier: PropTypes.object,
    compliance: PropTypes.object,
    telemetry: PropTypes.object,
  }).isRequired,
  fmtDateTime: PropTypes.func.isRequired,
  fmtNum: PropTypes.func.isRequired,
};

export default function GovernanceTab({ requestedStep, onDashboardUiChange, mode }) {
  const { selectedApp } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeStep, setActiveStep] = useState(null);
  const [loadingStepDetail, setLoadingStepDetail] = useState(false);
  const [stepDetailError, setStepDetailError] = useState('');
  const [corporateRequirementListView, setCorporateRequirementListView] = useState('baseline');
  const [stepRequirementListView, setStepRequirementListView] = useState({
    1: 'baseline',
    2: 'baseline',
    3: 'baseline',
    4: 'baseline',
    5: 'baseline',
    6: 'baseline',
    7: 'baseline',
    8: 'baseline',
    9: 'baseline',
  });
  const [detailCache, setDetailCache] = useState({
    benchmarks: null,
    history: null,
    recommendations: null,
    dashboardStep1: null,
    dashboardStep2: null,
    dashboardStep3: null,
    dashboardStep4: null,
    dashboardStep5: null,
    dashboardStep6: null,
    dashboardStep7: null,
    dashboardStep8: null,
    dashboardStep9: null,
  });
  const [snapshot, setSnapshot] = useState({
    tier: null,
    compliance: null,
    telemetry: null,
  });
  const [interpretationRequirements, setInterpretationRequirements] = useState([]);
  const [interpretationRows, setInterpretationRows] = useState([]);
  const [interpretationLoading, setInterpretationLoading] = useState(false);
  const [interpretationSaving, setInterpretationSaving] = useState(false);
  const [interpretationError, setInterpretationError] = useState('');
  const [interpretationNotice, setInterpretationNotice] = useState('');
  const [interpretationDraft, setInterpretationDraft] = useState({
    requirementId: '',
    controlId: '',
    content: '',
    thresholdEnabled: false,
    thresholdOperator: 'lte',
    thresholdValue: '',
    thresholdMin: '',
    thresholdMax: '',
  });
  const [requirementFilter, setRequirementFilter] = useState('');
  const [scopedRequirementIds, setScopedRequirementIds] = useState([]);
  const [showScopedOnly, setShowScopedOnly] = useState(true);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeError, setScopeError] = useState('');
  const [scopeNotice, setScopeNotice] = useState('');
  const [removeRequirementModal, setRemoveRequirementModal] = useState(null);
  const [removingRequirement, setRemovingRequirement] = useState(false);
  const [requirementDetailModal, setRequirementDetailModal] = useState(null);
  const [requirementDetailLoading, setRequirementDetailLoading] = useState(false);
  const [requirementDetailError, setRequirementDetailError] = useState('');
  const [rowActionNotice, setRowActionNotice] = useState('');
  const [rowActionError, setRowActionError] = useState('');
  const [manualKpiSavingRowKeys, setManualKpiSavingRowKeys] = useState(new Set());
  const [newRequirementIds, setNewRequirementIds] = useState(new Set());
  const [hiddenRequirementRowKeys, setHiddenRequirementRowKeys] = useState(new Set());
  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [catalogSearchLoading, setCatalogSearchLoading] = useState(false);
  const [catalogSearchError, setCatalogSearchError] = useState('');
  const [catalogSearchResults, setCatalogSearchResults] = useState([]);
  const [industryCategory, setIndustryCategory] = useState('all');
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [systemOverview, setSystemOverview] = useState({
    totalApps: 0,
    connectedApps: 0,
    totalCoreControls: 0,
    totalCustomControls: 0,
    policyTypes: [],
    activeControlByCategory: [],
    distinctRules: 0,
    totalRequirements: 0,
    distinctControls: 0,
    totalControls: 0,
    rulesWithControls: 0,
    rulesWithMeasures: 0,
    controlsWithMeasures: 0,
    totalMeasureDefinitions: 0,
    distinctMeasureMetrics: 0,
    peerBenchmarkedMetrics: 0,
    totalRuleControlLinks: 0,
    distinctControlDomains: 0,
    riskComplianceControls: 0,
    riskComplianceMeasurableControls: 0,
    riskComplianceDomainsPresent: 0,
    totalRegulations: 0,
    totalJurisdictions: 0,
    totalIndustryCategories: Math.max(0, INDUSTRY_LIBRARY.length - 1),
    telemetryReadings: 0,
    telemetryStatus: 'N/A',
    totalInterpretations: 0,
    regulations: [],
    regulationRankings: [],
    totalBaselineRequirements: 0,
    totalAppSpecificRequirements: 0,
    recentRequirementTicker: [],
    topJurisdictions: [],
    regionCounts: {},
  });
  const detailSectionRef = useRef(null);

  const loadSnapshot = useCallback(async () => {
    if (!selectedApp?.id) {
      return;
    }

    setLoading(true);
    setError('');

    const [tierResult, complianceResult, telemetryResult] = await Promise.allSettled([
      api.getTier(selectedApp.id),
      api.getCompliance(selectedApp.id),
      api.getTelemetryStatus(),
    ]);

    const next = { tier: null, compliance: null, telemetry: null };
    const failed = [];

    if (tierResult.status === 'fulfilled') {
      next.tier = tierResult.value;
    } else {
      failed.push('tier');
    }

    if (complianceResult.status === 'fulfilled') {
      next.compliance = complianceResult.value;
    } else {
      failed.push('compliance');
    }

    if (telemetryResult.status === 'fulfilled') {
      next.telemetry = telemetryResult.value;
    } else {
      failed.push('telemetry');
    }

    setSnapshot(next);
    if (failed.length > 0) {
      setError(`Some live data is unavailable: ${failed.join(', ')}`);
    }
    setLoading(false);
  }, [selectedApp?.id]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const preloadDashboardStatusData = useCallback(async () => {
    if (!selectedApp?.id) {
      return;
    }
    const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const results = await Promise.allSettled(
      steps.map((stepNum) => api.getApplicationDashboardStep(selectedApp.id, stepNum))
    );
    const updates = {};
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        updates[`dashboardStep${steps[index]}`] = result.value;
      }
    });
    if (Object.keys(updates).length > 0) {
      setDetailCache((prev) => ({ ...prev, ...updates }));
    }
  }, [selectedApp?.id]);

  useEffect(() => {
    preloadDashboardStatusData();
  }, [preloadDashboardStatusData]);

  const loadSystemOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError('');

    const [appsResult, requirementsResult, controlsResult, regulationsResult, overviewStatsResult, telemetryResult] = await Promise.allSettled([
      api.listApplications(),
      api.getRequirements('limit=200'),
      api.getControls('limit=200'),
      api.getRegulations('limit=500'),
      api.getCatalogOverviewStats(),
      api.getTelemetryStatus(),
    ]);

    const failed = [];

    const applications = appsResult.status === 'fulfilled' && Array.isArray(appsResult.value)
      ? appsResult.value
      : [];
    if (appsResult.status !== 'fulfilled') {
      failed.push('applications');
    }

    const requirementPayload = requirementsResult.status === 'fulfilled' ? requirementsResult.value : null;
    if (requirementsResult.status !== 'fulfilled') {
      failed.push('requirements');
    }
    const requirements = Array.isArray(requirementPayload?.items) ? requirementPayload.items : [];

    const controlsPayload = controlsResult.status === 'fulfilled' ? controlsResult.value : null;
    if (controlsResult.status !== 'fulfilled') {
      failed.push('controls');
    }
    const controls = Array.isArray(controlsPayload?.items) ? controlsPayload.items : [];

    const regulationsPayload = regulationsResult.status === 'fulfilled' ? regulationsResult.value : null;
    if (regulationsResult.status !== 'fulfilled') {
      failed.push('regulations');
    }
    const regulations = Array.isArray(regulationsPayload?.items) ? regulationsPayload.items : [];

    const overviewStats = overviewStatsResult.status === 'fulfilled' ? overviewStatsResult.value : null;
    if (overviewStatsResult.status !== 'fulfilled') {
      failed.push('overview_stats');
    }

    const telemetry = telemetryResult.status === 'fulfilled' ? telemetryResult.value : null;
    if (telemetryResult.status !== 'fulfilled') {
      failed.push('telemetry');
    }

    const regulationSet = new Set(
      requirements
        .map((item) => String(item?.regulation_title || '').trim())
        .filter((title) => isValidRegulationTitle(title))
    );
    if (regulationSet.size === 0) {
      regulations
        .map((item) => String(item?.title || '').trim())
        .filter((title) => isValidRegulationTitle(title))
        .forEach((title) => regulationSet.add(title));
    }
    const governanceCategorySet = new Set(STEP_DEFS.map((step) => String(step.label || '').trim().toLowerCase()));
    const requirementCategorySet = new Set(
      requirements
        .map((item) => String(item?.category || '').trim())
        .filter((category) => governanceCategorySet.has(category.toLowerCase()))
    );
    const policyTypes = Array.from(
      new Set(
        requirements
          .map((item) => String(item?.policy_type || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
    const jurisdictionCounts = {};
    requirements.forEach((item) => {
      const jurisdiction = normalizeJurisdictionKey(item?.jurisdiction);
      if (!isDisplayableJurisdiction(jurisdiction)) {
        return;
      }
      jurisdictionCounts[jurisdiction] = (jurisdictionCounts[jurisdiction] || 0) + 1;
    });

    if (Object.keys(jurisdictionCounts).length === 0) {
      regulations.forEach((item) => {
        const jurisdiction = normalizeJurisdictionKey(item?.jurisdiction);
        if (!isDisplayableJurisdiction(jurisdiction)) {
          return;
        }
        const weight = Number(item?.requirement_count ?? 0);
        jurisdictionCounts[jurisdiction] = (jurisdictionCounts[jurisdiction] || 0) + (Number.isFinite(weight) && weight > 0 ? weight : 1);
      });
    }

    const regionCounts = {};
    Object.entries(jurisdictionCounts).forEach(([jurisdiction, count]) => {
      const region = mapJurisdictionToRegion(jurisdiction);
      regionCounts[region] = (regionCounts[region] || 0) + Number(count || 0);
    });

    const sortedJurisdictionRows = Object.entries(jurisdictionCounts)
      .sort((a, b) => {
        const byCount = b[1] - a[1];
        if (byCount !== 0) {
          return byCount;
        }
        return a[0].localeCompare(b[0]);
      });
    const topJurisdictionLimit = 8;
    let topJurisdictionRows = sortedJurisdictionRows.slice(0, topJurisdictionLimit);
    if (sortedJurisdictionRows.length > topJurisdictionLimit && topJurisdictionRows.length > 0) {
      const cutoffCount = Number(topJurisdictionRows[topJurisdictionRows.length - 1][1] || 0);
      topJurisdictionRows = sortedJurisdictionRows.filter(([, count], index) => (
        index < topJurisdictionLimit || Number(count || 0) === cutoffCount
      ));
    }
    const topJurisdictions = topJurisdictionRows.map(([name, count]) => ({
      name,
      label: formatJurisdictionLabel(name),
      count,
    }));

    const riskComplianceDomainSet = new Set(['risk & compliance']);
    const normalizedControls = controls.map((item) => ({
      domain: String(item?.domain || '').trim().toLowerCase(),
      measurementMode: String(item?.measurement_mode || '').trim().toLowerCase(),
    }));
    const riskComplianceControls = normalizedControls.filter((item) => riskComplianceDomainSet.has(item.domain));
    const riskComplianceMeasurableControls = riskComplianceControls.filter((item) => item.measurementMode !== 'manual');
    const riskComplianceDomainsPresent = new Set(riskComplianceControls.map((item) => item.domain)).size;
    const controlsWithMeasuresFallback = normalizedControls.filter((item) => item.measurementMode !== 'manual').length;

    const requirementById = new Map(
      requirements
        .map((item) => {
          const reqId = String(item?.id || '').trim();
          return reqId
            ? [reqId, item]
            : null;
        })
        .filter(Boolean)
    );

    const activeApplicationIds = applications
      .filter((item) => String(item?.status || '').toLowerCase() !== 'disconnected')
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);
    const controlModeById = new Map(
      controls
        .map((item) => {
          const controlId = String(item?.id || '').trim();
          if (!controlId) {
            return null;
          }
          return [controlId, String(item?.measurement_mode || '').trim().toLowerCase()];
        })
        .filter(Boolean)
    );
    const baselineAssignedRequirementIds = new Set();
    const appSpecificAssignedRequirementIds = new Set();
    const baselineAssignedControlIds = new Set();
    const appSpecificAssignedControlIds = new Set();
    const recentRequirementTickerMap = new Map();
    const activeControlsByCategory = new Map(
      STEP_DEFS.map((step) => [
        String(step.label || '').trim().toLowerCase(),
        {
          category: String(step.label || '').trim(),
          activeTelemetry: new Set(),
          activeManual: new Set(),
          inactiveTelemetry: new Set(),
          inactiveManual: new Set(),
        },
      ])
    );
    if (activeApplicationIds.length > 0) {
      const appScopeResults = await Promise.allSettled(
        activeApplicationIds.map((appId) => api.getApplicationRequirements(appId, 'skip=0&limit=200'))
      );
      if (appScopeResults.some((result) => result.status !== 'fulfilled')) {
        failed.push('application_scope');
      }
      appScopeResults.forEach((result) => {
        if (result.status !== 'fulfilled') {
          return;
        }
        const items = Array.isArray(result.value?.items) ? result.value.items : [];
        items.forEach((item) => {
          const reqId = String(item?.requirement_id || '').trim();
          if (!reqId) {
            return;
          }
          const categoryLabel = String(item?.category || '').trim();
          const categoryKey = categoryLabel.toLowerCase();
          const categoryBucket = activeControlsByCategory.get(categoryKey);
          const reqDetail = requirementById.get(reqId) || {};
          const addedAt = item?.added_at || null;
          const currentTicker = recentRequirementTickerMap.get(reqId);
          const currentTs = currentTicker?.added_at ? Date.parse(currentTicker.added_at) : Number.NEGATIVE_INFINITY;
          const nextTs = addedAt ? Date.parse(addedAt) : Number.NEGATIVE_INFINITY;
          if (!currentTicker || nextTs > currentTs) {
            recentRequirementTickerMap.set(reqId, {
              id: reqId,
              title: String(item?.title || reqDetail?.title || '').trim() || 'Untitled requirement',
              description: String(reqDetail?.description || '').trim() || 'No description available.',
              category: String(item?.category || reqDetail?.category || '').trim() || 'Uncategorized',
              policy_title:
                String(
                  item?.regulation_title
                  || reqDetail?.regulation_title
                  || reqDetail?.policy_title
                  || ''
                ).trim() || 'Policy Unspecified',
              added_at: addedAt,
            });
          }
          (Array.isArray(item?.linked_controls) ? item.linked_controls : []).forEach((control) => {
            const controlId = String(control?.id || '').trim();
            if (!controlId) {
              return;
            }
            const controlMode = String(controlModeById.get(controlId) || '').trim().toLowerCase();
            const metricName = String(control?.metric_name || '').trim().toLowerCase();
            const isManual = controlMode === 'manual' || metricName.startsWith('manual.evidence.');
            const policyStatus = String(
              item?.policy_status
              || reqDetail?.policy_status
              || ''
            ).trim().toLowerCase();
            const isRequirementInactive = policyStatus === 'inactive';
            const isSelectedAndActive = Boolean(item?.selected) && !isRequirementInactive;

            if (isSelectedAndActive) {
              if (categoryBucket) {
                if (isManual) {
                  categoryBucket.activeManual.add(controlId);
                  categoryBucket.inactiveManual.delete(controlId);
                } else {
                  categoryBucket.activeTelemetry.add(controlId);
                  categoryBucket.inactiveTelemetry.delete(controlId);
                }
              }
              if (item?.is_default) {
                baselineAssignedRequirementIds.add(reqId);
                baselineAssignedControlIds.add(controlId);
              } else {
                appSpecificAssignedRequirementIds.add(reqId);
                appSpecificAssignedControlIds.add(controlId);
              }
            } else if (categoryBucket) {
              if (isManual) {
                if (!categoryBucket.activeManual.has(controlId)) {
                  categoryBucket.inactiveManual.add(controlId);
                }
              } else if (!categoryBucket.activeTelemetry.has(controlId)) {
                categoryBucket.inactiveTelemetry.add(controlId);
              }
            }
          });
        });
      });
    }

    const foundationControlIds = controls
      .filter((item) => Boolean(item?.is_foundation))
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);
    const baselineRequirementIdSet = new Set();
    if (foundationControlIds.length > 0 && baselineAssignedRequirementIds.size === 0) {
      const baselineRequirementResults = await Promise.allSettled(
        foundationControlIds.map((controlId) => api.getRequirements(`control_id=${encodeURIComponent(controlId)}&skip=0&limit=200`))
      );
      if (baselineRequirementResults.some((result) => result.status !== 'fulfilled')) {
        failed.push('baseline_requirements');
      }
      baselineRequirementResults.forEach((result) => {
        if (result.status !== 'fulfilled') {
          return;
        }
        const items = Array.isArray(result.value?.items) ? result.value.items : [];
        items.forEach((item) => {
          const requirementId = String(item?.id || '').trim();
          if (requirementId) {
            baselineRequirementIdSet.add(requirementId);
          }
        });
      });
    }

    const regulationUniverseMap = new Map();
    requirements.forEach((item) => {
      const regulationTitle = String(item?.regulation_title || '').trim();
      if (!isValidRegulationTitle(regulationTitle)) {
        return;
      }
      const normalizedJurisdiction = normalizeJurisdictionKey(item?.jurisdiction);
      const universeTitle = normalizeRegulationUniverseTitle(regulationTitle, normalizedJurisdiction);
      if (!regulationUniverseMap.has(universeTitle)) {
        regulationUniverseMap.set(universeTitle, {
          name: universeTitle,
          totalRequirementIds: new Set(),
          baselineRequirementIds: new Set(),
          jurisdictions: new Set(),
          sourceRegulations: new Set(),
        });
      }
      const row = regulationUniverseMap.get(universeTitle);
      const requirementId = String(item?.id || '').trim();
      if (requirementId) {
        row.totalRequirementIds.add(requirementId);
        if (baselineRequirementIdSet.has(requirementId)) {
          row.baselineRequirementIds.add(requirementId);
        }
      }
      if (isDisplayableJurisdiction(normalizedJurisdiction)) {
        row.jurisdictions.add(formatJurisdictionLabel(normalizedJurisdiction));
      }
      row.sourceRegulations.add(regulationTitle);
    });

    const regulationRankings = Array.from(regulationUniverseMap.values())
      .map((item) => ({
        name: item.name,
        totalRequirements: item.totalRequirementIds.size,
        baselineRequirements: item.baselineRequirementIds.size,
        jurisdictionLabel: item.jurisdictions.size ? Array.from(item.jurisdictions).sort((a, b) => a.localeCompare(b)).join(', ') : 'N/A',
        sourceCount: item.sourceRegulations.size,
      }))
      .filter((item) => item.totalRequirements > 0)
      .sort((a, b) => {
        if (b.totalRequirements !== a.totalRequirements) {
          return b.totalRequirements - a.totalRequirements;
        }
        if (b.baselineRequirements !== a.baselineRequirements) {
          return b.baselineRequirements - a.baselineRequirements;
        }
        return a.name.localeCompare(b.name);
      });
    const totalBaselineRequirements = baselineAssignedRequirementIds.size || baselineRequirementIdSet.size;
    const totalAppSpecificRequirements = appSpecificAssignedRequirementIds.size;
    const totalCoreControls = baselineAssignedControlIds.size || controls.filter((item) => Boolean(item?.is_foundation)).length;
    const totalCustomControls = appSpecificAssignedControlIds.size;
    const activeControlByCategory = STEP_DEFS.map((step) => {
      const bucket = activeControlsByCategory.get(String(step.label || '').trim().toLowerCase());
      const activeTelemetry = bucket ? bucket.activeTelemetry.size : 0;
      const activeManual = bucket ? bucket.activeManual.size : 0;
      const inactiveTelemetry = bucket ? bucket.inactiveTelemetry.size : 0;
      const inactiveManual = bucket ? bucket.inactiveManual.size : 0;
      const activeTotal = activeTelemetry + activeManual;
      const inactiveTotal = inactiveTelemetry + inactiveManual;
      return {
        category: String(step.label || '').trim(),
        activeTelemetry,
        activeManual,
        activeTotal,
        inactiveTelemetry,
        inactiveManual,
        inactiveTotal,
        total: activeTotal + inactiveTotal,
      };
    });
    const recentRequirementTicker = Array.from(recentRequirementTickerMap.values())
      .sort((a, b) => {
        const aTs = a.added_at ? Date.parse(a.added_at) : Number.NEGATIVE_INFINITY;
        const bTs = b.added_at ? Date.parse(b.added_at) : Number.NEGATIVE_INFINITY;
        return bTs - aTs;
      })
      .slice(0, 5);

    setSystemOverview({
      totalApps: applications.length,
      connectedApps: applications.filter((app) => app?.status === 'active').length,
      totalCoreControls,
      totalCustomControls,
      policyTypes,
      activeControlByCategory,
      distinctRules: Number(overviewStats?.distinct_rules ?? requirementPayload?.total ?? requirements.length ?? 0),
      totalRequirements: Number(overviewStats?.total_requirements ?? requirementPayload?.total ?? requirements.length ?? 0),
      distinctControls: Number(overviewStats?.total_controls ?? controlsPayload?.total ?? controls.length ?? 0),
      totalControls: Number(overviewStats?.total_controls ?? controlsPayload?.total ?? controls.length ?? 0),
      rulesWithControls: Number(overviewStats?.rules_with_controls ?? 0),
      rulesWithMeasures: Number(overviewStats?.rules_with_measures ?? 0),
      controlsWithMeasures: Number(overviewStats?.controls_with_measures ?? controlsWithMeasuresFallback),
      totalMeasureDefinitions: Number(overviewStats?.total_measure_definitions ?? 0),
      distinctMeasureMetrics: Number(overviewStats?.distinct_measure_metrics ?? 0),
      peerBenchmarkedMetrics: Number(overviewStats?.peer_benchmarked_metrics ?? 0),
      totalRuleControlLinks: Number(overviewStats?.total_control_requirement_links ?? 0),
      distinctControlDomains: requirementCategorySet.size,
      riskComplianceControls: Number(overviewStats?.risk_compliance_controls ?? riskComplianceControls.length),
      riskComplianceMeasurableControls: Number(
        overviewStats?.risk_compliance_measurable_controls ?? riskComplianceMeasurableControls.length
      ),
      riskComplianceDomainsPresent: Number(overviewStats?.risk_compliance_domains_present ?? riskComplianceDomainsPresent),
      totalRegulations: regulationSet.size || Number(overviewStats?.total_regulations ?? regulationsPayload?.total ?? 0),
      totalJurisdictions: Number(overviewStats?.total_jurisdictions ?? Object.keys(jurisdictionCounts).length),
      totalIndustryCategories: Math.max(0, INDUSTRY_LIBRARY.length - 1),
      telemetryReadings: Number(telemetry?.total_readings ?? 0),
      telemetryStatus: String(telemetry?.status || 'N/A'),
      totalInterpretations: Number(overviewStats?.total_interpretations ?? 0),
      regulations: Array.from(regulationSet).sort((a, b) => a.localeCompare(b)).slice(0, 18),
      regulationRankings,
      totalBaselineRequirements,
      totalAppSpecificRequirements,
      recentRequirementTicker,
      topJurisdictions,
      regionCounts,
    });

    const userVisibleFailures = failed.filter((item) => item !== 'baseline_requirements');
    if (userVisibleFailures.length > 0) {
      setOverviewError(`Some system data is unavailable: ${userVisibleFailures.join(', ')}`);
    }
    setOverviewLoading(false);
  }, []);

  useEffect(() => {
    loadSystemOverview();
  }, [loadSystemOverview]);

  useEffect(() => {
    setActiveStep(null);
    setLoadingStepDetail(false);
    setStepDetailError('');
    setCorporateRequirementListView('baseline');
    setStepRequirementListView({
      1: 'baseline',
      2: 'baseline',
      3: 'baseline',
      4: 'baseline',
      5: 'baseline',
      6: 'baseline',
      7: 'baseline',
      8: 'baseline',
      9: 'baseline',
    });
    setDetailCache({
      benchmarks: null,
      history: null,
      recommendations: null,
      dashboardStep1: null,
      dashboardStep2: null,
      dashboardStep3: null,
      dashboardStep4: null,
      dashboardStep5: null,
      dashboardStep6: null,
      dashboardStep7: null,
      dashboardStep8: null,
      dashboardStep9: null,
    });
    setInterpretationRequirements([]);
    setInterpretationRows([]);
    setInterpretationLoading(false);
    setInterpretationSaving(false);
    setInterpretationError('');
    setInterpretationNotice('');
    setInterpretationDraft({
      requirementId: '',
      controlId: '',
      content: '',
      thresholdEnabled: false,
      thresholdOperator: 'lte',
      thresholdValue: '',
      thresholdMin: '',
      thresholdMax: '',
    });
    setRequirementFilter('');
    setScopedRequirementIds([]);
    setShowScopedOnly(true);
    setScopeSaving(false);
    setScopeError('');
    setScopeNotice('');
    setRemoveRequirementModal(null);
    setRemovingRequirement(false);
    setRowActionNotice('');
    setRowActionError('');
    setManualKpiSavingRowKeys(new Set());
    setNewRequirementIds(new Set());
    setHiddenRequirementRowKeys(new Set());
    setCatalogSearchQuery('');
    setCatalogSearchLoading(false);
    setCatalogSearchError('');
    setCatalogSearchResults([]);
    setIndustryCategory('all');
  }, [selectedApp?.id]);

  useEffect(() => {
    if (!selectedApp?.id) {
      setNewRequirementIds(new Set());
      return;
    }
    setNewRequirementIds(loadNewRequirementMarkers(selectedApp.id));
  }, [selectedApp?.id]);

  useEffect(() => {
    if (!selectedApp?.id) {
      setHiddenRequirementRowKeys(new Set());
      return;
    }
    setHiddenRequirementRowKeys(loadHiddenRequirementRows(selectedApp.id));
  }, [selectedApp?.id]);

  const loadInterpretationRows = useCallback(async (requirementId) => {
    if (!selectedApp?.id || !requirementId) {
      setInterpretationRows([]);
      return;
    }

    setInterpretationLoading(true);
    setInterpretationError('');
    try {
      const payload = await api.getApplicationInterpretations(selectedApp.id);
      const rows = Array.isArray(payload)
        ? payload.filter((item) => item.requirement_id === requirementId)
        : [];
      setInterpretationRows(rows);
    } catch (e) {
      setInterpretationRows([]);
      setInterpretationError(e.message || 'Failed to load interpretations');
    } finally {
      setInterpretationLoading(false);
    }
  }, [selectedApp?.id]);

  const loadRequirementScope = useCallback(async () => {
    if (!selectedApp?.id) {
      setInterpretationRequirements([]);
      setScopedRequirementIds([]);
      return [];
    }

    const payload = await api.getApplicationRequirements(selectedApp.id, 'limit=300');
    const items = (payload.items || []).map(normalizeRequirementItem);
    const selectedIds = items.filter((item) => item.selected).map((item) => item.id);

    setInterpretationRequirements(items);
    setScopedRequirementIds(selectedIds);
    setInterpretationDraft((prev) => {
      const hasRequirement = prev.requirementId && items.some((item) => item.id === prev.requirementId);
      const nextRequirementId = hasRequirement
        ? prev.requirementId
        : (selectedIds[0] || items[0]?.id || '');
      return {
        ...prev,
        requirementId: nextRequirementId,
        controlId: resolveDefaultControlId(nextRequirementId, items, prev.controlId),
      };
    });
    return items;
  }, [selectedApp?.id]);

  useEffect(() => {
    if (!selectedApp?.id) {
      return;
    }
    loadRequirementScope().catch(() => {
      // Non-blocking on initial render; step-level loaders surface errors as needed.
    });
  }, [loadRequirementScope, selectedApp?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handleRequirementsRefresh = () => {
      loadSystemOverview();
      preloadDashboardStatusData();
      if (selectedApp?.id) {
        loadRequirementScope().catch(() => {
          // Non-blocking refresh path.
        });
      }
    };
    window.addEventListener('aigov:requirements-updated', handleRequirementsRefresh);
    return () => {
      window.removeEventListener('aigov:requirements-updated', handleRequirementsRefresh);
    };
  }, [loadRequirementScope, loadSystemOverview, preloadDashboardStatusData, selectedApp?.id]);

  const filteredRequirements = useMemo(() => {
    const q = requirementFilter.trim().toLowerCase();
    if (!q) {
      return interpretationRequirements;
    }
    return interpretationRequirements.filter((req) =>
      `${req.code} ${req.title} ${req.regulation_title || ''} ${req.jurisdiction || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [interpretationRequirements, requirementFilter]);

  const scopedRequirementSet = useMemo(
    () => new Set(scopedRequirementIds),
    [scopedRequirementIds]
  );

  const requirementScopeById = useMemo(() => {
    const map = new Map();
    interpretationRequirements.forEach((item) => {
      if (item?.id) {
        map.set(String(item.id), item);
      }
    });
    return map;
  }, [interpretationRequirements]);

  const isRowHidden = useCallback(
    (row) => {
      const requirementId = String(row?.requirement_id || '').trim();
      const scopeItem = requirementId ? requirementScopeById.get(requirementId) : null;
      // Secretariat baseline rows should always remain visible.
      if (scopeItem?.is_default) {
        return false;
      }
      const key = buildDashboardRowKey(row);
      return Boolean(key && hiddenRequirementRowKeys.has(key));
    },
    [hiddenRequirementRowKeys, requirementScopeById]
  );

  const filterVisibleRows = useCallback(
    (rows) => (Array.isArray(rows) ? rows.filter((row) => !isRowHidden(row)) : []),
    [isRowHidden]
  );

  const splitRowsByRequirementType = useCallback(
    (rows) => {
      const baselineRows = [];
      const applicationSpecificRows = [];
      (rows || []).forEach((row) => {
        const requirementId = String(row?.requirement_id || '').trim();
        const scopeItem = requirementId ? requirementScopeById.get(requirementId) : null;
        if (scopeItem?.is_default) {
          baselineRows.push(row);
        } else {
          applicationSpecificRows.push(row);
        }
      });
      return { baselineRows, applicationSpecificRows };
    },
    [requirementScopeById]
  );

  const isRowMarkedNew = useCallback(
    (row) => {
      const requirementId = String(row?.requirement_id || '').trim();
      return Boolean(requirementId && newRequirementIds.has(requirementId));
    },
    [newRequirementIds]
  );

  const isRowRemovable = useCallback(
    (row) => {
      const rowKey = buildDashboardRowKey(row);
      if (!rowKey) return false;
      return true;
    },
    []
  );

  const renderRequirementRowHeader = useCallback((row, rowStatusClass, applicationSpecificView = false) => {
    const rowStatusLabel = getGovernanceRowStatusLabel(row, applicationSpecificView);
    const showNew = isRowMarkedNew(row);
    const removable = isRowRemovable(row);
    const requirementId = String(row?.requirement_id || '').trim();
    const scopeItem = requirementId ? requirementScopeById.get(requirementId) : null;
    const rowActionLabel = scopeItem?.selected && !scopeItem?.is_default ? 'Remove' : 'Hide';
    const requirementTitle = row?.requirement_title || 'Requirement details are not available for this row.';
    const requirementDescription = row?.requirement_description || 'Requirement description is not available.';
    const controlTitle = String(row?.control_title || '').trim();
    const normalizedControlTitle = controlTitle.toLowerCase();
    const normalizedRequirementTitle = String(requirementTitle || '').trim().toLowerCase();
    const showRequirementTitle = Boolean(
      normalizedRequirementTitle
      && normalizedRequirementTitle !== normalizedControlTitle
    );
    return (
      <div style={{ display: 'grid', gap: '0.15rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700, fontSize: '0.79rem' }}>
              {row.control_title || 'Control'}
            </div>
            <span className={`badge ${rowStatusClass}`} style={{ width: 'fit-content' }}>
              {rowStatusLabel}
            </span>
            {showNew ? (
              <span className="badge badge-blue" style={{ width: 'fit-content' }}>
                NEW
              </span>
            ) : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="catalog-row-icon-action governance-row-icon-action"
              onClick={() => openRequirementDetailModal(row)}
              title="Requirement Detail"
              aria-label="Open requirement detail"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
                <path d="M14 2v5h5" />
                <path d="M9 13h6" />
                <path d="M9 17h4" />
              </svg>
            </button>
            {removable ? (
              <button
                type="button"
                className={`catalog-row-icon-action governance-row-icon-action ${rowActionLabel === 'Remove' ? 'governance-row-icon-remove' : 'governance-row-icon-hide'}`}
                onClick={() => openRemoveRequirementModal(row)}
                disabled={removingRequirement}
                title={rowActionLabel}
                aria-label={rowActionLabel}
              >
                {rowActionLabel === 'Remove' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 3l18 18" />
                    <path d="M10.58 10.58a2 2 0 1 0 2.84 2.84" />
                    <path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c5 0 9.27 3.11 11 7-1 2.15-2.69 3.96-4.77 5.12" />
                    <path d="M6.61 6.61C4.62 7.79 3 9.69 2 12c1.73 3.89 6 7 10 7 1.34 0 2.62-.27 3.8-.76" />
                  </svg>
                )}
              </button>
            ) : null}
          </div>
        </div>
        {showRequirementTitle ? (
          <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)', lineHeight: 1.35, fontWeight: 400 }}>
            {requirementTitle}
          </div>
        ) : null}
        <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {requirementDescription}
        </div>
      </div>
    );
  }, [isRowMarkedNew, isRowRemovable, openRemoveRequirementModal, openRequirementDetailModal, removingRequirement, requirementScopeById]);

  const interpretationRequirementOptions = useMemo(() => {
    const hasScopedRequirements = scopedRequirementIds.length > 0;
    if (!showScopedOnly || !hasScopedRequirements) {
      return filteredRequirements;
    }
    return filteredRequirements.filter((req) => scopedRequirementSet.has(req.id));
  }, [filteredRequirements, scopedRequirementIds.length, scopedRequirementSet, showScopedOnly]);

  const selectedInterpretationRequirement = useMemo(() => (
    interpretationRequirementOptions.find((item) => item.id === interpretationDraft.requirementId)
    || interpretationRequirements.find((item) => item.id === interpretationDraft.requirementId)
    || null
  ), [interpretationDraft.requirementId, interpretationRequirementOptions, interpretationRequirements]);

  const interpretationControlOptions = useMemo(
    () => selectedInterpretationRequirement?.linked_controls || [],
    [selectedInterpretationRequirement]
  );

  const defaultRequirementCount = useMemo(
    () => interpretationRequirements.filter((item) => item.is_default).length,
    [interpretationRequirements]
  );

  const selectedDefaultCount = useMemo(
    () => interpretationRequirements.filter((item) => item.is_default && scopedRequirementSet.has(item.id)).length,
    [interpretationRequirements, scopedRequirementSet]
  );

  const selectedCustomCount = useMemo(
    () => interpretationRequirements.filter((item) => !item.is_default && scopedRequirementSet.has(item.id)).length,
    [interpretationRequirements, scopedRequirementSet]
  );

  const defaultFilteredRequirements = useMemo(
    () => filteredRequirements.filter((item) => item.is_default),
    [filteredRequirements]
  );

  const customFilteredRequirements = useMemo(
    () => filteredRequirements.filter((item) => !item.is_default),
    [filteredRequirements]
  );

  const activeCustomRequirements = useMemo(
    () => interpretationRequirements.filter((item) => !item.is_default && scopedRequirementSet.has(item.id)),
    [interpretationRequirements, scopedRequirementSet]
  );

  const benchmarkByMetric = useMemo(() => {
    const map = new Map();
    (detailCache.benchmarks?.benchmarks || []).forEach((item) => {
      if (item?.metric_name) {
        map.set(String(item.metric_name), item);
      }
    });
    return map;
  }, [detailCache.benchmarks]);

  const requirementsById = useMemo(
    () => new Map(interpretationRequirements.map((item) => [item.id, item])),
    [interpretationRequirements]
  );

  const controlToRequirementIds = useMemo(() => {
    const map = new Map();
    interpretationRequirements.forEach((req) => {
      (req.linked_controls || []).forEach((control) => {
        const key = String(control.id);
        if (!map.has(key)) {
          map.set(key, []);
        }
        map.set(key, [...map.get(key), req.id]);
      });
    });
    return map;
  }, [interpretationRequirements]);

  const recommendedControlIdSet = useMemo(
    () => new Set((detailCache.recommendations?.recommendations || []).map((item) => String(item.control_id))),
    [detailCache.recommendations]
  );

  const serverScopedRequirementIds = useMemo(
    () => interpretationRequirements.filter((item) => item.selected).map((item) => item.id),
    [interpretationRequirements]
  );

  const scopeAddedCount = useMemo(
    () => scopedRequirementIds.filter((id) => !serverScopedRequirementIds.includes(id)).length,
    [scopedRequirementIds, serverScopedRequirementIds]
  );

  const scopeRemovedCount = useMemo(
    () => serverScopedRequirementIds.filter((id) => !scopedRequirementSet.has(id)).length,
    [serverScopedRequirementIds, scopedRequirementSet]
  );

  const isScopeDirty = useMemo(
    () => !sameStringSet(scopedRequirementIds, serverScopedRequirementIds),
    [scopedRequirementIds, serverScopedRequirementIds]
  );

  const suggestedRequirements = useMemo(
    () => interpretationRequirements
      .filter((req) => (
        !req.is_default
        && !scopedRequirementSet.has(req.id)
        && (req.linked_controls || []).some((ctrl) => recommendedControlIdSet.has(String(ctrl.id)))
      ))
      .slice(0, 20),
    [interpretationRequirements, recommendedControlIdSet, scopedRequirementSet]
  );

  const industryFilteredSuggestions = useMemo(
    () => suggestedRequirements.filter((req) => matchesIndustryRequirement(req, industryCategory)),
    [suggestedRequirements, industryCategory]
  );

  const suggestedRequirementIds = useMemo(
    () => suggestedRequirements.map((item) => item.id),
    [suggestedRequirements]
  );

  const industryFilteredCustomRequirements = useMemo(
    () => customFilteredRequirements.filter((req) => matchesIndustryRequirement(req, industryCategory)),
    [customFilteredRequirements, industryCategory]
  );

  const addableIndustryRequirementIds = useMemo(
    () => industryFilteredCustomRequirements
      .filter((req) => !scopedRequirementSet.has(req.id))
      .map((req) => req.id),
    [industryFilteredCustomRequirements, scopedRequirementSet]
  );

  const selectedInterpretationControl = useMemo(
    () => interpretationControlOptions.find((item) => item.id === interpretationDraft.controlId) || null,
    [interpretationControlOptions, interpretationDraft.controlId]
  );

  const thresholdDraftResult = useMemo(
    () => buildThresholdOverrideFromDraft(interpretationDraft),
    [interpretationDraft]
  );

  const permissivenessWarning = useMemo(() => {
    if (!interpretationDraft.thresholdEnabled || thresholdDraftResult.validationError) {
      return '';
    }
    const baseline = selectedInterpretationControl?.default_threshold;
    if (!baseline) {
      return '';
    }
    if (isMorePermissiveThreshold(thresholdDraftResult.thresholdOverride, baseline)) {
      return `Warning: this override is more permissive than platform default (${formatThresholdOverride(baseline)}).`;
    }
    return '';
  }, [
    interpretationDraft.thresholdEnabled,
    selectedInterpretationControl,
    thresholdDraftResult.thresholdOverride,
    thresholdDraftResult.validationError,
  ]);

  const toggleScopedRequirement = useCallback((requirementId) => {
    const requirement = interpretationRequirements.find((item) => item.id === requirementId);
    if (requirement?.is_default) {
      return;
    }
    setScopedRequirementIds((prev) => (
      prev.includes(requirementId)
        ? prev.filter((id) => id !== requirementId)
        : [...prev, requirementId]
    ));
  }, [interpretationRequirements]);

  const addRequirementToScope = useCallback((requirementId) => {
    setScopedRequirementIds((prev) => (
      prev.includes(requirementId) ? prev : [...prev, requirementId]
    ));
  }, []);

  const addRequirementsToScope = useCallback((requirementIds) => {
    const normalized = Array.from(new Set((requirementIds || []).filter(Boolean)));
    if (!normalized.length) {
      return;
    }
    setScopedRequirementIds((prev) => Array.from(new Set([...prev, ...normalized])));
  }, []);

  const removeRequirementFromScope = useCallback((requirementId) => {
    const requirement = interpretationRequirements.find((item) => item.id === requirementId);
    if (requirement?.is_default) {
      return;
    }
    setScopedRequirementIds((prev) => prev.filter((id) => id !== requirementId));
  }, [interpretationRequirements]);

  const addAllSuggestedToScope = useCallback(() => {
    if (!suggestedRequirementIds.length) {
      return;
    }
    setScopedRequirementIds((prev) => Array.from(new Set([...prev, ...suggestedRequirementIds])));
  }, [suggestedRequirementIds]);

  const resetScopeDraft = useCallback(() => {
    setScopedRequirementIds(serverScopedRequirementIds);
  }, [serverScopedRequirementIds]);

  const runCatalogSearch = useCallback(async () => {
    const q = catalogSearchQuery.trim();
    if (!q) {
      setCatalogSearchResults([]);
      setCatalogSearchError('');
      return;
    }
    setCatalogSearchLoading(true);
    setCatalogSearchError('');
    try {
      const payload = await api.searchCatalog(q);
      setCatalogSearchResults(payload.items || []);
    } catch (e) {
      setCatalogSearchResults([]);
      setCatalogSearchError(e.message || 'Catalog search failed');
    } finally {
      setCatalogSearchLoading(false);
    }
  }, [catalogSearchQuery]);

  const saveRequirementScope = useCallback(async () => {
    if (!selectedApp?.id) {
      return;
    }
    setScopeSaving(true);
    setScopeError('');
    setScopeNotice('');
    try {
      const uniqueIds = Array.from(new Set(scopedRequirementIds));
      const result = await api.setApplicationRequirements(selectedApp.id, uniqueIds);
      setScopeNotice(`Saved scope with ${result.selected_count} requirement(s)`);
      await loadRequirementScope();
    } catch (e) {
      setScopeError(e.message || 'Failed to save application requirement scope');
    } finally {
      setScopeSaving(false);
    }
  }, [loadRequirementScope, scopedRequirementIds, selectedApp?.id]);

  async function openRequirementDetailModal(row) {
    const requirementIdRaw = String(row?.requirement_id || '').trim();
    let resolvedRequirementId = isUuidLike(requirementIdRaw) ? requirementIdRaw : '';
    if (!resolvedRequirementId) {
      const rowMetric = String(row?.metric_name || '').trim().toLowerCase();
      const rowControl = String(row?.control_title || '').trim().toLowerCase();
      const rowRequirement = String(row?.requirement_title || '').trim().toLowerCase();
      const candidate = interpretationRequirements.find((item) => {
        const linked = Array.isArray(item?.linked_controls) ? item.linked_controls : [];
        const metricMatch = linked.some((ctrl) => String(ctrl?.metric_name || '').trim().toLowerCase() === rowMetric);
        const controlMatch = linked.some((ctrl) => String(ctrl?.title || '').trim().toLowerCase() === rowControl);
        const requirementMatch = String(item?.title || '').trim().toLowerCase() === rowRequirement;
        return metricMatch || controlMatch || requirementMatch;
      });
      if (candidate && isUuidLike(candidate.id)) {
        resolvedRequirementId = String(candidate.id);
      }
    }
    const fallbackDetail = {
      id: resolvedRequirementId || requirementIdRaw || null,
      title: row?.requirement_title || 'Requirement',
      description: row?.requirement_description || '',
      category: STEP_DEFS.find((item) => item.num === activeStep)?.label || null,
      regulation_title: row?.regulation_title || null,
      jurisdiction: row?.jurisdiction || null,
      policy_source: row?.policy_source || null,
      policy_type: row?.policy_type || null,
      policy_status: row?.policy_status || null,
      code: row?.requirement_code || null,
      control_title: row?.control_title || null,
      metric_name: row?.metric_name || null,
      metric_definition: row?.metric_definition || (row?.threshold?.formula || null),
      interpretation_text: row?.interpretation_text || null,
      threshold: row?.threshold || null,
    };
    setRequirementDetailError('');
    setRequirementDetailLoading(true);
    setRequirementDetailModal({ row, detail: fallbackDetail });
    if (!isUuidLike(resolvedRequirementId)) {
      setRequirementDetailLoading(false);
      return;
    }
    try {
      const detail = await api.getRequirement(resolvedRequirementId);
      setRequirementDetailModal((prev) => ({
        row,
        detail: {
          ...fallbackDetail,
          ...(prev?.detail || {}),
          ...detail,
        },
      }));
    } catch (e) {
      setRequirementDetailError(e.message || 'Failed to load full requirement detail.');
    } finally {
      setRequirementDetailLoading(false);
    }
  }

  function closeRequirementDetailModal() {
    if (requirementDetailLoading) return;
    setRequirementDetailModal(null);
    setRequirementDetailError('');
  }

  function renderRequirementDetailModal() {
    if (!requirementDetailModal) {
      return null;
    }
    return (
      <div
        className="catalog-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Requirement detail"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeRequirementDetailModal();
        }}
      >
        <div className="catalog-modal catalog-animate-enter" style={{ width: 'min(760px, 100%)' }}>
          <div className="catalog-modal-header">
            <div className="catalog-modal-heading">
              <h3>Requirement Detail</h3>
              <p>{requirementDetailModal?.detail?.title || 'Requirement'}</p>
            </div>
          </div>
          <div className="catalog-modal-section catalog-modal-mini-section" style={{ marginTop: 0 }}>
            {requirementDetailLoading ? (
              <p className="catalog-modal-helper-text" style={{ margin: 0 }}>
                Loading requirement detail...
              </p>
            ) : null}
            {requirementDetailError ? (
              <div className="alert alert-danger" style={{ marginBottom: '0.55rem' }}>
                {requirementDetailError}
              </div>
            ) : null}
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <div style={{ display: 'grid', gap: '0.15rem' }}>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Requirement Title</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{requirementDetailModal?.detail?.title || '-'}</div>
              </div>
              <div style={{ display: 'grid', gap: '0.15rem' }}>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Requirement Description</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  {requirementDetailModal?.detail?.description || 'No requirement description available.'}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.45rem' }}>
                <div>
                  <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Regulation</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)' }}>{requirementDetailModal?.detail?.regulation_title || '-'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Jurisdiction</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)' }}>{requirementDetailModal?.detail?.jurisdiction || '-'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Control</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)' }}>{requirementDetailModal?.detail?.control_title || '-'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Metric</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)' }}>{requirementDetailModal?.detail?.metric_name || '-'}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.45rem' }}>
                <div>
                  <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Policy Source</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)' }}>{requirementDetailModal?.detail?.policy_source || '-'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Policy Type</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)' }}>{requirementDetailModal?.detail?.policy_type || '-'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Policy Status</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-primary)' }}>{requirementDetailModal?.detail?.policy_status || '-'}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gap: '0.15rem' }}>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Metric Definition</div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {requirementDetailModal?.detail?.metric_definition || 'No metric definition text available.'}
                </div>
              </div>
              <div style={{ display: 'grid', gap: '0.15rem' }}>
                <div style={{ fontSize: '0.69rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Interpretation</div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {requirementDetailModal?.detail?.interpretation_text || 'No interpretation text available.'}
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.45rem', marginTop: '0.65rem' }}>
            <button type="button" className="btn-secondary" onClick={closeRequirementDetailModal} disabled={requirementDetailLoading}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  function openRemoveRequirementModal(row) {
    const requirementId = String(row?.requirement_id || '').trim();
    const rowKey = buildDashboardRowKey(row);
    if (!rowKey) {
      setRowActionError('This row cannot be removed because its row key is missing.');
      return;
    }
    const scopeItem = requirementId ? requirementScopeById.get(requirementId) : null;
    const isScopeRemove = Boolean(requirementId && scopeItem?.selected && !scopeItem?.is_default);
    setRowActionError('');
    setRowActionNotice('');
    setRemoveRequirementModal({
      mode: isScopeRemove ? 'scope' : 'view',
      rowKey,
      requirementId: requirementId || null,
      requirementTitle: row?.requirement_title || scopeItem?.title || 'Requirement',
      controlTitle: row?.control_title || 'Control',
    });
  }

  function closeRemoveRequirementModal() {
    if (removingRequirement) return;
    setRemoveRequirementModal(null);
  }

  async function confirmRemoveRequirement() {
    if (!selectedApp?.id || !removeRequirementModal) {
      return;
    }
    if (removeRequirementModal.mode === 'view') {
      const rowKey = String(removeRequirementModal.rowKey || '').trim();
      if (!rowKey) {
        setRowActionError('Unable to remove this row because its view key is missing.');
        return;
      }
      const nextKeys = new Set(hiddenRequirementRowKeys);
      nextKeys.add(rowKey);
      setHiddenRequirementRowKeys(nextKeys);
      persistHiddenRequirementRows(selectedApp.id, Array.from(nextKeys));
      setRemoveRequirementModal(null);
      setRowActionError('');
      setRowActionNotice('Requirement removed from Governance detail view.');
      return;
    }
    if (!removeRequirementModal.requirementId) {
      setRowActionError('This requirement cannot be removed from app scope because requirement_id is missing.');
      return;
    }
    setRemovingRequirement(true);
    setRowActionError('');
    setRowActionNotice('');
    try {
      const payload = await api.getApplicationRequirements(selectedApp.id, 'limit=500');
      const scopeItems = Array.isArray(payload?.items) ? payload.items : [];
      const selectedIds = scopeItems
        .filter((item) => Boolean(item?.selected))
        .map((item) => String(item?.requirement_id || '').trim())
        .filter(Boolean);
      const targetId = String(removeRequirementModal.requirementId);
      const targetScopeItem = scopeItems.find((item) => String(item?.requirement_id || '').trim() === targetId);
      if (targetScopeItem?.is_default) {
        setRowActionError('Baseline requirements cannot be removed from Governance view.');
        return;
      }
      if (!targetScopeItem?.selected) {
        setRowActionError('This requirement is not assigned to the selected application scope.');
        return;
      }
      const nextIds = selectedIds.filter((id) => id !== targetId);
      await api.setApplicationRequirements(selectedApp.id, nextIds);
      consumeNewRequirementMarkers(selectedApp.id, [targetId]);
      setNewRequirementIds((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
      setScopedRequirementIds((prev) => prev.filter((id) => id !== targetId));
      setRemoveRequirementModal(null);
      setRowActionNotice('Requirement removed from this application dashboard scope.');
      await loadRequirementScope();
      const refreshedSteps = await Promise.allSettled(
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((stepNum) => api.getApplicationDashboardStep(selectedApp.id, stepNum))
      );
      const updates = {};
      refreshedSteps.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          updates[`dashboardStep${index + 1}`] = result.value;
        }
      });
      if (Object.keys(updates).length > 0) {
        setDetailCache((prev) => ({ ...prev, ...updates }));
      }
    } catch (e) {
      setRowActionError(e.message || 'Failed to remove requirement from governance scope.');
    } finally {
      setRemovingRequirement(false);
    }
  }

  const loadStepDetail = useCallback(async (stepNum) => {
    setActiveStep(stepNum);
    setStepDetailError('');

    if (!selectedApp?.id || (stepNum !== 1 && stepNum !== 2 && stepNum !== 3 && stepNum !== 4 && stepNum !== 5 && stepNum !== 6 && stepNum !== 7 && stepNum !== 8 && stepNum !== 9)) {
      return;
    }

    // Always refresh step rows on selection so newly ingested telemetry appears immediately.

    setLoadingStepDetail(true);
    try {
      if (!interpretationRequirements.length) {
        await loadRequirementScope();
      }
      const markerIds = selectedApp?.id ? loadNewRequirementMarkers(selectedApp.id) : new Set();
      if (selectedApp?.id) {
        setNewRequirementIds(markerIds);
      }
      const applyDashboardStep = (stepValue, dashboardStep) => {
        setDetailCache((prev) => ({ ...prev, [`dashboardStep${stepValue}`]: dashboardStep }));
        if (selectedApp?.id && markerIds.size > 0) {
          const seenIds = (Array.isArray(dashboardStep?.rows) ? dashboardStep.rows : [])
            .map((row) => String(row?.requirement_id || '').trim())
            .filter((id) => id && markerIds.has(id));
          if (seenIds.length > 0) {
            consumeNewRequirementMarkers(selectedApp.id, seenIds);
          }
        }
      };

      if (stepNum === 1) {
        const dashboardStep = await api.getApplicationDashboardStep(selectedApp.id, 1);
        applyDashboardStep(1, dashboardStep);
      } else if (stepNum === 2) {
        const failed = [];
        await loadRequirementScope();
        try {
          const dashboardStep = await api.getApplicationDashboardStep(selectedApp.id, 2);
          applyDashboardStep(2, dashboardStep);
        } catch {
          failed.push('dashboard_step_2');
        }
        if (!detailCache.history) {
          try {
            const history = await api.getTierHistory(selectedApp.id);
            setDetailCache((prev) => ({ ...prev, history }));
          } catch {
            failed.push('tier_history');
          }
        }
        if (!detailCache.recommendations) {
          try {
            const recommendations = await api.getRecommendations(selectedApp.id);
            setDetailCache((prev) => ({ ...prev, recommendations }));
          } catch {
            failed.push('recommendations');
          }
        }
        if (!detailCache.benchmarks) {
          try {
            const benchmarks = await api.getBenchmarks(selectedApp.id);
            setDetailCache((prev) => ({ ...prev, benchmarks }));
          } catch {
            failed.push('benchmarks');
          }
        }
        if (failed.length > 0) {
          setStepDetailError(`Some step 2 data is unavailable: ${failed.join(', ')}`);
        }
      } else if (stepNum === 3) {
        const dashboardStep = await api.getApplicationDashboardStep(selectedApp.id, 3);
        applyDashboardStep(3, dashboardStep);
      } else if (stepNum === 4) {
        const dashboardStep = await api.getApplicationDashboardStep(selectedApp.id, 4);
        applyDashboardStep(4, dashboardStep);
      } else if (stepNum === 5) {
        const dashboardStep = await api.getApplicationDashboardStep(selectedApp.id, 5);
        applyDashboardStep(5, dashboardStep);
      } else if (stepNum === 6) {
        const dashboardStep = await api.getApplicationDashboardStep(selectedApp.id, 6);
        applyDashboardStep(6, dashboardStep);
      } else if (stepNum === 7) {
        const dashboardStep = await api.getApplicationDashboardStep(selectedApp.id, 7);
        applyDashboardStep(7, dashboardStep);
      } else if (stepNum === 8) {
        const dashboardStep = await api.getApplicationDashboardStep(selectedApp.id, 8);
        applyDashboardStep(8, dashboardStep);
      } else if (stepNum === 9) {
        const dashboardStep = await api.getApplicationDashboardStep(selectedApp.id, 9);
        applyDashboardStep(9, dashboardStep);
      }
    } catch (e) {
      setStepDetailError(e.message || 'Failed to load step detail');
    } finally {
      setLoadingStepDetail(false);
    }
  }, [detailCache.benchmarks, detailCache.dashboardStep9, detailCache.dashboardStep8, detailCache.dashboardStep7, detailCache.dashboardStep6, detailCache.dashboardStep5, detailCache.dashboardStep4, detailCache.dashboardStep3, detailCache.dashboardStep2, detailCache.dashboardStep1, detailCache.history, detailCache.recommendations, interpretationRequirements.length, loadRequirementScope, selectedApp?.id]);

  const refreshDashboardStepRows = useCallback(async (stepNum) => {
    if (!selectedApp?.id) {
      return;
    }
    const safeStep = Number(stepNum);
    if (!Number.isFinite(safeStep) || safeStep < 1 || safeStep > 9) {
      return;
    }
    const dashboardStep = await api.getApplicationDashboardStep(selectedApp.id, safeStep);
    setDetailCache((prev) => ({ ...prev, [`dashboardStep${safeStep}`]: dashboardStep }));
  }, [selectedApp?.id]);

  const setManualKpiValue = useCallback(async (row, nextValue, stepNum = 1) => {
    if (!selectedApp?.id) {
      return;
    }
    const controlId = String(row?.control_id || '').trim();
    const metricName = String(row?.metric_name || '').trim();
    const rowKey = buildDashboardRowKey(row);
    if (!controlId || !metricName || !rowKey) {
      setRowActionError('Manual KPI update failed because row identifiers are missing.');
      return;
    }

    const payload = {
      control_id: controlId,
      metric_name: metricName,
      value: nextValue,
      set_by: selectedApp?.owner_email || 'application_owner',
    };

    const requirementId = String(row?.requirement_id || '').trim();
    if (isUuidLike(requirementId)) {
      payload.requirement_id = requirementId;
    }

    setRowActionError('');
    setRowActionNotice('');
    setManualKpiSavingRowKeys((prev) => {
      const next = new Set(prev);
      next.add(rowKey);
      return next;
    });

    try {
      await api.setApplicationManualKpiValue(selectedApp.id, payload);
      await refreshDashboardStepRows(stepNum);
      setRowActionNotice(nextValue >= 100 ? 'Manual KPI marked Completed.' : 'Manual KPI marked Pending.');
    } catch (e) {
      setRowActionError(e.message || 'Failed to update manual KPI value.');
    } finally {
      setManualKpiSavingRowKeys((prev) => {
        const next = new Set(prev);
        next.delete(rowKey);
        return next;
      });
    }
  }, [refreshDashboardStepRows, selectedApp?.id, selectedApp?.owner_email]);
  useEffect(() => {
    if (!requestedStep?.stepNum) {
      return;
    }
    loadStepDetail(requestedStep.stepNum);
    setTimeout(() => detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }, [requestedStep?.token]);

  useEffect(() => {
    if (!selectedApp?.id || !activeStep) {
      return undefined;
    }
    const liveSteps = new Set([1, 3, 4, 5, 6, 7, 8, 9]);
    if (!liveSteps.has(activeStep)) {
      return undefined;
    }

    const handle = setInterval(() => {
      loadStepDetail(activeStep);
    }, 15000);

    return () => clearInterval(handle);
  }, [activeStep, loadStepDetail, selectedApp?.id]);


  useEffect(() => {
    if (activeStep !== 2 || !interpretationDraft.requirementId) {
      return;
    }
    loadInterpretationRows(interpretationDraft.requirementId);
  }, [activeStep, interpretationDraft.requirementId, loadInterpretationRows]);

  useEffect(() => {
    if (activeStep !== 2) {
      return;
    }
    if (!interpretationRequirementOptions.some((item) => item.id === interpretationDraft.requirementId)) {
      const nextRequirementId = interpretationRequirementOptions[0]?.id || '';
      setInterpretationDraft((prev) => ({
        ...prev,
        requirementId: nextRequirementId,
        controlId: resolveDefaultControlId(nextRequirementId, interpretationRequirements, prev.controlId),
      }));
      return;
    }
    if (!interpretationControlOptions.some((item) => item.id === interpretationDraft.controlId)) {
      setInterpretationDraft((prev) => ({
        ...prev,
        controlId: resolveDefaultControlId(prev.requirementId, interpretationRequirements, prev.controlId),
      }));
    }
  }, [
    activeStep,
    interpretationControlOptions,
    interpretationDraft.controlId,
    interpretationDraft.requirementId,
    interpretationRequirementOptions,
    interpretationRequirements,
  ]);

  const submitInterpretation = useCallback(async (event) => {
    event.preventDefault();
    if (!selectedApp?.id) {
      return;
    }
    const requirementId = interpretationDraft.requirementId;
    const controlId = interpretationDraft.controlId;
    const content = interpretationDraft.content.trim();
    const { thresholdOverride, validationError } = buildThresholdOverrideFromDraft(interpretationDraft);
    const existingRow = interpretationRows.find(
      (row) => row.requirement_id === requirementId && row.control_id === controlId
    );
    if (!requirementId) {
      setInterpretationError('Select a requirement before submitting an interpretation');
      return;
    }
    if (!controlId) {
      setInterpretationError('Select a linked control before submitting an interpretation');
      return;
    }
    if (validationError) {
      setInterpretationError(validationError);
      return;
    }
    if (!content && !thresholdOverride) {
      setInterpretationError('Provide interpretation text or enable threshold override.');
      return;
    }
    if (!content && thresholdOverride && !existingRow) {
      setInterpretationError('First save for this requirement/control needs interpretation text.');
      return;
    }

    setInterpretationSaving(true);
    setInterpretationError('');
    setInterpretationNotice('');
    try {
      const actor = selectedApp.owner_email || 'application_owner';
      let saved;
      if (!content && thresholdOverride && existingRow) {
        saved = await api.patchApplicationInterpretation(selectedApp.id, existingRow.id, {
          threshold_override: thresholdOverride,
          set_by: actor,
        });
      } else {
        saved = await api.createApplicationInterpretation(selectedApp.id, {
          requirement_id: requirementId,
          control_id: controlId,
          interpretation_text: content || null,
          threshold_override: thresholdOverride,
          set_by: actor,
        });
      }

      setInterpretationDraft((prev) => ({
        ...prev,
        content: '',
        thresholdEnabled: false,
        thresholdOperator: 'lte',
        thresholdValue: '',
        thresholdMin: '',
        thresholdMax: '',
      }));
      setInterpretationNotice(
        thresholdOverride
          ? `Saved interpretation + threshold override for ${saved.control_code || saved.control_id}`
          : `Saved interpretation for ${saved.control_code || saved.control_id}`
      );
      await loadInterpretationRows(requirementId);
    } catch (e) {
      setInterpretationError(e.message || 'Failed to create interpretation');
    } finally {
      setInterpretationSaving(false);
    }
  }, [interpretationDraft, interpretationRows, loadInterpretationRows, selectedApp?.id, selectedApp?.owner_email]);

  const fmtNum = useCallback((value, digits = 3) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 'N/A';
    }
    return value.toFixed(digits);
  }, []);

  const fmtDateTime = useCallback((value) => {
    if (!value) {
      return 'N/A';
    }
    return new Date(value).toLocaleString();
  }, []);

  const stepRows = useMemo(() => {
    const telemetryReadings = snapshot.telemetry?.total_readings || 0;
    const hasCompliance = Boolean(snapshot.compliance);
    const hasTier = Boolean(snapshot.tier);

    return STEP_DEFS.map((step) => {
      if (step.num === 1) {
        if (selectedApp) {
          const oversightRows = filterVisibleRows(buildCorporateOversightRows(
            selectedApp,
            snapshot,
            detailCache.dashboardStep1?.summary,
            detailCache.dashboardStep1?.rows
          ));
          const fail = oversightRows.filter((row) => row.result === 'FAIL').length;
          return {
            ...step,
            status: oversightRows.length ? 'complete' : 'attention',
            note: `Corporate KPIs: ${oversightRows.length} | fail: ${fail}`,
          };
        }
        return { ...step, status: 'pending', note: 'No selected app' };
      }
      if (step.num === 2) {
        const scoped = scopedRequirementIds.length;
        if (detailCache.dashboardStep2) {
          const visibleRows = filterVisibleRows(detailCache.dashboardStep2.rows || []);
          const total = visibleRows.length;
          const fail = visibleRows.filter((r) => r.result === 'FAIL').length;
          return {
            ...step,
            status: total > 0 ? 'complete' : 'attention',
            note: `Baseline KPIs: ${total} | fail: ${fail} | scoped reqs: ${scoped}`,
          };
        }
        return {
          ...step,
          status: hasTier ? 'attention' : 'pending',
          note: hasTier
            ? `Tier assigned: ${normalizeRiskTier(snapshot.tier.current_tier) || snapshot.tier.current_tier} | scoped reqs: ${scoped}`
            : 'Tier unavailable',
        };
      }
      if (step.num === 3) {
        if (detailCache.dashboardStep3) {
          const visibleRows = filterVisibleRows(detailCache.dashboardStep3.rows || []);
          const total = visibleRows.length;
          const fail = visibleRows.filter((r) => r.result === 'FAIL').length;
          return {
            ...step,
            status: total > 0 ? 'complete' : 'attention',
            note: `Rows: ${total} | fail: ${fail}`,
          };
        }
        return {
          ...step,
          status: hasTier ? 'attention' : 'pending',
          note: hasTier ? 'Click row to load technical architecture KPIs' : 'Requires tier assignment first',
        };
      }
      if (step.num === 4) {
        if (detailCache.dashboardStep4) {
          const visibleRows = filterVisibleRows(detailCache.dashboardStep4.rows || []);
          const total = visibleRows.length;
          const pass = visibleRows.filter((r) => r.result === 'PASS').length;
          return {
            ...step,
            status: total > 0 ? 'complete' : 'attention',
            note: `Rows: ${total} | pass: ${pass}`,
          };
        }
        return {
          ...step,
          status: hasCompliance ? 'attention' : 'pending',
          note: hasCompliance ? 'Click row to load data-readiness KPIs' : 'Compliance summary required first',
        };
      }
      if (step.num === 5) {
        if (detailCache.dashboardStep5) {
          const visibleRows = filterVisibleRows(detailCache.dashboardStep5.rows || []);
          const total = visibleRows.length;
          const fail = visibleRows.filter((r) => r.result === 'FAIL').length;
          return {
            ...step,
            status: total > 0 ? 'complete' : 'attention',
            note: `Rows: ${total} | fail: ${fail}`,
          };
        }
        return {
          ...step,
          status: hasTier ? 'attention' : 'pending',
          note: hasTier ? 'Click row to load data-integration KPIs' : 'Requires tier assignment first',
        };
      }
      if (step.num === 6) {
        if (detailCache.dashboardStep6) {
          const visibleRows = filterVisibleRows(detailCache.dashboardStep6.rows || []);
          const total = visibleRows.length;
          const fail = visibleRows.filter((r) => r.result === 'FAIL').length;
          return {
            ...step,
            status: total > 0 ? 'complete' : 'attention',
            note: `Rows: ${total} | fail: ${fail}`,
          };
        }
        return {
          ...step,
          status: hasTier ? 'attention' : 'pending',
          note: hasTier ? 'Click row to load security KPIs' : 'Requires tier assignment first',
        };
      }
      if (step.num === 7) {
        if (detailCache.dashboardStep7) {
          const visibleRows = filterVisibleRows(detailCache.dashboardStep7.rows || []);
          const total = visibleRows.length;
          const fail = visibleRows.filter((r) => r.result === 'FAIL').length;
          return {
            ...step,
            status: total > 0 ? 'complete' : 'attention',
            note: `Rows: ${total} | fail: ${fail}`,
          };
        }
        return {
          ...step,
          status: hasTier ? 'attention' : 'pending',
          note: hasTier ? 'Click row to load infrastructure KPIs' : 'Requires tier assignment first',
        };
      }
      if (step.num === 8) {
        if (detailCache.dashboardStep8) {
          const visibleRows = filterVisibleRows(detailCache.dashboardStep8.rows || []);
          const total = visibleRows.length;
          const fail = visibleRows.filter((r) => r.result === 'FAIL').length;
          return {
            ...step,
            status: total > 0 ? 'complete' : 'attention',
            note: `Rows: ${total} | fail: ${fail}`,
          };
        }
        return {
          ...step,
          status: hasTier ? 'attention' : 'pending',
          note: hasTier ? 'Click row to load solution-design KPIs' : 'Requires tier assignment first',
        };
      }
      if (step.num === 9) {
        if (detailCache.dashboardStep9) {
          const visibleRows = filterVisibleRows(detailCache.dashboardStep9.rows || []);
          const total = visibleRows.length;
          const fail = visibleRows.filter((r) => r.result === 'FAIL').length;
          return {
            ...step,
            status: total > 0 ? 'complete' : 'attention',
            note: `Rows: ${total} | fail: ${fail}`,
          };
        }
        return {
          ...step,
          status: hasTier ? 'attention' : 'pending',
          note: hasTier ? 'Click row to load system-performance KPIs' : 'Requires tier assignment first',
        };
      }
      return { ...step, status: 'pending', note: 'Panel wiring next increment' };
    });
  }, [detailCache.benchmarks, detailCache.dashboardStep9, detailCache.dashboardStep8, detailCache.dashboardStep7, detailCache.dashboardStep6, detailCache.dashboardStep5, detailCache.dashboardStep4, detailCache.dashboardStep3, detailCache.dashboardStep2, detailCache.dashboardStep1, detailCache.dashboardStep1?.rows, detailCache.history, detailCache.recommendations, filterVisibleRows, scopedRequirementIds.length, selectedApp, snapshot]);

  const totalKpis = useMemo(() => {
    if (!selectedApp) {
      return null;
    }
    const step1Count = filterVisibleRows(buildCorporateOversightRows(
      selectedApp,
      snapshot,
      detailCache.dashboardStep1?.summary,
      detailCache.dashboardStep1?.rows
    )).length;
    const stepCounts = [2, 3, 4, 5, 6, 7, 8, 9]
      .map((stepNum) => {
        const rows = detailCache[`dashboardStep${stepNum}`]?.rows || [];
        return filterVisibleRows(rows).length;
      })
      .reduce((sum, count) => sum + count, 0);
    return step1Count + stepCounts;
  }, [
    detailCache.dashboardStep1?.summary,
    detailCache.dashboardStep1?.rows,
    detailCache.dashboardStep2?.row_count,
    detailCache.dashboardStep3?.row_count,
    detailCache.dashboardStep4?.row_count,
    detailCache.dashboardStep5?.row_count,
    detailCache.dashboardStep6?.row_count,
    detailCache.dashboardStep7?.row_count,
    detailCache.dashboardStep8?.row_count,
    detailCache.dashboardStep9?.row_count,
    selectedApp,
    filterVisibleRows,
    snapshot,
  ]);

  const complianceSummary = useMemo(() => {
    if (!selectedApp) {
      return null;
    }

    const step1Rows = filterVisibleRows(buildCorporateOversightRows(
      selectedApp,
      snapshot,
      detailCache.dashboardStep1?.summary,
      detailCache.dashboardStep1?.rows
    ));
    const step2Rows = filterVisibleRows(detailCache.dashboardStep2?.rows || []);
    const step3Rows = filterVisibleRows(detailCache.dashboardStep3?.rows || []);
    const step4Rows = filterVisibleRows(detailCache.dashboardStep4?.rows || []);
    const step5Rows = filterVisibleRows(detailCache.dashboardStep5?.rows || []);
    const step6Rows = filterVisibleRows(detailCache.dashboardStep6?.rows || []);
    const step7Rows = filterVisibleRows(detailCache.dashboardStep7?.rows || []);
    const step8Rows = filterVisibleRows(detailCache.dashboardStep8?.rows || []);
    const step9Rows = filterVisibleRows(detailCache.dashboardStep9?.rows || []);
    const scopedRows = [
      ...step2Rows,
      ...step3Rows,
      ...step4Rows,
      ...step5Rows,
      ...step6Rows,
      ...step7Rows,
      ...step8Rows,
      ...step9Rows,
    ];
    const allRows = [...step1Rows, ...scopedRows];

    const evaluated = allRows.filter((row) => {
      const status = row.display_result || row.result;
      return status === 'PASS' || status === 'FAIL';
    }).length;
    const passCount = allRows.filter((row) => (row.display_result || row.result) === 'PASS').length;
    const failCount = allRows.filter((row) => (row.display_result || row.result) === 'FAIL').length;
    const noDataCount = allRows.filter((row) => (row.display_result || row.result) === 'INSUFFICIENT_DATA').length;
    const overallPassRate = evaluated > 0 ? (passCount / evaluated) : null;
    const categoryCompliancePct = {
      1: computeCategoryCompliancePct(step1Rows),
      2: computeCategoryCompliancePct(step2Rows),
      3: computeCategoryCompliancePct(step3Rows),
      4: computeCategoryCompliancePct(step4Rows),
      5: computeCategoryCompliancePct(step5Rows),
      6: computeCategoryCompliancePct(step6Rows),
      7: computeCategoryCompliancePct(step7Rows),
      8: computeCategoryCompliancePct(step8Rows),
      9: computeCategoryCompliancePct(step9Rows),
    };
    const categoryAverageCompliancePct = Math.round(
      Object.values(categoryCompliancePct).reduce((sum, value) => sum + value, 0) / 9
    );
    const derivedRiskTier = deriveRiskTierFromComplianceScore(categoryAverageCompliancePct);

    return {
      overall_pass_rate: overallPassRate,
      evaluated_count: evaluated,
      pass_count: passCount,
      fail_count: failCount,
      no_data_count: noDataCount,
      step1_fail_count: step1Rows.filter((row) => row.result === 'FAIL').length,
      step1_total: step1Rows.length,
      step2_total: step2Rows.length,
      step2_pass_rate: toRatio(snapshot?.compliance?.pass_rate),
      category_compliance_pct: categoryCompliancePct,
      combined_category_avg_pct: categoryAverageCompliancePct,
      derived_risk_tier: derivedRiskTier,
    };
  }, [
    detailCache.dashboardStep1?.summary,
    detailCache.dashboardStep1?.rows,
    detailCache.dashboardStep2?.row_count,
    detailCache.dashboardStep2?.rows,
    detailCache.dashboardStep3?.rows,
    detailCache.dashboardStep4?.rows,
    detailCache.dashboardStep5?.rows,
    detailCache.dashboardStep6?.rows,
    detailCache.dashboardStep7?.rows,
    detailCache.dashboardStep8?.rows,
    detailCache.dashboardStep9?.rows,
    filterVisibleRows,
    selectedApp,
    snapshot,
  ]);

  useEffect(() => {
    if (!onDashboardUiChange) {
      return;
    }
    onDashboardUiChange({
      activeStep,
      stepRows,
      snapshot,
      loading,
      error,
      selectedAppId: selectedApp?.id || null,
      totalKpis,
      complianceSummary,
      activeControlByCategory: Array.isArray(systemOverview?.activeControlByCategory)
        ? systemOverview.activeControlByCategory
        : [],
      systemSnapshot: {
        connectedApps: Number(systemOverview?.connectedApps || 0),
        enterpriseRequirements: Number(systemOverview?.totalBaselineRequirements || 0),
        policyTypes: Array.isArray(systemOverview?.policyTypes) ? systemOverview.policyTypes : [],
      },
      recentRequirementTicker: Array.isArray(systemOverview?.recentRequirementTicker)
        ? systemOverview.recentRequirementTicker
        : [],
    });
  }, [
    activeStep,
    complianceSummary,
    error,
    loading,
    onDashboardUiChange,
    selectedApp?.id,
    snapshot,
    stepRows,
    totalKpis,
    systemOverview?.activeControlByCategory,
    systemOverview?.connectedApps,
    systemOverview?.totalBaselineRequirements,
    systemOverview?.policyTypes,
    systemOverview?.recentRequirementTicker,
  ]);

  if (!selectedApp && mode !== 'home') {
    return (
      <div className="card" style={{ padding: '1rem 1.25rem' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          No connected application selected. Use the Connected App selector in the Governance sidebar.
        </p>
      </div>
    );
  }

  if (mode === 'home' || !selectedApp) {
    return (
      <div className="system-frontpage">
        {overviewLoading && (
          <p className="system-frontpage-note">Loading system-wide governance overview...</p>
        )}
        {overviewError && (
          <div className="alert alert-warning" style={{ marginTop: '0.2rem' }}>
            {overviewError}
          </div>
        )}
        <div className="card system-frontpage-panel" style={{ minHeight: '200px', display: 'grid', placeItems: 'center' }}>
          <div className="system-frontpage-muted">
            Home workspace ready for main dashboard content.
          </div>
        </div>

        {renderRequirementDetailModal()}

      </div>
    );
  }

  return (
    <div>
      {error && <div className="alert alert-warning">{error}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {!activeStep && (
          <div style={{ padding: '1rem 1.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Select a step from the left menu to view details.
          </div>
        )}

        {activeStep && (
          <div ref={detailSectionRef} style={{ borderTop: '1px solid var(--border)', padding: '1rem 1.25rem' }}>
            <div className="governance-breadcrumb" aria-label="Governance category flow">
              <div className="governance-mini-flow" role="navigation" aria-label="Governance category sequence">
                {STEP_DEFS.map((step, idx) => (
                  <div className="governance-mini-segment" key={`gov-breadcrumb-${step.num}`}>
                    {idx > 0 ? <span className="governance-mini-link" /> : <span className="governance-mini-link is-hidden" />}
                    <button
                      type="button"
                      onClick={() => loadStepDetail(step.num)}
                      className={`governance-mini-node${activeStep === step.num ? ' active' : ''}`}
                      title={`${step.num}. ${step.label}`}
                      aria-current={activeStep === step.num ? 'step' : undefined}
                      aria-label={`Go to Step ${step.num}: ${step.label}`}
                    >
                      {step.num}
                    </button>
                  </div>
                ))}
              </div>
              <div className="governance-mini-caption">
                Step {activeStep}: {STEP_DEFS.find((step) => step.num === activeStep)?.label || 'Governance'}
              </div>
            </div>

            {loadingStepDetail && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>
                Loading detail...
              </div>
            )}

            {stepDetailError && (
              <div className="alert alert-danger" style={{ marginBottom: 0 }}>
                {stepDetailError}
              </div>
            )}

            {rowActionNotice ? (
              <div className="alert alert-success" style={{ marginBottom: 0 }}>
                {rowActionNotice}
              </div>
            ) : null}
            {rowActionError ? (
              <div className="alert alert-danger" style={{ marginBottom: 0 }}>
                {rowActionError}
              </div>
            ) : null}

            {!loadingStepDetail && !stepDetailError && activeStep !== 1 && (
              <StepBasicPanel
                activeStep={activeStep}
                selectedApp={selectedApp}
                snapshot={snapshot}
                fmtDateTime={fmtDateTime}
                fmtNum={fmtNum}
              />
            )}

            {!loadingStepDetail && !stepDetailError && activeStep === 1 && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                <div className="card card-flat">
                  {(() => {
                    const corporateRows = filterVisibleRows(buildCorporateOversightRows(
                      selectedApp,
                      snapshot,
                      detailCache.dashboardStep1?.summary,
                      detailCache.dashboardStep1?.rows
                    ));
                    const prioritizedRows = [...corporateRows].sort((a, b) => {
                      const aHasValue = typeof a?.value === 'number' && !Number.isNaN(a.value);
                      const bHasValue = typeof b?.value === 'number' && !Number.isNaN(b.value);
                      if (aHasValue !== bHasValue) {
                        return aHasValue ? -1 : 1;
                      }
                      return 0;
                    });
                    const { baselineRows, applicationSpecificRows: appSpecificRows } = splitRowsByRequirementType(prioritizedRows);
                    const visibleRows = corporateRequirementListView === 'application_specific'
                      ? appSpecificRows
                      : baselineRows;
                    const summarizeStep1Status = (row) => {
                      const status = String(row?.display_result || row?.result || '').toUpperCase();
                      const isManual = status === 'MANUAL' || Boolean(row?.is_manual);
                      if (isManual) {
                        return typeof row?.value === 'number' && row.value >= 100 ? 'PASS' : 'FAIL';
                      }
                      if (status === 'PASS' || status === 'FAIL') {
                        return status;
                      }
                      return 'INSUFFICIENT_DATA';
                    };
                    const step1Counts = visibleRows.reduce((acc, row) => {
                      const normalized = summarizeStep1Status(row);
                      if (normalized === 'PASS') acc.pass += 1;
                      else if (normalized === 'FAIL') acc.fail += 1;
                      else acc.noData += 1;
                      return acc;
                    }, { pass: 0, fail: 0, noData: 0 });
                    const categoryTotal = corporateRows.length;
                    const categoryCompleted = corporateRows.filter((row) => (
                      typeof row?.value === 'number' && !Number.isNaN(row.value) && row.value > 0
                    )).length;
                    const categoryCompliance = categoryTotal > 0
                      ? Math.round((categoryCompleted / categoryTotal) * 100)
                      : 0;
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span className="badge badge-unblue">
                              Compliance Score: {categoryCompliance}%
                            </span>
                            <span
                              title="Compliance Score for this governance category is calculated across Secretariat + Application Specific requirements. A requirement is counted as complete when Value is greater than 0 (or 0%). Missing value or 0 counts as incomplete."
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                border: '1px solid var(--border)',
                                fontSize: '0.66rem',
                                fontWeight: 700,
                                color: 'var(--text-secondary)',
                                background: 'var(--surface-2)',
                                flexShrink: 0,
                                cursor: 'help',
                              }}
                            >
                              i
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setCorporateRequirementListView('baseline')}
                              style={corporateRequirementListView === 'baseline'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Secretariat ({baselineRows.length})
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setCorporateRequirementListView('application_specific')}
                              style={corporateRequirementListView === 'application_specific'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Application Specific ({appSpecificRows.length})
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
                          <span className="badge badge-grey">Total: {corporateRows.length}</span>
                          <span className="badge badge-grey">Showing: {visibleRows.length}</span>
                          <span className="badge badge-red">
                            FAIL: {step1Counts.fail}
                          </span>
                          <span className="badge badge-yellow">
                            NO DATA: {step1Counts.noData}
                          </span>
                          <span className="badge badge-green">
                            PASS: {step1Counts.pass}
                          </span>
                        </div>

                        {visibleRows.length ? (
                          <div style={{ display: 'grid', gap: '0.55rem' }}>
                            {visibleRows.map((row, idx) => {
                              const metricMeta = getStep2MetricMeta(row.metric_name);
                              const valueSourceLegend = getStep1ValueSourceLegend(row);
                              const isManualRow = (row?.display_result || row?.result) === 'MANUAL' || Boolean(row?.is_manual);
                              const rowKey = buildDashboardRowKey(row);
                              const manualSaving = rowKey ? manualKpiSavingRowKeys.has(rowKey) : false;
                              const manualState = typeof row?.value === 'number' && row.value >= 100 ? 'completed' : 'pending';
                              const rowStatusClass = row.result === 'PASS'
                                ? 'badge-green'
                                : row.result === 'FAIL'
                                  ? 'badge-red'
                                  : 'badge-yellow';
                              return (
                                <div
                                  key={`step1-${row.metric_name}-${idx}`}
                                  style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: '0.65rem',
                                    background: 'var(--surface)',
                                    display: 'grid',
                                    gap: '0.55rem',
                                  }}
                                >
                                  {renderRequirementRowHeader(row, rowStatusClass, corporateRequirementListView === 'application_specific')}

                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.55rem' }}>
                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Measure
                                      </span>
                                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{metricMeta.label}</span>
                                      <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {metricMeta.measure}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Value
                                      </span>
                                      <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                                        {isManualRow
                                          ? (manualState === 'completed' ? 'Completed' : 'Pending')
                                          : getGovernanceRowValueLabel(row, corporateRequirementListView === 'application_specific')}
                                      </span>
                                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                        {isManualRow ? (
                                          <button
                                            type="button"
                                            className={`catalog-row-icon-action ${manualState === 'completed' ? 'is-status-active' : 'is-status-inactive'}`}
                                            onClick={() => setManualKpiValue(row, manualState === 'completed' ? 0 : 100, 1)}
                                            disabled={manualSaving}
                                            title={manualState === 'completed' ? 'Completed - click to set Pending' : 'Pending - click to set Completed'}
                                            aria-label={manualState === 'completed' ? 'Set manual KPI to Pending' : 'Set manual KPI to Completed'}
                                          >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                              <path d="M5 3v18" />
                                              <path d="M5 4h11l-2.5 4L16 12H5z" />
                                            </svg>
                                          </button>
                                        ) : null}
                                        <span
                                          title={valueSourceLegend}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            border: '1px solid var(--border)',
                                            fontSize: '0.66rem',
                                            fontWeight: 700,
                                            color: 'var(--text-secondary)',
                                            background: 'var(--surface-2)',
                                            flexShrink: 0,
                                          }}
                                        >
                                          i
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Interpretation
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {getStep2InterpretationText(row)}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Benchmark
                                      </span>
                                      {renderStep2BenchmarkInline(row)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                            No corporate oversight KPI rows returned yet.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {!loadingStepDetail && !stepDetailError && activeStep === 2 && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                <div className="card card-flat">
                  {(() => {
                    const mandatoryRows = filterVisibleRows(detailCache.dashboardStep2?.rows || []);
                    const prioritizedRows = [...mandatoryRows].sort((a, b) => {
                      const aHasValue = typeof a?.value === 'number' && !Number.isNaN(a.value);
                      const bHasValue = typeof b?.value === 'number' && !Number.isNaN(b.value);
                      if (aHasValue !== bHasValue) {
                        return aHasValue ? -1 : 1;
                      }
                      return 0;
                    });
                    const { baselineRows, applicationSpecificRows } = splitRowsByRequirementType(prioritizedRows);
                    const listView = stepRequirementListView[2] || 'baseline';
                    const visibleRows = listView === 'application_specific' ? applicationSpecificRows : baselineRows;
                    const stepStatusCounts = computeGovernanceStatusCounts(visibleRows);
                    const categoryCompliance = computeCategoryCompliancePct(baselineRows, applicationSpecificRows);
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 2: 'baseline' }))}
                              style={listView === 'baseline'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Secretariat ({baselineRows.length})
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 2: 'application_specific' }))}
                              style={listView === 'application_specific'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Application Specific ({applicationSpecificRows.length})
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.55rem' }}>
                          <span className="badge badge-unblue">Compliance Score: {categoryCompliance}%</span>
                          <span
                            title="Compliance Score for this governance category is calculated across Secretariat + Application Specific requirements. A requirement is counted as complete when Value is greater than 0 (or 0%). Missing value or 0 counts as incomplete."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: '1px solid var(--border)',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              color: 'var(--text-secondary)',
                              background: 'var(--surface-2)',
                              flexShrink: 0,
                              cursor: 'help',
                            }}
                          >
                            i
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                          <span className="badge badge-grey">
                            Risk Tier: {normalizeRiskTier(snapshot?.tier?.current_tier) || snapshot?.tier?.current_tier || 'N/A'}
                          </span>
                          <span className="badge badge-grey" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            Risk Score: {typeof snapshot?.tier?.raw_score === 'number' && !Number.isNaN(snapshot.tier.raw_score) ? Math.round(snapshot.tier.raw_score) : 'N/A'}
                            <span
                              title="Risk score combines weighted factors: deployment domain, decision impact, autonomy level, population breadth, affected populations, and observed likelihood."
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 14,
                                height: 14,
                                borderRadius: '50%',
                                border: '1px solid var(--border)',
                                fontSize: '0.62rem',
                                fontWeight: 700,
                                color: 'var(--text-secondary)',
                                background: 'var(--surface)',
                                cursor: 'help',
                              }}
                            >
                              i
                            </span>
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
                          <span className="badge badge-grey">Total: {mandatoryRows.length}</span>
                          <span className="badge badge-grey">Showing: {visibleRows.length}</span>
                          <span className="badge badge-red">
                            FAIL: {stepStatusCounts.fail}
                          </span>
                          <span className="badge badge-yellow">
                            NO DATA: {stepStatusCounts.noData}
                          </span>
                          <span className="badge badge-green">
                            PASS: {stepStatusCounts.pass}
                          </span>
                        </div>

                        {visibleRows.length ? (
                          <div style={{ display: 'grid', gap: '0.55rem' }}>
                            {visibleRows.map((row) => {
                              const metricMeta = getStep2MetricMeta(row.metric_name);
                              const valueSourceLegend = getStep2ValueSourceLegend(row);
                              const isManualRow = isManualGovernanceRow(row);
                              const rowKey = buildDashboardRowKey(row);
                              const manualSaving = rowKey ? manualKpiSavingRowKeys.has(rowKey) : false;
                              const manualState = getManualGovernanceState(row);
                              const normalizedRowStatus = summarizeGovernanceRowStatus(row);
                              const rowStatusClass = normalizedRowStatus === 'PASS'
                                ? 'badge-green'
                                : normalizedRowStatus === 'FAIL'
                                  ? 'badge-red'
                                  : 'badge-yellow';
                              return (
                                <div
                                  key={`${row.control_id}-${row.metric_name}-${row.requirement_id || 'none'}`}
                                  style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: '0.65rem',
                                    background: 'var(--surface)',
                                    display: 'grid',
                                    gap: '0.55rem',
                                  }}
                                >
                                  {renderRequirementRowHeader(row, rowStatusClass, listView === 'application_specific')}

                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.55rem' }}>
                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Measure
                                      </span>
                                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{metricMeta.label}</span>
                                      <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {metricMeta.measure}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Value
                                      </span>
                                      <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                                        {isManualRow
                                          ? (manualState === 'completed' ? 'Completed' : 'Pending')
                                          : getGovernanceRowValueLabel(row, listView === 'application_specific')}
                                      </span>
                                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                        {isManualRow ? (
                                          <button
                                            type="button"
                                            className={`catalog-row-icon-action ${manualState === 'completed' ? 'is-status-active' : 'is-status-inactive'}`}
                                            onClick={() => setManualKpiValue(row, manualState === 'completed' ? 0 : 100, activeStep)}
                                            disabled={manualSaving}
                                            title={manualState === 'completed' ? 'Completed - click to set Pending' : 'Pending - click to set Completed'}
                                            aria-label={manualState === 'completed' ? 'Set manual KPI to Pending' : 'Set manual KPI to Completed'}
                                          >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                              <path d="M5 3v18" />
                                              <path d="M5 4h11l-2.5 4L16 12H5z" />
                                            </svg>
                                          </button>
                                        ) : null}
                                        <span
                                          title={valueSourceLegend}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            border: '1px solid var(--border)',
                                            fontSize: '0.66rem',
                                            fontWeight: 700,
                                            color: 'var(--text-secondary)',
                                            background: 'var(--surface-2)',
                                            flexShrink: 0,
                                          }}
                                        >
                                          i
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Interpretation
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {getStep2InterpretationText(row)}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Benchmark
                                      </span>
                                      {renderStep2BenchmarkInline(row)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                            No mandatory requirement KPI rows returned yet.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {!loadingStepDetail && !stepDetailError && activeStep === 3 && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                <div className="card card-flat">
                  {(() => {
                    const technicalRows = filterVisibleRows(detailCache.dashboardStep3?.rows || []);
                    const { baselineRows, applicationSpecificRows } = splitRowsByRequirementType(technicalRows);
                    const listView = stepRequirementListView[3] || 'baseline';
                    const visibleRows = listView === 'application_specific' ? applicationSpecificRows : baselineRows;
                    const stepStatusCounts = computeGovernanceStatusCounts(visibleRows);
                    const categoryCompliance = computeCategoryCompliancePct(baselineRows, applicationSpecificRows);
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 3: 'baseline' }))}
                              style={listView === 'baseline'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Secretariat ({baselineRows.length})
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 3: 'application_specific' }))}
                              style={listView === 'application_specific'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Application Specific ({applicationSpecificRows.length})
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.55rem' }}>
                          <span className="badge badge-unblue">Compliance Score: {categoryCompliance}%</span>
                          <span
                            title="Compliance Score for this governance category is calculated across Secretariat + Application Specific requirements. A requirement is counted as complete when Value is greater than 0 (or 0%). Missing value or 0 counts as incomplete."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: '1px solid var(--border)',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              color: 'var(--text-secondary)',
                              background: 'var(--surface-2)',
                              flexShrink: 0,
                              cursor: 'help',
                            }}
                          >
                            i
                          </span>
                        </div>                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
                          <span className="badge badge-grey">Total: {technicalRows.length}</span>
                          <span className="badge badge-grey">Showing: {visibleRows.length}</span>
                          <span className="badge badge-red">
                            FAIL: {stepStatusCounts.fail}
                          </span>
                          <span className="badge badge-yellow">
                            NO DATA: {stepStatusCounts.noData}
                          </span>
                          <span className="badge badge-green">
                            PASS: {stepStatusCounts.pass}
                          </span>
                        </div>

                        {detailCache.dashboardStep3?.summary?.message && (
                          <div className="alert alert-warning" style={{ marginBottom: '0.55rem' }}>
                            {detailCache.dashboardStep3.summary.message}
                          </div>
                        )}

                        {visibleRows.length ? (
                          <div style={{ display: 'grid', gap: '0.55rem' }}>
                            {visibleRows.map((row) => {
                              const metricMeta = getStep2MetricMeta(row.metric_name);
                              const valueSourceLegend = getStep2ValueSourceLegend(row);
                              const isManualRow = isManualGovernanceRow(row);
                              const rowKey = buildDashboardRowKey(row);
                              const manualSaving = rowKey ? manualKpiSavingRowKeys.has(rowKey) : false;
                              const manualState = getManualGovernanceState(row);
                              const normalizedRowStatus = summarizeGovernanceRowStatus(row);
                              const rowStatusClass = normalizedRowStatus === 'PASS'
                                ? 'badge-green'
                                : normalizedRowStatus === 'FAIL'
                                  ? 'badge-red'
                                  : 'badge-yellow';
                              return (
                                <div
                                  key={`${row.control_id}-${row.metric_name}-${row.requirement_id || 'none'}`}
                                  style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: '0.65rem',
                                    background: 'var(--surface)',
                                    display: 'grid',
                                    gap: '0.55rem',
                                  }}
                                >
                                  {renderRequirementRowHeader(row, rowStatusClass, listView === 'application_specific')}

                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.55rem' }}>
                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Measure
                                      </span>
                                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{metricMeta.label}</span>
                                      <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {metricMeta.measure}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Value
                                      </span>
                                      <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                                        {isManualRow
                                          ? (manualState === 'completed' ? 'Completed' : 'Pending')
                                          : getGovernanceRowValueLabel(row, listView === 'application_specific')}
                                      </span>
                                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                        {isManualRow ? (
                                          <button
                                            type="button"
                                            className={`catalog-row-icon-action ${manualState === 'completed' ? 'is-status-active' : 'is-status-inactive'}`}
                                            onClick={() => setManualKpiValue(row, manualState === 'completed' ? 0 : 100, activeStep)}
                                            disabled={manualSaving}
                                            title={manualState === 'completed' ? 'Completed - click to set Pending' : 'Pending - click to set Completed'}
                                            aria-label={manualState === 'completed' ? 'Set manual KPI to Pending' : 'Set manual KPI to Completed'}
                                          >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                              <path d="M5 3v18" />
                                              <path d="M5 4h11l-2.5 4L16 12H5z" />
                                            </svg>
                                          </button>
                                        ) : null}
                                        <span
                                          title={valueSourceLegend}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            border: '1px solid var(--border)',
                                            fontSize: '0.66rem',
                                            fontWeight: 700,
                                            color: 'var(--text-secondary)',
                                            background: 'var(--surface-2)',
                                            flexShrink: 0,
                                          }}
                                        >
                                          i
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Interpretation
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {row.interpretation_text || getStep2InterpretationText(row)}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Benchmark
                                      </span>
                                      {renderStep2BenchmarkInline(row)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                            No technical architecture KPI rows available for this application scope.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {!loadingStepDetail && !stepDetailError && activeStep === 4 && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                <div className="card card-flat">
                  {(() => {
                    const dataReadinessRows = filterVisibleRows(detailCache.dashboardStep4?.rows || []);
                    const { baselineRows, applicationSpecificRows } = splitRowsByRequirementType(dataReadinessRows);
                    const listView = stepRequirementListView[4] || 'baseline';
                    const visibleRows = listView === 'application_specific' ? applicationSpecificRows : baselineRows;
                    const stepStatusCounts = computeGovernanceStatusCounts(visibleRows);
                    const categoryCompliance = computeCategoryCompliancePct(baselineRows, applicationSpecificRows);
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 4: 'baseline' }))}
                              style={listView === 'baseline'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Secretariat ({baselineRows.length})
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 4: 'application_specific' }))}
                              style={listView === 'application_specific'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Application Specific ({applicationSpecificRows.length})
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.55rem' }}>
                          <span className="badge badge-unblue">Compliance Score: {categoryCompliance}%</span>
                          <span
                            title="Compliance Score for this governance category is calculated across Secretariat + Application Specific requirements. A requirement is counted as complete when Value is greater than 0 (or 0%). Missing value or 0 counts as incomplete."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: '1px solid var(--border)',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              color: 'var(--text-secondary)',
                              background: 'var(--surface-2)',
                              flexShrink: 0,
                              cursor: 'help',
                            }}
                          >
                            i
                          </span>
                        </div>                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
                          <span className="badge badge-grey">Total: {dataReadinessRows.length}</span>
                          <span className="badge badge-grey">Showing: {visibleRows.length}</span>
                          <span className="badge badge-red">
                            FAIL: {stepStatusCounts.fail}
                          </span>
                          <span className="badge badge-yellow">
                            NO DATA: {stepStatusCounts.noData}
                          </span>
                          <span className="badge badge-green">
                            PASS: {stepStatusCounts.pass}
                          </span>
                        </div>

                        {detailCache.dashboardStep4?.summary?.message && (
                          <div className="alert alert-warning" style={{ marginBottom: '0.55rem' }}>
                            {detailCache.dashboardStep4.summary.message}
                          </div>
                        )}

                        {visibleRows.length ? (
                          <div style={{ display: 'grid', gap: '0.55rem' }}>
                            {visibleRows.map((row) => {
                              const metricMeta = getStep2MetricMeta(row.metric_name);
                              const valueSourceLegend = getStep2ValueSourceLegend(row);
                              const isManualRow = isManualGovernanceRow(row);
                              const rowKey = buildDashboardRowKey(row);
                              const manualSaving = rowKey ? manualKpiSavingRowKeys.has(rowKey) : false;
                              const manualState = getManualGovernanceState(row);
                              const normalizedRowStatus = summarizeGovernanceRowStatus(row);
                              const rowStatusClass = normalizedRowStatus === 'PASS'
                                ? 'badge-green'
                                : normalizedRowStatus === 'FAIL'
                                  ? 'badge-red'
                                  : 'badge-yellow';
                              return (
                                <div
                                  key={`${row.control_id}-${row.metric_name}-${row.requirement_id || 'none'}`}
                                  style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: '0.65rem',
                                    background: 'var(--surface)',
                                    display: 'grid',
                                    gap: '0.55rem',
                                  }}
                                >
                                  {renderRequirementRowHeader(row, rowStatusClass, listView === 'application_specific')}

                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.55rem' }}>
                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Measure
                                      </span>
                                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{metricMeta.label}</span>
                                      <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {metricMeta.measure}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Value
                                      </span>
                                      <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                                        {isManualRow
                                          ? (manualState === 'completed' ? 'Completed' : 'Pending')
                                          : getGovernanceRowValueLabel(row, listView === 'application_specific')}
                                      </span>
                                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                        {isManualRow ? (
                                          <button
                                            type="button"
                                            className={`catalog-row-icon-action ${manualState === 'completed' ? 'is-status-active' : 'is-status-inactive'}`}
                                            onClick={() => setManualKpiValue(row, manualState === 'completed' ? 0 : 100, activeStep)}
                                            disabled={manualSaving}
                                            title={manualState === 'completed' ? 'Completed - click to set Pending' : 'Pending - click to set Completed'}
                                            aria-label={manualState === 'completed' ? 'Set manual KPI to Pending' : 'Set manual KPI to Completed'}
                                          >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                              <path d="M5 3v18" />
                                              <path d="M5 4h11l-2.5 4L16 12H5z" />
                                            </svg>
                                          </button>
                                        ) : null}
                                        <span
                                          title={valueSourceLegend}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            border: '1px solid var(--border)',
                                            fontSize: '0.66rem',
                                            fontWeight: 700,
                                            color: 'var(--text-secondary)',
                                            background: 'var(--surface-2)',
                                            flexShrink: 0,
                                          }}
                                        >
                                          i
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Interpretation
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {row.interpretation_text || getStep2InterpretationText(row)}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Benchmark
                                      </span>
                                      {renderStep2BenchmarkInline(row)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                            No data-readiness KPI rows available for this application scope.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {!loadingStepDetail && !stepDetailError && activeStep === 5 && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                <div className="card card-flat">
                  {(() => {
                    const dataIntegrationRows = filterVisibleRows(detailCache.dashboardStep5?.rows || []);
                    const { baselineRows, applicationSpecificRows } = splitRowsByRequirementType(dataIntegrationRows);
                    const listView = stepRequirementListView[5] || 'baseline';
                    const visibleRows = listView === 'application_specific' ? applicationSpecificRows : baselineRows;
                    const stepStatusCounts = computeGovernanceStatusCounts(visibleRows);
                    const categoryCompliance = computeCategoryCompliancePct(baselineRows, applicationSpecificRows);
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 5: 'baseline' }))}
                              style={listView === 'baseline'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Secretariat ({baselineRows.length})
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 5: 'application_specific' }))}
                              style={listView === 'application_specific'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Application Specific ({applicationSpecificRows.length})
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.55rem' }}>
                          <span className="badge badge-unblue">Compliance Score: {categoryCompliance}%</span>
                          <span
                            title="Compliance Score for this governance category is calculated across Secretariat + Application Specific requirements. A requirement is counted as complete when Value is greater than 0 (or 0%). Missing value or 0 counts as incomplete."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: '1px solid var(--border)',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              color: 'var(--text-secondary)',
                              background: 'var(--surface-2)',
                              flexShrink: 0,
                              cursor: 'help',
                            }}
                          >
                            i
                          </span>
                        </div>                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
                          <span className="badge badge-grey">Total: {dataIntegrationRows.length}</span>
                          <span className="badge badge-grey">Showing: {visibleRows.length}</span>
                          <span className="badge badge-red">
                            FAIL: {stepStatusCounts.fail}
                          </span>
                          <span className="badge badge-yellow">
                            NO DATA: {stepStatusCounts.noData}
                          </span>
                          <span className="badge badge-green">
                            PASS: {stepStatusCounts.pass}
                          </span>
                        </div>

                        {detailCache.dashboardStep5?.summary?.message && (
                          <div className="alert alert-warning" style={{ marginBottom: '0.55rem' }}>
                            {detailCache.dashboardStep5.summary.message}
                          </div>
                        )}

                        {visibleRows.length ? (
                          <div style={{ display: 'grid', gap: '0.55rem' }}>
                            {visibleRows.map((row) => {
                              const metricMeta = getStep2MetricMeta(row.metric_name);
                              const valueSourceLegend = getStep2ValueSourceLegend(row);
                              const isManualRow = isManualGovernanceRow(row);
                              const rowKey = buildDashboardRowKey(row);
                              const manualSaving = rowKey ? manualKpiSavingRowKeys.has(rowKey) : false;
                              const manualState = getManualGovernanceState(row);
                              const normalizedRowStatus = summarizeGovernanceRowStatus(row);
                              const rowStatusClass = normalizedRowStatus === 'PASS'
                                ? 'badge-green'
                                : normalizedRowStatus === 'FAIL'
                                  ? 'badge-red'
                                  : 'badge-yellow';
                              return (
                                <div
                                  key={`${row.control_id}-${row.metric_name}-${row.requirement_id || 'none'}`}
                                  style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: '0.65rem',
                                    background: 'var(--surface)',
                                    display: 'grid',
                                    gap: '0.55rem',
                                  }}
                                >
                                  {renderRequirementRowHeader(row, rowStatusClass, listView === 'application_specific')}

                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.55rem' }}>
                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Measure
                                      </span>
                                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{metricMeta.label}</span>
                                      <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {metricMeta.measure}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Value
                                      </span>
                                      <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                                        {isManualRow
                                          ? (manualState === 'completed' ? 'Completed' : 'Pending')
                                          : getGovernanceRowValueLabel(row, listView === 'application_specific')}
                                      </span>
                                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                        {isManualRow ? (
                                          <button
                                            type="button"
                                            className={`catalog-row-icon-action ${manualState === 'completed' ? 'is-status-active' : 'is-status-inactive'}`}
                                            onClick={() => setManualKpiValue(row, manualState === 'completed' ? 0 : 100, activeStep)}
                                            disabled={manualSaving}
                                            title={manualState === 'completed' ? 'Completed - click to set Pending' : 'Pending - click to set Completed'}
                                            aria-label={manualState === 'completed' ? 'Set manual KPI to Pending' : 'Set manual KPI to Completed'}
                                          >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                              <path d="M5 3v18" />
                                              <path d="M5 4h11l-2.5 4L16 12H5z" />
                                            </svg>
                                          </button>
                                        ) : null}
                                        <span
                                          title={valueSourceLegend}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            border: '1px solid var(--border)',
                                            fontSize: '0.66rem',
                                            fontWeight: 700,
                                            color: 'var(--text-secondary)',
                                            background: 'var(--surface-2)',
                                            flexShrink: 0,
                                          }}
                                        >
                                          i
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Interpretation
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {row.interpretation_text || getStep2InterpretationText(row)}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Benchmark
                                      </span>
                                      {renderStep2BenchmarkInline(row)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                            No data-integration KPI rows available for this application scope.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {!loadingStepDetail && !stepDetailError && activeStep === 6 && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                <div className="card card-flat">
                  {(() => {
                    const securityRows = filterVisibleRows(detailCache.dashboardStep6?.rows || []);
                    const { baselineRows, applicationSpecificRows } = splitRowsByRequirementType(securityRows);
                    const listView = stepRequirementListView[6] || 'baseline';
                    const visibleRows = listView === 'application_specific' ? applicationSpecificRows : baselineRows;
                    const stepStatusCounts = computeGovernanceStatusCounts(visibleRows);
                    const categoryCompliance = computeCategoryCompliancePct(baselineRows, applicationSpecificRows);
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 6: 'baseline' }))}
                              style={listView === 'baseline'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Secretariat ({baselineRows.length})
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 6: 'application_specific' }))}
                              style={listView === 'application_specific'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Application Specific ({applicationSpecificRows.length})
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.55rem' }}>
                          <span className="badge badge-unblue">Compliance Score: {categoryCompliance}%</span>
                          <span
                            title="Compliance Score for this governance category is calculated across Secretariat + Application Specific requirements. A requirement is counted as complete when Value is greater than 0 (or 0%). Missing value or 0 counts as incomplete."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: '1px solid var(--border)',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              color: 'var(--text-secondary)',
                              background: 'var(--surface-2)',
                              flexShrink: 0,
                              cursor: 'help',
                            }}
                          >
                            i
                          </span>
                        </div>                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
                          <span className="badge badge-grey">Total: {securityRows.length}</span>
                          <span className="badge badge-grey">Showing: {visibleRows.length}</span>
                          <span className="badge badge-red">
                            FAIL: {stepStatusCounts.fail}
                          </span>
                          <span className="badge badge-yellow">
                            NO DATA: {stepStatusCounts.noData}
                          </span>
                          <span className="badge badge-green">
                            PASS: {stepStatusCounts.pass}
                          </span>
                        </div>

                        {detailCache.dashboardStep6?.summary?.message && (
                          <div className="alert alert-warning" style={{ marginBottom: '0.55rem' }}>
                            {detailCache.dashboardStep6.summary.message}
                          </div>
                        )}

                        {visibleRows.length ? (
                          <div style={{ display: 'grid', gap: '0.55rem' }}>
                            {visibleRows.map((row) => {
                              const metricMeta = getStep2MetricMeta(row.metric_name);
                              const valueSourceLegend = getStep2ValueSourceLegend(row);
                              const isManualRow = isManualGovernanceRow(row);
                              const rowKey = buildDashboardRowKey(row);
                              const manualSaving = rowKey ? manualKpiSavingRowKeys.has(rowKey) : false;
                              const manualState = getManualGovernanceState(row);
                              const normalizedRowStatus = summarizeGovernanceRowStatus(row);
                              const rowStatusClass = normalizedRowStatus === 'PASS'
                                ? 'badge-green'
                                : normalizedRowStatus === 'FAIL'
                                  ? 'badge-red'
                                  : 'badge-yellow';
                              return (
                                <div
                                  key={`${row.control_id}-${row.metric_name}-${row.requirement_id || 'none'}`}
                                  style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: '0.65rem',
                                    background: 'var(--surface)',
                                    display: 'grid',
                                    gap: '0.55rem',
                                  }}
                                >
                                  {renderRequirementRowHeader(row, rowStatusClass, listView === 'application_specific')}

                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.55rem' }}>
                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Measure
                                      </span>
                                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{metricMeta.label}</span>
                                      <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {metricMeta.measure}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Value
                                      </span>
                                      <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                                        {isManualRow
                                          ? (manualState === 'completed' ? 'Completed' : 'Pending')
                                          : getGovernanceRowValueLabel(row, listView === 'application_specific')}
                                      </span>
                                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                        {isManualRow ? (
                                          <button
                                            type="button"
                                            className={`catalog-row-icon-action ${manualState === 'completed' ? 'is-status-active' : 'is-status-inactive'}`}
                                            onClick={() => setManualKpiValue(row, manualState === 'completed' ? 0 : 100, activeStep)}
                                            disabled={manualSaving}
                                            title={manualState === 'completed' ? 'Completed - click to set Pending' : 'Pending - click to set Completed'}
                                            aria-label={manualState === 'completed' ? 'Set manual KPI to Pending' : 'Set manual KPI to Completed'}
                                          >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                              <path d="M5 3v18" />
                                              <path d="M5 4h11l-2.5 4L16 12H5z" />
                                            </svg>
                                          </button>
                                        ) : null}
                                        <span
                                          title={valueSourceLegend}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            border: '1px solid var(--border)',
                                            fontSize: '0.66rem',
                                            fontWeight: 700,
                                            color: 'var(--text-secondary)',
                                            background: 'var(--surface-2)',
                                            flexShrink: 0,
                                          }}
                                        >
                                          i
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Interpretation
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {row.interpretation_text || getStep2InterpretationText(row)}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Benchmark
                                      </span>
                                      {renderStep2BenchmarkInline(row)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                            No security KPI rows available for this application scope.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
            {!loadingStepDetail && !stepDetailError && activeStep === 7 && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                <div className="card card-flat">
                  {(() => {
                    const infrastructureRows = filterVisibleRows(detailCache.dashboardStep7?.rows || []);
                    const { baselineRows, applicationSpecificRows } = splitRowsByRequirementType(infrastructureRows);
                    const listView = stepRequirementListView[7] || 'baseline';
                    const visibleRows = listView === 'application_specific' ? applicationSpecificRows : baselineRows;
                    const stepStatusCounts = computeGovernanceStatusCounts(visibleRows);
                    const categoryCompliance = computeCategoryCompliancePct(baselineRows, applicationSpecificRows);
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 7: 'baseline' }))}
                              style={listView === 'baseline'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Secretariat ({baselineRows.length})
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 7: 'application_specific' }))}
                              style={listView === 'application_specific'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Application Specific ({applicationSpecificRows.length})
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.55rem' }}>
                          <span className="badge badge-unblue">Compliance Score: {categoryCompliance}%</span>
                          <span
                            title="Compliance Score for this governance category is calculated across Secretariat + Application Specific requirements. A requirement is counted as complete when Value is greater than 0 (or 0%). Missing value or 0 counts as incomplete."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: '1px solid var(--border)',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              color: 'var(--text-secondary)',
                              background: 'var(--surface-2)',
                              flexShrink: 0,
                              cursor: 'help',
                            }}
                          >
                            i
                          </span>
                        </div>                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
                          <span className="badge badge-grey">Total: {infrastructureRows.length}</span>
                          <span className="badge badge-grey">Showing: {visibleRows.length}</span>
                          <span className="badge badge-red">
                            FAIL: {stepStatusCounts.fail}
                          </span>
                          <span className="badge badge-yellow">
                            NO DATA: {stepStatusCounts.noData}
                          </span>
                          <span className="badge badge-green">
                            PASS: {stepStatusCounts.pass}
                          </span>
                        </div>

                        {detailCache.dashboardStep7?.summary?.message && (
                          <div className="alert alert-warning" style={{ marginBottom: '0.55rem' }}>
                            {detailCache.dashboardStep7.summary.message}
                          </div>
                        )}

                        {visibleRows.length ? (
                          <div style={{ display: 'grid', gap: '0.55rem' }}>
                            {visibleRows.map((row) => {
                              const metricMeta = getStep2MetricMeta(row.metric_name);
                              const valueSourceLegend = getStep2ValueSourceLegend(row);
                              const isManualRow = isManualGovernanceRow(row);
                              const rowKey = buildDashboardRowKey(row);
                              const manualSaving = rowKey ? manualKpiSavingRowKeys.has(rowKey) : false;
                              const manualState = getManualGovernanceState(row);
                              const normalizedRowStatus = summarizeGovernanceRowStatus(row);
                              const rowStatusClass = normalizedRowStatus === 'PASS'
                                ? 'badge-green'
                                : normalizedRowStatus === 'FAIL'
                                  ? 'badge-red'
                                  : 'badge-yellow';
                              return (
                                <div
                                  key={`${row.control_id}-${row.metric_name}-${row.requirement_id || 'none'}`}
                                  style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: '0.65rem',
                                    background: 'var(--surface)',
                                    display: 'grid',
                                    gap: '0.55rem',
                                  }}
                                >
                                  {renderRequirementRowHeader(row, rowStatusClass, listView === 'application_specific')}

                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.55rem' }}>
                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Measure
                                      </span>
                                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{metricMeta.label}</span>
                                      <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {metricMeta.measure}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Value
                                      </span>
                                      <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                                        {isManualRow
                                          ? (manualState === 'completed' ? 'Completed' : 'Pending')
                                          : getGovernanceRowValueLabel(row, listView === 'application_specific')}
                                      </span>
                                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                        {isManualRow ? (
                                          <button
                                            type="button"
                                            className={`catalog-row-icon-action ${manualState === 'completed' ? 'is-status-active' : 'is-status-inactive'}`}
                                            onClick={() => setManualKpiValue(row, manualState === 'completed' ? 0 : 100, activeStep)}
                                            disabled={manualSaving}
                                            title={manualState === 'completed' ? 'Completed - click to set Pending' : 'Pending - click to set Completed'}
                                            aria-label={manualState === 'completed' ? 'Set manual KPI to Pending' : 'Set manual KPI to Completed'}
                                          >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                              <path d="M5 3v18" />
                                              <path d="M5 4h11l-2.5 4L16 12H5z" />
                                            </svg>
                                          </button>
                                        ) : null}
                                        <span
                                          title={valueSourceLegend}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            border: '1px solid var(--border)',
                                            fontSize: '0.66rem',
                                            fontWeight: 700,
                                            color: 'var(--text-secondary)',
                                            background: 'var(--surface-2)',
                                            flexShrink: 0,
                                          }}
                                        >
                                          i
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Interpretation
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {row.interpretation_text || getStep2InterpretationText(row)}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Benchmark
                                      </span>
                                      {renderStep2BenchmarkInline(row)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                            No infrastructure KPI rows available for this application scope.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {!loadingStepDetail && !stepDetailError && activeStep === 8 && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                <div className="card card-flat">
                  {(() => {
                    const solutionDesignRows = filterVisibleRows(detailCache.dashboardStep8?.rows || []);
                    const { baselineRows, applicationSpecificRows } = splitRowsByRequirementType(solutionDesignRows);
                    const listView = stepRequirementListView[8] || 'baseline';
                    const visibleRows = listView === 'application_specific' ? applicationSpecificRows : baselineRows;
                    const stepStatusCounts = computeGovernanceStatusCounts(visibleRows);
                    const categoryCompliance = computeCategoryCompliancePct(baselineRows, applicationSpecificRows);
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 8: 'baseline' }))}
                              style={listView === 'baseline'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Secretariat ({baselineRows.length})
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 8: 'application_specific' }))}
                              style={listView === 'application_specific'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Application Specific ({applicationSpecificRows.length})
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.55rem' }}>
                          <span className="badge badge-unblue">Compliance Score: {categoryCompliance}%</span>
                          <span
                            title="Compliance Score for this governance category is calculated across Secretariat + Application Specific requirements. A requirement is counted as complete when Value is greater than 0 (or 0%). Missing value or 0 counts as incomplete."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: '1px solid var(--border)',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              color: 'var(--text-secondary)',
                              background: 'var(--surface-2)',
                              flexShrink: 0,
                              cursor: 'help',
                            }}
                          >
                            i
                          </span>
                        </div>                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
                          <span className="badge badge-grey">Total: {solutionDesignRows.length}</span>
                          <span className="badge badge-grey">Showing: {visibleRows.length}</span>
                          <span className="badge badge-red">
                            FAIL: {stepStatusCounts.fail}
                          </span>
                          <span className="badge badge-yellow">
                            NO DATA: {stepStatusCounts.noData}
                          </span>
                          <span className="badge badge-green">
                            PASS: {stepStatusCounts.pass}
                          </span>
                        </div>

                        {detailCache.dashboardStep8?.summary?.message && (
                          <div className="alert alert-warning" style={{ marginBottom: '0.55rem' }}>
                            {detailCache.dashboardStep8.summary.message}
                          </div>
                        )}

                        {visibleRows.length ? (
                          <div style={{ display: 'grid', gap: '0.55rem' }}>
                            {visibleRows.map((row) => {
                              const metricMeta = getStep2MetricMeta(row.metric_name);
                              const valueSourceLegend = getStep2ValueSourceLegend(row);
                              const isManualRow = isManualGovernanceRow(row);
                              const rowKey = buildDashboardRowKey(row);
                              const manualSaving = rowKey ? manualKpiSavingRowKeys.has(rowKey) : false;
                              const manualState = getManualGovernanceState(row);
                              const normalizedRowStatus = summarizeGovernanceRowStatus(row);
                              const rowStatusClass = normalizedRowStatus === 'PASS'
                                ? 'badge-green'
                                : normalizedRowStatus === 'FAIL'
                                  ? 'badge-red'
                                  : 'badge-yellow';
                              return (
                                <div
                                  key={`${row.control_id}-${row.metric_name}-${row.requirement_id || 'none'}`}
                                  style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: '0.65rem',
                                    background: 'var(--surface)',
                                    display: 'grid',
                                    gap: '0.55rem',
                                  }}
                                >
                                  {renderRequirementRowHeader(row, rowStatusClass, listView === 'application_specific')}

                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.55rem' }}>
                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Measure
                                      </span>
                                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{metricMeta.label}</span>
                                      <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {metricMeta.measure}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Value
                                      </span>
                                      <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                                        {isManualRow
                                          ? (manualState === 'completed' ? 'Completed' : 'Pending')
                                          : getGovernanceRowValueLabel(row, listView === 'application_specific')}
                                      </span>
                                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                        {isManualRow ? (
                                          <button
                                            type="button"
                                            className={`catalog-row-icon-action ${manualState === 'completed' ? 'is-status-active' : 'is-status-inactive'}`}
                                            onClick={() => setManualKpiValue(row, manualState === 'completed' ? 0 : 100, activeStep)}
                                            disabled={manualSaving}
                                            title={manualState === 'completed' ? 'Completed - click to set Pending' : 'Pending - click to set Completed'}
                                            aria-label={manualState === 'completed' ? 'Set manual KPI to Pending' : 'Set manual KPI to Completed'}
                                          >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                              <path d="M5 3v18" />
                                              <path d="M5 4h11l-2.5 4L16 12H5z" />
                                            </svg>
                                          </button>
                                        ) : null}
                                        <span
                                          title={valueSourceLegend}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            border: '1px solid var(--border)',
                                            fontSize: '0.66rem',
                                            fontWeight: 700,
                                            color: 'var(--text-secondary)',
                                            background: 'var(--surface-2)',
                                            flexShrink: 0,
                                          }}
                                        >
                                          i
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Interpretation
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {row.interpretation_text || getStep2InterpretationText(row)}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Benchmark
                                      </span>
                                      {renderStep2BenchmarkInline(row)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                            No solution-design KPI rows available for this application scope.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {!loadingStepDetail && !stepDetailError && activeStep === 9 && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                <div className="card card-flat">
                  {(() => {
                    const systemPerformanceRows = filterVisibleRows(detailCache.dashboardStep9?.rows || []);
                    const { baselineRows, applicationSpecificRows } = splitRowsByRequirementType(systemPerformanceRows);
                    const listView = stepRequirementListView[9] || 'baseline';
                    const visibleRows = listView === 'application_specific' ? applicationSpecificRows : baselineRows;
                    const stepStatusCounts = computeGovernanceStatusCounts(visibleRows);
                    const categoryCompliance = computeCategoryCompliancePct(baselineRows, applicationSpecificRows);
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 9: 'baseline' }))}
                              style={listView === 'baseline'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Secretariat ({baselineRows.length})
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => setStepRequirementListView((prev) => ({ ...prev, 9: 'application_specific' }))}
                              style={listView === 'application_specific'
                                ? { borderColor: 'var(--un-blue)', color: 'var(--un-blue)', background: 'var(--un-blue-light)' }
                                : undefined}
                            >
                              Application Specific ({applicationSpecificRows.length})
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.55rem' }}>
                          <span className="badge badge-unblue">Compliance Score: {categoryCompliance}%</span>
                          <span
                            title="Compliance Score for this governance category is calculated across Secretariat + Application Specific requirements. A requirement is counted as complete when Value is greater than 0 (or 0%). Missing value or 0 counts as incomplete."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              border: '1px solid var(--border)',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              color: 'var(--text-secondary)',
                              background: 'var(--surface-2)',
                              flexShrink: 0,
                              cursor: 'help',
                            }}
                          >
                            i
                          </span>
                        </div>                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.55rem' }}>
                          <span className="badge badge-grey">Total: {systemPerformanceRows.length}</span>
                          <span className="badge badge-grey">Showing: {visibleRows.length}</span>
                          <span className="badge badge-red">
                            FAIL: {stepStatusCounts.fail}
                          </span>
                          <span className="badge badge-yellow">
                            NO DATA: {stepStatusCounts.noData}
                          </span>
                          <span className="badge badge-green">
                            PASS: {stepStatusCounts.pass}
                          </span>
                        </div>

                        {detailCache.dashboardStep9?.summary?.message && (
                          <div className="alert alert-warning" style={{ marginBottom: '0.55rem' }}>
                            {detailCache.dashboardStep9.summary.message}
                          </div>
                        )}

                        {visibleRows.length ? (
                          <div style={{ display: 'grid', gap: '0.55rem' }}>
                            {visibleRows.map((row) => {
                              const metricMeta = getStep2MetricMeta(row.metric_name);
                              const valueSourceLegend = getStep2ValueSourceLegend(row);
                              const isManualRow = isManualGovernanceRow(row);
                              const rowKey = buildDashboardRowKey(row);
                              const manualSaving = rowKey ? manualKpiSavingRowKeys.has(rowKey) : false;
                              const manualState = getManualGovernanceState(row);
                              const normalizedRowStatus = summarizeGovernanceRowStatus(row);
                              const rowStatusClass = normalizedRowStatus === 'PASS'
                                ? 'badge-green'
                                : normalizedRowStatus === 'FAIL'
                                  ? 'badge-red'
                                  : 'badge-yellow';
                              return (
                                <div
                                  key={`${row.control_id}-${row.metric_name}-${row.requirement_id || 'none'}`}
                                  style={{
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                    padding: '0.65rem',
                                    background: 'var(--surface)',
                                    display: 'grid',
                                    gap: '0.55rem',
                                  }}
                                >
                                  {renderRequirementRowHeader(row, rowStatusClass, listView === 'application_specific')}

                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.55rem' }}>
                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Measure
                                      </span>
                                      <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>{metricMeta.label}</span>
                                      <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {metricMeta.measure}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Value
                                      </span>
                                      <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                                        {isManualRow
                                          ? (manualState === 'completed' ? 'Completed' : 'Pending')
                                          : getGovernanceRowValueLabel(row, listView === 'application_specific')}
                                      </span>
                                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                        {isManualRow ? (
                                          <button
                                            type="button"
                                            className={`catalog-row-icon-action ${manualState === 'completed' ? 'is-status-active' : 'is-status-inactive'}`}
                                            onClick={() => setManualKpiValue(row, manualState === 'completed' ? 0 : 100, activeStep)}
                                            disabled={manualSaving}
                                            title={manualState === 'completed' ? 'Completed - click to set Pending' : 'Pending - click to set Completed'}
                                            aria-label={manualState === 'completed' ? 'Set manual KPI to Pending' : 'Set manual KPI to Completed'}
                                          >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                              <path d="M5 3v18" />
                                              <path d="M5 4h11l-2.5 4L16 12H5z" />
                                            </svg>
                                          </button>
                                        ) : null}
                                        <span
                                          title={valueSourceLegend}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            border: '1px solid var(--border)',
                                            fontSize: '0.66rem',
                                            fontWeight: 700,
                                            color: 'var(--text-secondary)',
                                            background: 'var(--surface-2)',
                                            flexShrink: 0,
                                          }}
                                        >
                                          i
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Interpretation
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                                        {row.interpretation_text || getStep2InterpretationText(row)}
                                      </span>
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                        Benchmark
                                      </span>
                                      {renderStep2BenchmarkInline(row)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                            No system-performance KPI rows available for this application scope.
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {renderRequirementDetailModal()}

            {removeRequirementModal ? (
              <div
                className="catalog-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-label="Remove requirement from governance view"
                onClick={(event) => {
                  if (event.target === event.currentTarget) closeRemoveRequirementModal();
                }}
              >
                <div className="catalog-modal catalog-animate-enter" style={{ width: 'min(520px, 100%)' }}>
                  <div className="catalog-modal-header">
                    <div className="catalog-modal-heading">
                      <h3>{removeRequirementModal.mode === 'scope' ? 'Remove Requirement' : 'Hide Requirement'}</h3>
                      <p>{removeRequirementModal.requirementTitle}</p>
                    </div>
                  </div>
                  <div className="catalog-modal-section catalog-modal-mini-section" style={{ marginTop: 0 }}>
                    <p className="section-copy" style={{ marginBottom: 0 }}>
                      {removeRequirementModal.mode === 'scope'
                        ? 'Remove this requirement from the current application dashboard scope?'
                        : 'Hide this requirement row from the current Governance detail view?'}
                    </p>
                    <p className="catalog-modal-helper-text" style={{ marginTop: '0.45rem' }}>
                      {removeRequirementModal.mode === 'scope'
                        ? `Control: ${removeRequirementModal.controlTitle}`
                        : 'This does not delete the requirement from the database.'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.45rem', marginTop: '0.65rem' }}>
                    <button type="button" className="btn-secondary" onClick={closeRemoveRequirementModal} disabled={removingRequirement}>
                      Cancel
                    </button>
                    <button type="button" className="btn-primary catalog-action-btn" onClick={confirmRemoveRequirement} disabled={removingRequirement}>
                      {removingRequirement
                        ? (removeRequirementModal.mode === 'scope' ? 'Removing...' : 'Hiding...')
                        : (removeRequirementModal.mode === 'scope' ? 'Remove' : 'Hide')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

GovernanceTab.propTypes = {
  requestedStep: PropTypes.shape({
    stepNum: PropTypes.number.isRequired,
    token: PropTypes.number.isRequired,
  }),
  onDashboardUiChange: PropTypes.func,
  mode: PropTypes.oneOf(['home', 'governance']),
};

GovernanceTab.defaultProps = {
  requestedStep: null,
  onDashboardUiChange: null,
  mode: 'governance',
};

















