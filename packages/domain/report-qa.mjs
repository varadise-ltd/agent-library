export const QA_STATES = Object.freeze(['Passed', 'Passed with accepted warnings', 'Repair required', 'Blocked', 'Failed']);

export function finding({ severity = 'error', field = null, region = null, expectedRule, actualResult, recommendedCorrection, automaticRepairAvailable = false } = {}) {
  return { severity, field, region, expectedRule: String(expectedRule || ''), actualResult: String(actualResult || ''), recommendedCorrection: String(recommendedCorrection || ''), automaticRepairAvailable: Boolean(automaticRepairAvailable) };
}

export function summarizeFindings(findings = []) {
  const items = Array.isArray(findings) ? findings : [];
  const hasBlocking = items.some(item => ['blocked', 'fatal'].includes(String(item.severity).toLowerCase()));
  const hasErrors = items.some(item => ['error', 'critical'].includes(String(item.severity).toLowerCase()));
  const hasWarnings = items.some(item => String(item.severity).toLowerCase() === 'warning');
  const state = hasBlocking ? 'Blocked' : hasErrors ? 'Repair required' : hasWarnings ? 'Passed with accepted warnings' : 'Passed';
  return { state, findings: items, checkedAt: new Date().toISOString() };
}

export function protectedLabelCheck(expected, actual, field = 'protected label') {
  const pass = String(expected ?? '') === String(actual ?? '');
  return finding({ severity: pass ? 'info' : 'error', field, expectedRule: 'Protected label content must remain unchanged.', actualResult: pass ? 'Unchanged.' : `Changed from “${expected}” to “${actual}”.`, recommendedCorrection: pass ? '' : 'Restore the published template revision and render into the value region only.', automaticRepairAvailable: !pass });
}
