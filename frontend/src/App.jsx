import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useApp } from './context/AppContext.jsx';
import DashboardsTab from './components/DashboardsTab.jsx';
import CatalogSearchPanel from './components/CatalogSearchPanel.jsx';
import AdminTab from './components/AdminTab.jsx';
import AlignmentWeightsPanel from './components/AlignmentWeightsPanel.jsx';
import HomePage from './components/HomePage.jsx';
import { normalizeRiskTier } from './components/shared/TierBadge.jsx';

const Icons = {
  Home: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.8V20a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.8" />
      <path d="M10 21v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
    </svg>
  ),
  Dashboards: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4" width="17" height="16.5" rx="3" />
      <path d="M8 16V12" />
      <path d="M12 16V9" />
      <path d="M16 16V6.5" />
      <path d="M6 19h12" />
    </svg>
  ),
  Requirements: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3.5h7l4 4V20a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
      <path d="M15 3.5V8h4" />
      <path d="M10 12h6" />
      <path d="M10 15.5h6" />
      <path d="M10 19h4" />
    </svg>
  ),
  Risk: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 4.5 7v5.4c0 4.5 3 7.8 7.5 9.6 4.5-1.8 7.5-5.1 7.5-9.6V7L12 3z" />
      <path d="M9 12.2 11.2 14.4 15.4 10.2" />
    </svg>
  ),
  Admin: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h8" />
      <path d="M4 12h16" />
      <path d="M4 17h10" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  ),
  AppSelect: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="7" height="6.5" rx="1.2" />
      <rect x="13.5" y="5" width="7" height="6.5" rx="1.2" />
      <rect x="8.5" y="14" width="7" height="6.5" rx="1.2" />
      <path d="M10.5 8.2h3" />
      <path d="M12 11.5v2.5" />
    </svg>
  ),
  OpenApp: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6" />
      <path d="M10 14 20 4" />
      <path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5" />
    </svg>
  ),
  ChevronDown: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>,
  Tier: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" /></svg>,
  Compliance: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><polyline points="20 6 9 17 4 12" /></svg>,
  Kpi: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><polyline points="3 13 8 13 11 6 14 18 17 11 21 11" /></svg>,
};

const GOV_COLOR = '#009edb';

const STEPS = [
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


function stepStatusTheme(status) {
  if (status === 'complete') {
    return {
      text: 'var(--success)',
      bubbleBg: 'var(--success-light)',
      bubbleColor: 'var(--success)',
      dot: 'var(--success)',
    };
  }
  if (status === 'attention') {
    return {
      text: '#b45309',
      bubbleBg: 'var(--warning-light)',
      bubbleColor: '#b45309',
      dot: '#d97706',
    };
  }
  return {
    text: 'var(--text-tertiary)',
    bubbleBg: 'var(--surface-3)',
    bubbleColor: 'var(--text-tertiary)',
    dot: 'var(--text-tertiary)',
  };
}

export default function App() {
  const { currentUser, canAdmin, selectedApp, selectApp } = useApp();
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === 'undefined') {
      return 'home';
    }
    const hasAppQuery = new URLSearchParams(window.location.search).has('app_id');
    return hasAppQuery ? 'dashboards' : 'home';
  });
  const [requestedStep, setRequestedStep] = useState(null);
  const [dashboardUi, setDashboardUi] = useState({
    activeStep: null,
    stepRows: [],
    snapshot: null,
    loading: false,
    error: '',
    selectedAppId: null,
    totalKpis: null,
    complianceSummary: null,
    activeControlByCategory: [],
    systemSnapshot: null,
    recentRequirementTicker: [],
  });
  const [apps, setApps] = useState([]);
  const [appSelectorOpen, setAppSelectorOpen] = useState(false);
  const [appSelectorLoading, setAppSelectorLoading] = useState(false);
  const [appFilterText, setAppFilterText] = useState('');
  const queryAppHydratedRef = useRef(false);
  const appSelectorRef = useRef(null);
  const queryAppId = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return new URLSearchParams(window.location.search).get('app_id');
  }, []);

  const upsertAppQueryParam = useCallback((appId) => {
    if (typeof window === 'undefined') {
      return;
    }
    const url = new URL(window.location.href);
    if (appId) {
      url.searchParams.set('app_id', appId);
    } else {
      url.searchParams.delete('app_id');
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const loadApps = useCallback(async () => {
    setAppSelectorLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/v1/applications');
      const data = await res.json();
      const activeApps = Array.isArray(data)
        ? data.filter((app) => app?.status === 'active')
        : [];
      setApps(activeApps);

      if (queryAppId && !queryAppHydratedRef.current) {
        const matched = activeApps.find((app) => app.id === queryAppId);
        if (matched) {
          selectApp(matched);
        }
        queryAppHydratedRef.current = true;
      } else if (selectedApp && selectedApp.status !== 'active' && activeApps.length > 0) {
        selectApp(activeApps[0]);
      }
    } catch {
      // no-op
    } finally {
      setAppSelectorLoading(false);
    }
  }, [queryAppId, selectApp, selectedApp]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!appSelectorRef.current?.contains(event.target)) {
        setAppSelectorOpen(false);
      }
    };
    if (appSelectorOpen) {
      window.addEventListener('mousedown', onClickOutside);
    }
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [appSelectorOpen]);

  const filteredApps = useMemo(() => {
    const needle = appFilterText.trim().toLowerCase();
    if (!needle) {
      return apps;
    }
    return apps.filter((app) => {
      const haystack = `${app?.name || ''} ${app?.id || ''} ${app?.owner_email || ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [apps, appFilterText]);
  const connectedAppUrl = useMemo(() => {
    if (!selectedApp?.id) {
      return null;
    }
    const returnUrl = encodeURIComponent(`http://localhost:5173/?app_id=${selectedApp.id}`);
    return `http://localhost:8010/?app_id=${selectedApp.id}&return_url=${returnUrl}`;
  }, [selectedApp?.id]);

  const goHome = () => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('app_id');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setActiveTab('home');
    setRequestedStep(null);
    setDashboardUi((prev) => ({
      ...prev,
      activeStep: null,
      selectedAppId: selectedApp?.id || null,
    }));
  };

  const mainTabs = [
    { id: 'home', label: 'Home', Icon: Icons.Home },
    { id: 'requirements', label: 'Controls', Icon: Icons.Requirements },
    ...(canAdmin ? [{ id: 'risk', label: 'Risk', Icon: Icons.Risk }] : []),
    { id: 'dashboards', label: 'Governance', Icon: Icons.Dashboards },
  ];
  const adminTabs = canAdmin ? [{ id: 'admin', label: 'Admin', Icon: Icons.Admin }] : [];

  const stepStatusByNum = useMemo(() => {
    const map = new Map();
    (dashboardUi.stepRows || []).forEach((row) => {
      map.set(row.num, row.status);
    });
    return map;
  }, [dashboardUi.stepRows]);

  const NavTab = ({ tab, color }) => {
    const isHomeTab = tab.id === 'home';
    const isActive = activeTab === tab.id;

    const handleClick = () => {
      if (isHomeTab) {
        goHome();
        return;
      }
      setActiveTab(tab.id);
    };

    return (
      <button
        onClick={handleClick}
        className="nav-tab"
        style={{
          color: isActive ? color : undefined,
          borderBottomColor: isActive ? color : undefined,
          fontWeight: isActive ? 600 : 400,
        }}
      >
        <tab.Icon />
        {tab.label}
      </button>
    );
  };

  NavTab.propTypes = {
    tab: PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      Icon: PropTypes.func,
    }).isRequired,
    color: PropTypes.string,
  };

  const renderTab = () => {
    const handleHomeNavigate = (tabName) => {
      const key = String(tabName || '').trim().toLowerCase();
      if (key === 'controls') {
        setActiveTab('requirements');
        return;
      }
      if (key === 'governance') {
        setActiveTab('dashboards');
        return;
      }
      if (key === 'risk') {
        if (canAdmin) {
          setActiveTab('risk');
        }
        return;
      }
      if (key === 'applications') {
        if (canAdmin) {
          setActiveTab('admin');
        }
        return;
      }
    };

    switch (activeTab) {
      case 'home':
        return (
          <>
            <div style={{ display: 'none' }} aria-hidden="true">
              <DashboardsTab requestedStep={null} onDashboardUiChange={setDashboardUi} mode="home" />
            </div>
            <HomePage onNavigate={handleHomeNavigate} />
          </>
        );
      case 'dashboards':
        return <DashboardsTab requestedStep={requestedStep} onDashboardUiChange={setDashboardUi} mode="governance" />;
      case 'requirements':
        return <CatalogSearchPanel />;
      case 'risk':
        return canAdmin ? <AlignmentWeightsPanel /> : null;
      case 'admin':
        return canAdmin ? <AdminTab onNavigate={setActiveTab} /> : null;
      default:
        return <DashboardsTab requestedStep={requestedStep} onDashboardUiChange={setDashboardUi} mode="governance" />;
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-top">
          <div className="header-brand">
            <img src="/un-emblem.png" alt="UN Emblem" style={{ height: 34, width: 'auto' }} />
            <div>
              <h1>Universal Responsible AI Governance Solution</h1>
            </div>
          </div>

          <div className="header-actions">
            <span className="chip" style={{ fontSize: '0.72rem', background: 'var(--un-blue-light)', borderColor: 'var(--un-blue)', color: 'var(--un-blue-dark)' }}>
              {currentUser.role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>

            <span className="header-user-name" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
              {currentUser.name}
            </span>
          </div>
        </div>

        <div className="header-nav">
          <div className="nav-zone" style={{ paddingLeft: '0.5rem' }}>
            <div className="nav-zone-tabs">
              {mainTabs.map((tab) => <NavTab key={tab.id} tab={tab} color={GOV_COLOR} />)}
            </div>
          </div>
          <div className="nav-zone app-global-selector-zone" ref={appSelectorRef} style={{ marginLeft: 'auto', paddingRight: '0.5rem' }}>
            <div className="app-global-selector-inline">
              <button
                type="button"
                className={`app-global-selector-btn${appSelectorOpen ? ' open' : ''}`}
                onClick={() => {
                  const next = !appSelectorOpen;
                  setAppSelectorOpen(next);
                  if (next) {
                    setAppFilterText('');
                    loadApps();
                  }
                }}
                title="Select connected application (global context)."
              >
                <span className="app-global-selector-icon">
                  <Icons.AppSelect />
                </span>
                <span className="app-global-selector-copy">
                  <span className="app-global-selector-label">Select App</span>
                  <span className="app-global-selector-value">
                    {selectedApp?.name || 'No app selected'}
                  </span>
                </span>
                <Icons.ChevronDown />
              </button>
              <a
                href={connectedAppUrl || '#'}
                className={`app-global-open-btn${connectedAppUrl ? '' : ' disabled'}`}
                onClick={(event) => {
                  if (!connectedAppUrl) {
                    event.preventDefault();
                  }
                }}
                title={connectedAppUrl ? 'Open connected demo app' : 'Select an app first to open the demo app'}
              >
                <Icons.OpenApp />
              </a>
            </div>
            {appSelectorOpen && (
              <div className="app-global-selector-menu">
                <div className="app-global-selector-filter-wrap">
                  <input
                    type="text"
                    className="app-global-selector-filter"
                    placeholder="Filter apps..."
                    value={appFilterText}
                    onChange={(event) => setAppFilterText(event.target.value)}
                  />
                </div>
                <div className="app-global-selector-list">
                  {appSelectorLoading ? (
                    <div className="app-global-selector-empty">Loading apps...</div>
                  ) : filteredApps.length ? (
                    filteredApps.map((app) => (
                      <button
                        key={app.id}
                        type="button"
                        className={`app-global-selector-item${selectedApp?.id === app.id ? ' active' : ''}`}
                        onClick={() => {
                          selectApp(app);
                          upsertAppQueryParam(app.id);
                          setAppSelectorOpen(false);
                        }}
                      >
                        <span className="app-global-selector-item-name">{app.name}</span>
                        <span className="app-global-selector-item-meta">
                          {normalizeRiskTier(app.current_tier) || 'Untiered'} - {app.status}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="app-global-selector-empty">No matching active apps.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          {adminTabs.length > 0 && (
            <>
              <div className="nav-divider" />
              <div className="nav-zone" style={{ paddingRight: '0.5rem' }}>
                <div className="nav-zone-tabs">
                  {adminTabs.map((tab) => <NavTab key={tab.id} tab={tab} color={GOV_COLOR} />)}
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="app-body">
        {activeTab === 'dashboards' && (
          <AppSidebar
            onStepNavigate={(stepNum) => {
              setActiveTab('dashboards');
              setRequestedStep({ stepNum, token: Date.now() });
              setDashboardUi((prev) => ({ ...prev, activeStep: stepNum }));
            }}
            activeStep={dashboardUi.activeStep}
            stepStatusByNum={stepStatusByNum}
            dashboardUi={dashboardUi}
          />
        )}

        {activeTab === 'requirements' && (
          <DashboardSidebar
            dashboardUi={dashboardUi}
            mode={activeTab}
            onOpenControls={() => setActiveTab('requirements')}
          />
        )}

        <main style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem', maxWidth: (activeTab === 'dashboards' || activeTab === 'home') ? 'none' : 1200, margin: '0 auto', width: '100%' }}>
          {renderTab()}
        </main>
      </div>

      <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)', padding: '0.875rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
          UN AI Governance Platform - Built by{' '}
          <a href="https://linkedin.com/in/tristangitman" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}>
            Tristan Gitman
          </a>
          {' '} - OICT
        </p>
        <a href="http://localhost:8000/docs" target="_blank" rel="noreferrer" style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textDecoration: 'none' }}>
          API Docs {'->'}
        </a>
      </footer>
    </div>
  );
}

function AppSidebar({ onStepNavigate, activeStep, stepStatusByNum, dashboardUi }) {
  const { selectedApp } = useApp();

  const snapshot = dashboardUi.snapshot || {};
  const combinedCompliancePct = typeof dashboardUi.complianceSummary?.combined_category_avg_pct === 'number'
    ? dashboardUi.complianceSummary.combined_category_avg_pct
    : null;
  const derivedRiskTier = normalizeRiskTier(dashboardUi.complianceSummary?.derived_risk_tier);
  const currentTier = derivedRiskTier
    || normalizeRiskTier(snapshot.tier?.current_tier || selectedApp?.current_tier)
    || 'N/A';
  const complianceValue = (typeof combinedCompliancePct === 'number')
    ? `${Math.round(combinedCompliancePct)}%`
    : 'N/A';
  const kpiTotal = typeof dashboardUi.totalKpis === 'number' && dashboardUi.totalKpis > 0
    ? dashboardUi.totalKpis
    : null;
  const kpiValue = kpiTotal !== null ? `${kpiTotal} KPIs` : 'N/A';

  return (
    <aside className="app-sidebar" style={{ padding: '1rem 0' }}>
      <div>
        <div className="sidebar-section-label" style={{ padding: '0 1.25rem', marginBottom: '0.4rem' }}>
          Governance Categories
        </div>
        {STEPS.map((step) => (
          <SidebarStep
            key={step.num}
            step={step}
            status={stepStatusByNum.get(step.num) || 'pending'}
            active={activeStep === step.num}
            onSelect={onStepNavigate}
          />
        ))}
      </div>

      <div className="divider" style={{ margin: '0.75rem 0.75rem' }} />

      <div>
        <div className="sidebar-section-label" style={{ padding: '0 1.25rem', marginBottom: '0.4rem' }}>
          STATUS
        </div>
        <div style={{ padding: '0 0.85rem', display: 'grid', gap: '0.45rem' }}>
          <StatusMetricRow
            Icon={Icons.Tier}
            label="Risk Tier"
            value={currentTier}
            legend="Risk tier recalculated from combined compliance score across all 9 governance categories."
          />
          <StatusMetricRow
            Icon={Icons.Compliance}
            label="Compliance"
            value={complianceValue}
            legend="Combined average compliance score across all 9 governance categories (equal weighting)."
          />
          <StatusMetricRow
            Icon={Icons.Kpi}
            label="KPIs"
            value={kpiValue}
            legend="Total KPI controls currently loaded across governance category dashboards."
          />
        </div>
      </div>

    </aside>
  );
}

function StatusMetricRow({ Icon, label, value, legend }) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-2)',
      padding: '0.45rem 0.55rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.45rem',
      minHeight: 34,
    }}>
      <span
        title={legend}
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'var(--un-blue-light)',
          color: 'var(--un-blue)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'help',
        }}
      >
        <Icon />
      </span>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function DashboardSidebar({ dashboardUi, mode, onOpenControls }) {
  const systemSnapshot = dashboardUi.systemSnapshot || {};
  const activeControlsByCategory = Array.isArray(dashboardUi.activeControlByCategory)
    ? dashboardUi.activeControlByCategory
    : [];
  const activeControlsSummary = activeControlsByCategory.reduce((acc, row) => {
    acc.active += Number(row?.activeTotal || 0);
    acc.inactive += Number(row?.inactiveTotal || 0);
    return acc;
  }, { active: 0, inactive: 0 });
  const compactActiveRows = activeControlsByCategory
    .map((row) => ({
      category: String(row?.category || ''),
      short: String(row?.category || '')
        .replace(/^Risk\s*&\s*Compliance$/i, 'Risk')
        .replace(/^Corporate\s+Oversight$/i, 'Oversight')
        .replace(/^Technical\s+Architecture$/i, 'Architecture')
        .replace(/^Data\s+Readiness$/i, 'Readiness')
        .replace(/^Data\s+Integration$/i, 'Integration')
        .replace(/^Solution\s+Design$/i, 'Design')
        .replace(/^System\s+Performance$/i, 'Performance'),
      active: Number(row?.activeTotal || 0),
      inactive: Number(row?.inactiveTotal || 0),
      total: Number(row?.total || 0),
    }))
    .filter((row) => row.total > 0);
  const snapshotConnectedApps = Number(systemSnapshot.connectedApps || 0);
  const snapshotBarMax = Math.max(1, snapshotConnectedApps, activeControlsSummary.active, activeControlsSummary.inactive);
  const snapshotBars = [
    {
      key: 'apps',
      label: 'Apps',
      value: snapshotConnectedApps,
      pct: Math.max(8, Math.round((snapshotConnectedApps / snapshotBarMax) * 100)),
      color: 'linear-gradient(180deg, #0ea5e9 0%, #0284c7 100%)',
      legend: 'Total connected applications in the platform.',
    },
    {
      key: 'active-controls',
      label: 'Active',
      value: activeControlsSummary.active,
      pct: Math.max(8, Math.round((activeControlsSummary.active / snapshotBarMax) * 100)),
      color: 'linear-gradient(180deg, #22c55e 0%, #16a34a 100%)',
      legend: 'Total active controls across all categories.',
    },
    {
      key: 'inactive-controls',
      label: 'Inactive',
      value: activeControlsSummary.inactive,
      pct: Math.max(8, Math.round((activeControlsSummary.inactive / snapshotBarMax) * 100)),
      color: 'linear-gradient(180deg, #94a3b8 0%, #64748b 100%)',
      legend: 'Total inactive controls across all categories.',
    },
  ];

  const recentTickerItems = Array.isArray(dashboardUi.recentRequirementTicker)
    ? dashboardUi.recentRequirementTicker
    : [];

  if (mode === 'home') {
    return (
      <aside className="app-sidebar" style={{ padding: '0 0 0.8rem' }}>
        <div>
          <div className="sidebar-section-label" style={{ padding: '0.35rem 1.25rem 0 1.25rem', marginBottom: '0.35rem' }}>
            TRENDING REQUIREMENTS
          </div>
          <div style={{ padding: '0 0.85rem' }}>
            <div className="dashboard-sidebar-trending">
              {recentTickerItems.length ? (
                <div className="dashboard-sidebar-trending-window">
                  <div className="dashboard-sidebar-trending-track">
                    {[...recentTickerItems, ...recentTickerItems].map((item, idx) => (
                      <div key={`sidebar-trending-${item?.id || 'req'}-${idx}`} className="dashboard-sidebar-trending-item">
                        <div className="dashboard-sidebar-trending-item-header">
                          <strong>{item?.title || 'Untitled requirement'}</strong>
                          <button
                            type="button"
                            className="dashboard-sidebar-trending-open"
                            onClick={() => {
                              if (onOpenControls) onOpenControls();
                            }}
                            title="Open Controls tab"
                            aria-label="Open Controls tab"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 4h6v6" />
                              <path d="M10 14 20 4" />
                              <path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5" />
                            </svg>
                          </button>
                        </div>
                        <span>{item?.description || 'No description available.'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="dashboard-sidebar-trending-empty">
                  No requirement updates available.
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="app-sidebar" style={{ padding: '1rem 0' }}>
      <div>
        <div className="sidebar-section-label" style={{ padding: '0 1.25rem', marginBottom: '0.35rem' }}>
          SYSTEM SNAPSHOT
        </div>
        <div style={{ padding: '0 0.85rem', display: 'grid', gap: '0.35rem' }}>
          <div style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(148,163,184,0.06) 100%)',
            padding: '0.45rem 0.5rem',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: '0.35rem',
              height: 58,
              marginBottom: '0.35rem',
            }}>
              {snapshotBars.map((bar) => (
                <div key={bar.key} style={{ display: 'grid', gap: '0.18rem', justifyItems: 'center', flex: 1 }} title={bar.legend}>
                  <div style={{
                    width: 18,
                    height: 44,
                    borderRadius: 999,
                    background: 'rgba(148,163,184,0.2)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'flex-end',
                  }}>
                    <span style={{ width: '100%', height: `${bar.pct}%`, background: bar.color, borderRadius: 999 }} />
                  </div>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>{bar.label}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gap: '0.18rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                <span>Connected Apps</span>
                <strong style={{ color: 'var(--text-primary)' }}>{snapshotConnectedApps}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                <span>Active Controls</span>
                <strong style={{ color: 'var(--success)' }}>{activeControlsSummary.active}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                <span>Inactive Controls</span>
                <strong style={{ color: 'var(--text-tertiary)' }}>{activeControlsSummary.inactive}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="divider" style={{ margin: '0.75rem 0.75rem' }} />

      <div>
        <div className="sidebar-section-label" style={{ padding: '0 1.25rem', marginBottom: '0.35rem' }}>
          ACTIVE CONTROLS
        </div>
        <div style={{
          padding: '0 0.85rem',
          display: 'grid',
          gap: '0.35rem',
        }}>
          <div style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--surface-2)',
            padding: '0.4rem 0.55rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.7rem',
            color: 'var(--text-secondary)',
          }}>
            <span>Active: <strong style={{ color: 'var(--success)' }}>{activeControlsSummary.active}</strong></span>
            <span>Inactive: <strong style={{ color: 'var(--text-tertiary)' }}>{activeControlsSummary.inactive}</strong></span>
          </div>
          {compactActiveRows.length ? (
            compactActiveRows.map((row) => {
              const total = Math.max(1, row.total);
              const activePct = Math.round((row.active / total) * 100);
              const inactivePct = Math.max(0, 100 - activePct);
              return (
                <div
                  key={`dashboard-sidebar-active-controls-${row.category}`}
                  title={`${row.category}: Active ${row.active}, Inactive ${row.inactive}`}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--surface-2)',
                    padding: '0.28rem 0.45rem',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.66rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '0.18rem',
                  }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{row.short}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.active}/{row.total}</span>
                  </div>
                  <div style={{
                    height: 5,
                    width: '100%',
                    borderRadius: 999,
                    overflow: 'hidden',
                    background: 'rgba(148, 163, 184, 0.26)',
                    display: 'flex',
                  }}>
                    <span style={{ width: `${activePct}%`, background: 'linear-gradient(90deg, #22c55e, #16a34a)' }} />
                    <span style={{ width: `${inactivePct}%`, background: 'rgba(148, 163, 184, 0.58)' }} />
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', padding: '0.2rem 0.15rem' }}>
              No control activity yet.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

DashboardSidebar.propTypes = {
  dashboardUi: PropTypes.shape({
    systemSnapshot: PropTypes.object,
    activeControlByCategory: PropTypes.array,
    recentRequirementTicker: PropTypes.array,
  }),
  mode: PropTypes.oneOf(['home', 'requirements']),
  onOpenControls: PropTypes.func,
};

DashboardSidebar.defaultProps = {
  dashboardUi: {},
  mode: 'requirements',
  onOpenControls: null,
};

function SidebarStep({ step, status, active, onSelect }) {
  const theme = stepStatusTheme(status);
  return (
    <button
      className={`sidebar-item${active ? ' active' : ''}`}
      style={{
        padding: '0.4rem 0.75rem',
        borderRadius: 0,
        borderLeft: active ? '2px solid var(--un-blue)' : '2px solid transparent',
      }}
      onClick={() => onSelect(step.num)}
    >
      <span style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: active ? 'var(--un-blue)' : theme.bubbleBg,
        color: active ? '#fff' : theme.bubbleColor,
        fontSize: '0.68rem',
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontFamily: 'Syne, sans-serif',
      }}>
        {step.num}
      </span>
      <span style={{ fontSize: '0.78rem', color: active ? 'var(--un-blue)' : theme.text, fontWeight: active ? 600 : 500 }}>
        {step.label}
      </span>
      <span
        title={`Status: ${status}`}
        style={{
          marginLeft: 'auto',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: active ? 'var(--un-blue)' : theme.dot,
          flexShrink: 0,
        }}
      />
    </button>
  );
}

StatusMetricRow.propTypes = {
  Icon: PropTypes.func.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  legend: PropTypes.string.isRequired,
};

AppSidebar.propTypes = {
  onStepNavigate: PropTypes.func.isRequired,
  activeStep: PropTypes.number,
  stepStatusByNum: PropTypes.instanceOf(Map),
  dashboardUi: PropTypes.shape({
    totalKpis: PropTypes.number,
    complianceSummary: PropTypes.shape({
      overall_pass_rate: PropTypes.number,
      evaluated_count: PropTypes.number,
      pass_count: PropTypes.number,
      fail_count: PropTypes.number,
      step1_fail_count: PropTypes.number,
      step1_total: PropTypes.number,
      step2_total: PropTypes.number,
      step2_pass_rate: PropTypes.number,
      category_compliance_pct: PropTypes.object,
      combined_category_avg_pct: PropTypes.number,
      derived_risk_tier: PropTypes.string,
    }),
    activeControlByCategory: PropTypes.arrayOf(PropTypes.shape({
      category: PropTypes.string,
      activeTotal: PropTypes.number,
      inactiveTotal: PropTypes.number,
      total: PropTypes.number,
    })),
    systemSnapshot: PropTypes.shape({
      connectedApps: PropTypes.number,
      enterpriseRequirements: PropTypes.number,
      policyTypes: PropTypes.arrayOf(PropTypes.string),
    }),
    snapshot: PropTypes.shape({
      tier: PropTypes.object,
      compliance: PropTypes.object,
      telemetry: PropTypes.object,
    }),
  }),
};

AppSidebar.defaultProps = {
  activeStep: null,
  stepStatusByNum: new Map(),
  dashboardUi: {
    totalKpis: null,
    complianceSummary: null,
    activeControlByCategory: [],
    systemSnapshot: null,
    snapshot: null,
  },
};

DashboardSidebar.propTypes = {
  dashboardUi: PropTypes.shape({
    systemSnapshot: PropTypes.shape({
      connectedApps: PropTypes.number,
      enterpriseRequirements: PropTypes.number,
      policyTypes: PropTypes.arrayOf(PropTypes.string),
    }),
    activeControlByCategory: PropTypes.arrayOf(PropTypes.shape({
      category: PropTypes.string,
      activeTotal: PropTypes.number,
      inactiveTotal: PropTypes.number,
      total: PropTypes.number,
    })),
  }),
};

DashboardSidebar.defaultProps = {
  dashboardUi: {
    systemSnapshot: null,
  },
};

SidebarStep.propTypes = {
  step: PropTypes.shape({
    num: PropTypes.number.isRequired,
    label: PropTypes.string.isRequired,
  }).isRequired,
  status: PropTypes.oneOf(['complete', 'attention', 'pending']),
  active: PropTypes.bool,
  onSelect: PropTypes.func.isRequired,
};

SidebarStep.defaultProps = {
  status: 'pending',
  active: false,
};








