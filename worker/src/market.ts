const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** "YYYY-MM-DD" in JST. */
export function jstDate(epochMs: number): string {
  return new Date(epochMs + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "HH:MM" in JST. */
export function jstTime(epochMs: number): string {
  return new Date(epochMs + JST_OFFSET_MS).toISOString().slice(11, 16);
}

/** Minutes since 00:00 JST. */
export function jstMinutes(epochMs: number): number {
  const d = new Date(epochMs + JST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// TSE trades 9:00-15:30 JST; delayed data keeps arriving until ~15:50, so watch until 16:00.
export const WATCH_START = 9 * 60;
export const WATCH_END = 16 * 60;

export function inWatchWindow(epochMs: number): boolean {
  const m = jstMinutes(epochMs);
  return m >= WATCH_START && m <= WATCH_END;
}

/** True on ticks aligned to `everyMin` minutes counted from 9:00 JST. */
export function isSummaryTick(epochMs: number, everyMin: number): boolean {
  if (everyMin <= 0) return false;
  const m = jstMinutes(epochMs);
  return inWatchWindow(epochMs) && (m - WATCH_START) % everyMin === 0;
}

/**
 * Minutes when trades print continuously, with margins around the open, lunch break and close,
 * so "now minus latest trade time" measures the feed delay rather than a pause in trading.
 */
export function inContinuousSession(epochMs: number): boolean {
  const m = jstMinutes(epochMs);
  return (m >= 9 * 60 + 30 && m <= 11 * 60 + 25) || (m >= 12 * 60 + 50 && m <= 15 * 60 + 25);
}
