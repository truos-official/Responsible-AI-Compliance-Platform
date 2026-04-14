import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { api } from '../../api/client.js';

const DASHBOARD_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripBulletChars(value) {
  return String(value || '').replace(/^[\s\-*•·◦▪▫]+/, '').trim();
}

function cleanRequirementText(value) {
  const raw = stripBulletChars(value);
  if (!raw) return '';
  return raw
    .replace(/^(\(\s*[a-zA-Z0-9]+\s*\)\s*)+/, '')
    .replace(/^\d+(\.\d+)*[\)\.\-:]?\s+/, '')
    .replace(/^[-*]\s+/, '')
    .trim();
}

function humanizeMetricName(metricName) {
  if (!metricName) return 'No metric bound';
  return metricName
    .replace(/^ai\./i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function LeaderboardSection({
  title,
  subtitle,
  items,
  emptyText,
  tone = 'neutral',
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
  tone: PropTypes.oneOf(['neutral', 'positive', 'negative', 'accent']),
  scaleMax: PropTypes.number,
};

export function SystemLeaderboardPanel({ embedded = true }) {
  const [connectedApps, setConnectedApps] = useState([]);
  const [leaderboardScopeItems, setLeaderboardScopeItems] = useState([]);
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [leaderboardComplianceSnapshots, setLeaderboardComplianceSnapshots] = useState([]);
  const [leaderboardTierSnapshots, setLeaderboardTierSnapshots] = useState([]);
  const [leaderboardError, setLeaderboardError] = useState('');
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadApps() {
      try {
        const apps = await api.listApplications();
        if (!active) return;
        const activeApps = (Array.isArray(apps) ? apps : []).filter(
          (app) => String(app?.status || '').toLowerCase() !== 'disconnected',
        );
        setConnectedApps(activeApps);
      } catch {
        if (!active) return;
        setConnectedApps([]);
      }
    }
    loadApps();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadSystemLeaderboardData() {
      const appIds = connectedApps.map((app) => app.id).filter(Boolean);
      if (appIds.length === 0) {
        setLeaderboardScopeItems([]);
        setLeaderboardRows([]);
        setLeaderboardComplianceSnapshots([]);
        setLeaderboardTierSnapshots([]);
        setLeaderboardError('');
        return;
      }
      setLoadingLeaderboard(true);
      setLeaderboardError('');
      try {
        const [scopeSettled, dashboardSettled, complianceSettled, tierSettled] = await Promise.all([
          Promise.allSettled(appIds.map((appId) => api.getApplicationRequirements(appId, 'limit=500'))),
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
          .filter((result) => result.status === 'fulfilled')
          .flatMap((result) => (Array.isArray(result.value?.items) ? result.value.items : []));
        const rows = dashboardSettled
          .filter((result) => result.status === 'fulfilled')
          .flatMap((result) => (Array.isArray(result.value?.rows) ? result.value.rows : []));
        const complianceSnapshots = complianceSettled
          .filter((result) => result.status === 'fulfilled')
          .map((result) => result.value);
        const tierSnapshots = tierSettled
          .filter((result) => result.status === 'fulfilled')
          .map((result) => result.value);

        const failures = (
          scopeSettled.filter((result) => result.status === 'rejected').length
          + dashboardSettled.filter((result) => result.status === 'rejected').length
          + complianceSettled.filter((result) => result.status === 'rejected').length
          + tierSettled.filter((result) => result.status === 'rejected').length
        );

        setLeaderboardScopeItems(scopeItems);
        setLeaderboardRows(rows);
        setLeaderboardComplianceSnapshots(complianceSnapshots);
        setLeaderboardTierSnapshots(tierSnapshots);
        if (failures > 0) {
          setLeaderboardError('Some system analytics segments could not be loaded; leaderboard uses available data.');
        }
      } catch {
        if (!active) return;
        setLeaderboardScopeItems([]);
        setLeaderboardRows([]);
        setLeaderboardComplianceSnapshots([]);
        setLeaderboardTierSnapshots([]);
        setLeaderboardError('Failed to load system leaderboard signals.');
      } finally {
        if (active) setLoadingLeaderboard(false);
      }
    }

    loadSystemLeaderboardData();
    return () => {
      active = false;
    };
  }, [connectedApps]);

  const populationOverview = useMemo(() => {
    const complianceRates = leaderboardComplianceSnapshots
      .map((item) => Number(item?.pass_rate))
      .filter((value) => Number.isFinite(value));

    const fallbackCompliance = (() => {
      const evaluatedRows = leaderboardRows.filter((row) => {
        const result = String(row?.benchmark_result || row?.result || '').toUpperCase();
        return result === 'PASS' || result === 'FAIL';
      });
      if (!evaluatedRows.length) return null;
      const passCount = evaluatedRows.filter((row) => String(row?.benchmark_result || row?.result || '').toUpperCase() === 'PASS').length;
      return passCount / evaluatedRows.length;
    })();

    const complianceRate = complianceRates.length
      ? complianceRates.reduce((sum, value) => sum + value, 0) / complianceRates.length
      : fallbackCompliance;

    const tierToLevel = (tierValue) => {
      const text = String(tierValue || '').trim().toLowerCase();
      if (text === 'very high' || text === 'very_high' || text === 'critical') return 4;
      if (text === 'high') return 3;
      if (text === 'medium' || text === 'common') return 2;
      if (text === 'low' || text === 'foundation') return 1;
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
      if (!Number.isFinite(avgTierLevel)) return 'N/A';
      if (avgTierLevel < 1.5) return 'Low';
      if (avgTierLevel < 2.5) return 'Medium';
      if (avgTierLevel < 3.5) return 'High';
      return 'Very High';
    })();

    const tierDistribution = { Low: 0, Medium: 0, High: 0, 'Very High': 0 };
    const sourceTiers = leaderboardTierSnapshots.length
      ? leaderboardTierSnapshots.map((snapshot) => snapshot?.current_tier)
      : connectedApps.map((app) => app?.current_tier);
    sourceTiers.forEach((tier) => {
      const level = tierToLevel(tier);
      if (level === 1) tierDistribution.Low += 1;
      if (level === 2) tierDistribution.Medium += 1;
      if (level === 3) tierDistribution.High += 1;
      if (level === 4) tierDistribution['Very High'] += 1;
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
      const metric = String(row?.metric_name || '').trim();
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
      if (typeof row?.value === 'number' && !Number.isNaN(row.value)) {
        entry.withData += 1;
      } else {
        entry.noData += 1;
      }
      const outcome = String(row?.benchmark_result || row?.result || '').toUpperCase();
      if (outcome === 'PASS') {
        entry.pass += 1;
        entry.evaluated += 1;
      } else if (outcome === 'FAIL') {
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
        scoreText: passRatePct === null ? 'No benchmark' : `${Math.round(passRatePct)}% pass`,
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
          name: cleanRequirementText(scopeItem?.title) || 'Untitled requirement',
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
    <aside className={`card catalog-leaderboard-panel${embedded ? ' is-embedded' : ''}`}>
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
        <p className="section-copy" style={{ marginBottom: '0.5rem' }}>Refreshing leaderboard signals...</p>
      ) : null}
      {leaderboardError ? (
        <p className="section-copy" style={{ marginBottom: '0.5rem', color: 'var(--warning)' }}>{leaderboardError}</p>
      ) : null}
      <section className="catalog-leaderboard-section tone-accent">
        <div className="catalog-leaderboard-title">Population Averages</div>
        <div className="catalog-population-grid">
          <div className="catalog-population-card">
            <div className="catalog-population-label">Compliance Rate</div>
            <div className="catalog-population-value">
              {complianceRatePct === null ? 'N/A' : `${Math.round(complianceRatePct)}%`}
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
              {Number.isFinite(populationOverview.avgRiskScore) ? ` (${Math.round(populationOverview.avgRiskScore)})` : ''}
            </div>
            <div className="catalog-population-track">
              <span
                className="catalog-population-fill is-risk"
                style={{ width: `${avgRiskLevelPct === null ? 0 : Math.max(6, Math.round(avgRiskLevelPct))}%` }}
              />
            </div>
            <div className="catalog-population-meta">
              Low {populationOverview.tierDistribution.Low} | Medium {populationOverview.tierDistribution.Medium} | High {populationOverview.tierDistribution.High} | Very High {populationOverview.tierDistribution['Very High']}
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
  );
}

SystemLeaderboardPanel.propTypes = {
  embedded: PropTypes.bool,
};

