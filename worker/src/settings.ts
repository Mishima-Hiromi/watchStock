// User-editable settings, kept in KV. wrangler.toml [vars] only provide the initial defaults.

export interface Symbol {
  code: string;
  label: string;
}

export interface Settings {
  symbols: Symbol[];
  /** 0 = no summaries. Multiple of 5 (the cron interval). */
  summaryEveryMin: number;
  /** 0 = no alerts. */
  alertStepPct: number;
}

export interface SettingsDefaults {
  SYMBOLS: string;
  SUMMARY_EVERY_MIN: string;
  ALERT_STEP_PCT: string;
}

export const MAX_SYMBOLS = 10;

export function parseSymbols(s: string): Symbol[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [code, label = ""] = x.split(":").map((y) => y.trim());
      return { code, label };
    });
}

export function defaults(env: SettingsDefaults): Settings {
  return {
    symbols: parseSymbols(env.SYMBOLS),
    summaryEveryMin: Number(env.SUMMARY_EVERY_MIN),
    alertStepPct: Number(env.ALERT_STEP_PCT),
  };
}

export async function getSettings(kv: KVNamespace, env: SettingsDefaults): Promise<Settings> {
  return { ...defaults(env), ...((await kv.get<Partial<Settings>>("settings", "json")) ?? {}) };
}

/** Checks shape and ranges. Whether each code actually exists is checked by the caller. */
export function validateSettings(input: any): { settings?: Settings; errors: string[] } {
  const errors: string[] = [];
  const symbols: Symbol[] = [];
  if (!Array.isArray(input?.symbols) || input.symbols.length === 0) {
    errors.push("銘柄を 1 つ以上指定してください");
  } else if (input.symbols.length > MAX_SYMBOLS) {
    errors.push(`銘柄は ${MAX_SYMBOLS} 個までです`);
  } else {
    for (const s of input.symbols) {
      const code = String(s?.code ?? "").trim().toUpperCase();
      const label = String(s?.label ?? "").trim().slice(0, 20);
      // TSE codes: 4 characters, digits plus letters for newer listings (e.g. 130A).
      if (!/^[0-9][0-9A-Z]{3}$/.test(code)) errors.push(`銘柄コード「${code}」の形式が正しくありません`);
      else if (symbols.some((x) => x.code === code)) errors.push(`銘柄コード「${code}」が重複しています`);
      else symbols.push({ code, label });
    }
  }
  const summaryEveryMin = Number(input?.summaryEveryMin);
  if (!Number.isInteger(summaryEveryMin) || summaryEveryMin < 0 || summaryEveryMin > 420 || summaryEveryMin % 5 !== 0) {
    errors.push("まとめの間隔は 0〜420 分、5 分単位で指定してください");
  }
  const alertStepPct = Number(input?.alertStepPct);
  if (!Number.isFinite(alertStepPct) || alertStepPct < 0 || alertStepPct > 20 || (alertStepPct > 0 && alertStepPct < 0.5)) {
    errors.push("アラートの刻みは 0（なし）か 0.5〜20% で指定してください");
  }
  return errors.length ? { errors } : { settings: { symbols, summaryEveryMin, alertStepPct }, errors };
}
