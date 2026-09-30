import type { Quote } from "./quote";
import { inContinuousSession, jstDate } from "./market";

/** Measured feed delay for one trading day, in minutes. */
export interface DelayStats {
  date: string;
  samples: number;
  min: number;
  max: number;
  sum: number;
}

/**
 * Folds one observation into the day's stats. The freshest quote is used because the most
 * actively traded symbol prints every minute, so its age is closest to the feed delay.
 * Returns undefined when this tick is not a valid observation.
 */
export function recordDelay(nowMs: number, live: Quote[], prev: DelayStats | null): DelayStats | undefined {
  if (!inContinuousSession(nowMs) || live.length === 0) return undefined;
  const newest = Math.max(...live.map((q) => q.marketTime));
  const lag = Math.round(((nowMs / 1000 - newest) / 60) * 10) / 10;
  if (lag < 0) return undefined;
  const date = jstDate(nowMs);
  const base = prev && prev.date === date ? prev : { date, samples: 0, min: Infinity, max: 0, sum: 0 };
  return { date, samples: base.samples + 1, min: Math.min(base.min, lag), max: Math.max(base.max, lag), sum: base.sum + lag };
}
