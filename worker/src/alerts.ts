/** Per-symbol extremes already alerted today, in units of the alert step. */
export interface AlertState {
  date: string;
  maxUp: number;
  maxDown: number;
}

/**
 * Alert only when the move reaches a new step further than anything alerted today,
 * so a price wobbling around a boundary does not spam.
 */
export function checkAlert(
  changePct: number,
  stepPct: number,
  date: string,
  prev: AlertState | undefined,
): { alert: boolean; state: AlertState } {
  const state: AlertState =
    prev && prev.date === date ? { ...prev } : { date, maxUp: 0, maxDown: 0 };
  if (stepPct <= 0) return { alert: false, state };
  const level = Math.trunc(changePct / stepPct);
  if (level > state.maxUp) {
    state.maxUp = level;
    return { alert: true, state };
  }
  if (level < state.maxDown) {
    state.maxDown = level;
    return { alert: true, state };
  }
  return { alert: false, state };
}
