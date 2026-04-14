import PropTypes from 'prop-types';
import GovernanceTab from './GovernanceTab.jsx';

export default function DashboardsTab({ requestedStep, onDashboardUiChange, mode }) {
  return <GovernanceTab requestedStep={requestedStep} onDashboardUiChange={onDashboardUiChange} mode={mode} />;
}

DashboardsTab.propTypes = {
  requestedStep: PropTypes.shape({
    stepNum: PropTypes.number,
    token: PropTypes.number,
  }),
  onDashboardUiChange: PropTypes.func,
  mode: PropTypes.oneOf(['home', 'governance']),
};

DashboardsTab.defaultProps = {
  requestedStep: null,
  onDashboardUiChange: null,
  mode: 'governance',
};
