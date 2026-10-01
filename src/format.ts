import type { Quote } from "./quote";
import { jstTime } from "./market";

const num = (n: number) =>
  n.toLocaleString("ja-JP", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** One line per quote, sized for a watch screen: "トヨタ 2,989.5 ▲20.5 +0.69% 15:30" */
export function formatLine(q: Quote): string {
  const arrow = q.change > 0 ? "▲" : q.change < 0 ? "▼" : "±";
  const pct = `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%`;
  return `${q.label} ${num(q.price)} ${arrow}${num(Math.abs(q.change))} ${pct} ${jstTime(q.marketTime * 1000)}`;
}

export function formatLines(results: Array<Quote | Error>): string {
  return results.map((r) => (r instanceof Error ? `⚠ ${r.message}` : formatLine(r))).join("\n");
}
