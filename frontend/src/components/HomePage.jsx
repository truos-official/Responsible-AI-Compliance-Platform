import PropTypes from 'prop-types';

const PIPELINE_STEPS = [
  {
    num: 1,
    label: 'Connect AI Application',
    description: 'Register and link your app',
  },
  {
    num: 2,
    label: 'Select Governance Controls',
    description: 'Map requirements to your app',
  },
  {
    num: 3,
    label: 'Assess Risks',
    description: 'Evaluate conformance level',
  },
  {
    num: 4,
    label: 'Evaluate Performance',
    description: 'Monitor across categories',
  },
];

const APP_ROWS = [
  { name: 'ODS Demo Agent', tier: 'Compliant', score: 74, active: true },
  { name: 'HR Analytics Engine', tier: 'Compliant', score: 68, active: false },
  { name: 'Budget Forecasting AI', tier: 'Compliant', score: 82, active: false },
  { name: 'Translation Assistant', tier: 'Compliant', score: 71, active: false },
];

const REQUIREMENT_ROWS = [
  {
    title: 'Data Privacy Protection Aligned with GDC International Standards',
    chip: 'Data Readiness',
    chipBg: 'var(--primary-light)',
    chipText: 'var(--primary-dark)',
  },
  {
    title: 'AI Impact Assessment for Automated Decision-Making',
    chip: 'Risk & Compliance',
    chipBg: '#fce8e6',
    chipText: '#a32d2d',
  },
  {
    title: 'AI Risk Classification and Assessment',
    chip: 'Corporate Oversight',
    chipBg: '#e6f4ea',
    chipText: '#1e6e3e',
  },
  {
    title: 'Human Oversight and Override Capability',
    chip: 'Solution Design',
    chipBg: '#ede7ff',
    chipText: '#3c3489',
  },
  {
    title: 'Algorithmic Discrimination Prevention',
    chip: 'Risk & Compliance',
    chipBg: '#fce8e6',
    chipText: '#a32d2d',
  },
];

const TREND_BARS = [
  { label: 'Data Privacy', count: 18, category: 'Data Readiness', width: '75%', color: 'var(--primary)' },
  { label: 'Impact Assessment', count: 24, category: 'Risk & Compliance', width: '100%', color: 'var(--danger)' },
  { label: 'Accountability', count: 15, category: 'Corporate Oversight', width: '63%', color: 'var(--success)' },
];

const RISK_ROWS = [
  {
    level: 'Very High',
    score: '>= 75',
    description: 'Critical non-conformance. Immediate remediation required before next review cycle.',
    border: '#f09595',
    bg: 'rgba(252,235,235,0.6)',
    badgeBg: '#f09595',
    text: '#a32d2d',
  },
  {
    level: 'High',
    score: '50–74',
    description: 'Significant gaps across multiple requirements. Remediation plan required within 30 days.',
    border: '#fac775',
    bg: 'rgba(250,238,218,0.6)',
    badgeBg: '#fac775',
    text: '#633806',
  },
  {
    level: 'Medium',
    score: '25–49',
    description: 'Partial non-conformance in one or more categories. Remediation plan within 90 days.',
    border: '#85b7eb',
    bg: 'rgba(230,241,251,0.6)',
    badgeBg: '#85b7eb',
    text: '#0c447c',
  },
  {
    level: 'Low',
    score: '0–24',
    description: 'Substantially conformant with active governance requirements. Continue monitoring.',
    border: '#5dcaa5',
    bg: 'rgba(225,245,238,0.6)',
    badgeBg: '#5dcaa5',
    text: '#04342c',
  },
];

const DISTRIBUTION_ROWS = [
  { abbr: 'VH', label: 'Very High', sub: 'CARS score ≥ 75 — critical action needed', count: 0, bg: '#fce8e6', text: '#a32d2d' },
  { abbr: 'H', label: 'High', sub: 'CARS score 50–74 — material gaps', count: 0, bg: 'rgba(250,238,218,0.8)', text: '#7a4e08' },
  { abbr: 'M', label: 'Medium', sub: 'CARS score 25–49 — partial controls', count: 1, bg: 'rgba(230,241,251,0.8)', text: '#0c447c' },
  { abbr: 'L', label: 'Low', sub: 'CARS score 0–24 — conformant', count: 0, bg: 'rgba(225,245,238,0.8)', text: '#1e6e3e' },
];

const CATEGORY_GRID = [
  { num: '01', name: 'Use Case', reqs: 9, weight: 1.0, accent: false },
  { num: '02', name: 'Risk Classification', reqs: 12, weight: 1.4, accent: true },
  { num: '03', name: 'Technical Architecture', reqs: 7, weight: 1.0, accent: false },
  { num: '04', name: 'Data Readiness', reqs: 11, weight: 1.3, accent: false },
  { num: '05', name: 'Data Integration', reqs: 8, weight: 1.2, accent: false },
  { num: '06', name: 'Security', reqs: 14, weight: 1.5, accent: true },
  { num: '07', name: 'Infrastructure', reqs: 6, weight: 1.0, accent: false },
  { num: '08', name: 'Solution Design', reqs: 9, weight: 1.2, accent: false },
  { num: '09', name: 'System Performance', reqs: 10, weight: 1.0, accent: false },
];

function cardHeader(step, title, rightLabel) {
  return (
    <div style={{
      background: 'var(--surface-2)',
      borderBottom: '0.5px solid var(--border)',
      padding: '10px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '0.7rem',
    }}>
      <div style={{ display: 'grid', gap: '0.2rem' }}>
        <span style={{ fontSize: '0.63rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--un-blue)', fontWeight: 700 }}>
          {step}
        </span>
        <h3 style={{ margin: 0, fontSize: 15, fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--text-primary)' }}>
          {title}
        </h3>
      </div>
      {rightLabel ? (
        <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{rightLabel}</span>
      ) : null}
    </div>
  );
}

function cardFooter(note, actionLabel, onAction) {
  return (
    <div style={{
      background: 'var(--surface-2)',
      borderTop: '0.5px solid var(--border)',
      padding: '8px 20px',
      display: 'flex',
      justifyContent: 'space-between',
      gap: '1rem',
      alignItems: 'center',
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '0.66rem', color: 'var(--text-tertiary)' }}>{note}</span>
      <button
        type="button"
        onClick={onAction}
        style={{
          border: 'none',
          background: 'none',
          color: 'var(--un-blue)',
          fontSize: '0.72rem',
          fontWeight: 700,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {actionLabel}
      </button>
    </div>
  );
}

export default function HomePage({ onNavigate }) {
  return (
    <div style={{ padding: 0, background: 'transparent', minHeight: '100%' }}>
      <div style={{
        background: 'var(--surface)',
        border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '12px 20px',
        marginBottom: '14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: '0.5rem', flexWrap: 'wrap' }}>
          {PIPELINE_STEPS.map((step, idx) => (
            <div key={step.num} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 180 }}>
              <div style={{ display: 'grid', gap: '0.2rem', width: '100%' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: 'var(--un-blue-light)',
                    border: '0.5px solid var(--un-blue)',
                    color: 'var(--un-blue-dark)',
                    fontSize: '0.69rem',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {step.num}
                  </span>
                  <span style={{ fontSize: '0.77rem', fontWeight: 700, color: 'var(--text-primary)' }}>{step.label}</span>
                </div>
                <span style={{ fontSize: '0.66rem', color: 'var(--text-tertiary)' }}>{step.description}</span>
              </div>
              {idx < PIPELINE_STEPS.length - 1 ? (
                <span style={{ color: 'var(--text-tertiary)', margin: '0 0.45rem', fontSize: '0.9rem' }}>›</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <section style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '12px' }}>
        {cardHeader('Step 1', 'Connect AI Application', '1 of 4 apps connected')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ padding: '14px 20px', borderRight: '0.5px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)' }}>Available Applications</span>
              <span style={{ fontSize: '0.66rem', color: 'var(--text-tertiary)' }}>4 registered</span>
            </div>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              {APP_ROWS.map((app) => (
                <div
                  key={app.name}
                  style={{
                    border: app.active ? '1.5px solid var(--un-blue)' : '0.5px solid var(--border)',
                    background: app.active ? 'var(--un-blue-light)' : 'var(--surface-2)',
                    borderRadius: 8,
                    padding: '7px 9px',
                    opacity: app.active ? 1 : 0.4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: 5 }}>
                    <span style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: app.active ? 'var(--success)' : 'var(--text-tertiary)',
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{app.name}</span>
                    <span style={{
                      fontSize: '0.62rem',
                      borderRadius: 999,
                      padding: '1px 6px',
                      background: 'var(--warning-light)',
                      color: '#b45309',
                      fontWeight: 700,
                    }}>
                      {app.tier}
                    </span>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-primary)' }}>{app.score}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 999, background: 'rgba(148,163,184,0.25)', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${app.score}%`, background: app.active ? 'var(--un-blue)' : 'var(--text-tertiary)' }} />
                  </div>
                </div>
              ))}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '0.62rem', fontStyle: 'italic', color: 'var(--text-tertiary)' }}>
              Greyed entries are illustrative — connect apps to activate
            </p>
          </div>

          <div style={{ padding: '14px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)' }}>Top Application — Compliance Score</span>
            </div>
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              {APP_ROWS.map((app, idx) => (
                <div key={`top-${app.name}`} style={{ opacity: idx === 0 ? 1 : 0.35 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: '0.69rem', color: idx === 0 ? 'var(--un-blue)' : 'var(--text-secondary)', fontWeight: 700 }}>{app.name}</span>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-primary)' }}>{app.score}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${app.score}%`, background: idx === 0 ? 'var(--un-blue)' : 'var(--text-tertiary)' }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <button type="button" onClick={() => onNavigate('applications')} style={{ border: 'none', background: 'none', color: 'var(--un-blue)', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer' }}>
                Connect more applications →
              </button>
            </div>
          </div>
        </div>
        {cardFooter(
          'Note: Click any application to select it and open its governance dashboard',
          'Go to Applications →',
          () => onNavigate('applications'),
        )}
      </section>

      <section style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '12px' }}>
        {cardHeader('Step 2', 'Select Governance Controls', '84 active requirements')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ padding: '14px 20px', borderRight: '0.5px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)' }}>Governance Requirements</span>
              <span style={{ fontSize: '0.66rem', color: 'var(--text-tertiary)' }}>5 of 84</span>
            </div>
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              {REQUIREMENT_ROWS.map((row) => (
                <div key={row.title} style={{ border: '0.5px solid var(--border)', background: 'var(--surface-2)', borderRadius: 7, padding: '7px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', lineHeight: 1.35 }}>{row.title}</div>
                      <span style={{ display: 'inline-flex', marginTop: 4, borderRadius: 999, padding: '2px 7px', fontSize: '0.61rem', fontWeight: 700, background: row.chipBg, color: row.chipText }}>
                        {row.chip}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('controls')}
                      style={{
                        flexShrink: 0,
                        borderRadius: 4,
                        border: '0.5px solid var(--un-blue-light)',
                        background: 'var(--un-blue-light)',
                        color: 'var(--un-blue-dark)',
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        padding: '3px 6px',
                        cursor: 'pointer',
                      }}
                    >
                      Manage control →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '14px 20px' }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>Trending Requirements</div>
            <div style={{ display: 'grid', gap: '0.55rem' }}>
              {TREND_BARS.map((trend) => (
                <div key={trend.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)' }}>{trend.label}</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--un-blue)' }}>{trend.count} requirements</span>
                  </div>
                  <div style={{ fontSize: '0.63rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>{trend.category}</div>
                  <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: trend.width, background: trend.color }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <button type="button" onClick={() => onNavigate('controls')} style={{ border: 'none', background: 'none', color: 'var(--un-blue)', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer' }}>
                Browse all requirements →
              </button>
            </div>
          </div>
        </div>
        {cardFooter(
          '"Manage control" opens the control detail in the Controls tab',
          'Go to Controls →',
          () => onNavigate('controls'),
        )}
      </section>

      <section style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '12px' }}>
        {cardHeader('Step 3', 'Assess Risks', '1 application evaluated')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ padding: '14px 20px', borderRight: '0.5px solid var(--border)', display: 'grid', gap: '0.35rem' }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Risk Level Definitions</div>
            {RISK_ROWS.map((row) => (
              <div key={row.level} style={{ border: `0.5px solid ${row.border}`, background: row.bg, borderRadius: 8, padding: '7px 9px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: 4 }}>
                  <span style={{ borderRadius: 999, padding: '1px 7px', background: row.badgeBg, color: row.text, fontSize: '0.61rem', fontWeight: 700 }}>{row.level}</span>
                  <span style={{ fontSize: '0.64rem', color: row.text, fontWeight: 700 }}>{row.score}</span>
                </div>
                <div style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', lineHeight: 1.35 }}>{row.description}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: '14px 20px' }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Applications by Risk Level</div>
            <div style={{ display: 'grid', gap: '0.1rem' }}>
              {DISTRIBUTION_ROWS.map((row) => (
                <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) auto', gap: '0.5rem', alignItems: 'center', padding: '7px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: row.bg, color: row.text, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.74rem', fontWeight: 700 }}>
                    {row.abbr}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-primary)', fontWeight: 700 }}>{row.label}</div>
                    <div style={{ fontSize: '0.63rem', color: 'var(--text-tertiary)' }}>{row.sub}</div>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 700 }}>{row.count}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {cardFooter(
          'Risk score (CARS) is calculated across 9 governance categories using weighted metric conformance',
          'Open Risk definitions →',
          () => onNavigate('risk'),
        )}
      </section>

      <section style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        {cardHeader('Step 4', 'Evaluate Performance', '9 governance categories')}
        <div style={{ padding: '14px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '0.5rem', marginBottom: '0.6rem' }}>
            {[
              { value: '74', label: 'ODS Demo Agent compliance score', color: 'var(--un-blue)' },
              { value: '84', label: 'Total active requirements', color: 'var(--text-primary)' },
              { value: '1', label: 'Apps with open risks', color: 'var(--warning)' },
            ].map((tile) => (
              <div key={tile.label} style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--border)', padding: '10px 14px' }}>
                <div style={{ fontSize: 20, fontWeight: 500, color: tile.color, lineHeight: 1.1 }}>{tile.value}</div>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginTop: 2 }}>{tile.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '0.45rem' }}>
            {CATEGORY_GRID.map((cat) => (
              <button
                key={cat.num}
                type="button"
                onClick={() => onNavigate('governance')}
                style={{
                  textAlign: 'left',
                  background: 'var(--surface-2)',
                  border: cat.accent ? '0.5px solid #f09595' : '0.5px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = 'var(--un-blue)';
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = cat.accent ? '#f09595' : 'var(--border)';
                }}
              >
                <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start' }}>
                  <span style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: cat.accent ? '#fce8e6' : 'var(--un-blue-light)',
                    color: cat.accent ? '#a32d2d' : 'var(--un-blue-dark)',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {cat.num}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.69rem', fontWeight: 500, color: 'var(--text-primary)' }}>{cat.name}</div>
                    <div style={{ fontSize: '0.61rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {cat.reqs} requirements
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
        {cardFooter(
          'Each category links to the full governance dashboard for your selected application',
          'Open Governance dashboard →',
          () => onNavigate('governance'),
        )}
      </section>
    </div>
  );
}

HomePage.propTypes = {
  onNavigate: PropTypes.func,
};

HomePage.defaultProps = {
  onNavigate: () => {},
};
