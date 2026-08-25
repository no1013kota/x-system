/**
 * 診断結果の**型と、全体まとめの文言**（R31）。
 *
 * `diagnostics.ts` は `import "server-only";` を持つため、`scripts/doctor.mjs` から
 * 直接 import できない。その結果「まとめ1行」の3分岐だけが doctor.mjs へ**同じ文字列で
 * 再実装**されていた。doctor.mjs のヘッダは「判定と文言は diagnostics.ts に集約されている
 * （この script は表示だけ）」と書いているのに、**運営者が最も見る1行**だけが二重だった。
 *
 * このモジュールは**import を1つも持たない**。`server-only` も `@/` エイリアスも
 * 持ち込まないこと（どちらも Node から直接読めなくなる）。
 */

export type Level = "ok" | "warn" | "error";

export interface Check {
  /** 運営者が読む見出し。 */
  name: string;
  level: Level;
  /** いまの状態。数字は必ず入れる（「問題なし」だけにしない）。 */
  detail: string;
  /** 異常時に次にやること。1行で、コマンドか画面操作を具体的に書く。 */
  nextAction?: string;
}

/** 最も重いレベルを返す（error > warn > ok）。 */
export function worstLevel(levels: Level[]): Level {
  if (levels.includes("error")) return "error";
  if (levels.includes("warn")) return "warn";
  return "ok";
}

/** 全体の1行まとめ。件数を必ず出す（「問題なし」だけで終わらせない）。 */
export function summarize(checks: Check[]): string {
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  if (errors > 0) return `対応が必要な問題が ${errors} 件あります（注意 ${warns} 件）`;
  if (warns > 0) return `すぐ困る問題はありませんが、注意が ${warns} 件あります`;
  return `${checks.length} 項目すべて正常です`;
}

/** まとめの結果から終了コードを決める（error があれば 1）。 */
export function exitCodeFor(checks: Check[]): 0 | 1 {
  return checks.some((c) => c.level === "error") ? 1 : 0;
}

/**
 * USD → 円のおおよその換算（R30）。
 *
 * 当月の費用を運営者へ見せる経路が2つ（doctor と日次サマリ）あり、**どちらも
 * `Math.round(usd * 150)` を別々に持っていた**。片方だけ直すと、同じ月の費用を
 * 2つの通知が違う円額で伝える（CLAUDE.md 原則4の可視化が食い違う）。
 *
 * 為替を取りに行かない意図的な概算。丸めの位置も変えないこと。
 */
export const USD_TO_JPY = 150;

export function approxYen(usd: number): number {
  return Math.round(usd * USD_TO_JPY);
}

