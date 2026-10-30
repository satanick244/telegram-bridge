export const riskBuckets = ['risk_records', 'risk_audit', 'risk_locks'];
export const defaultRiskRules = Object.freeze({
  id: 'rules', kind: 'rules', version: 1, overdueWarningDays: 1, overdueEscalationDays: 7,
  steelShockPct: 5, fxShockPct: 3, freightShockPct: 10,
  trialOnly: true, autoCredit: false, calibrated: false,
});
