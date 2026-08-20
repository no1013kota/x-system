import type { Check } from "./diagnostics";

/**
 * `doctor` の判定を運営者へ**届ける**（T-M8-164）。
 *
 * 判定は揃っているのに届いていなかった。`diagnostics.ts` の結果は `/api/cron/doctor` からしか
 * 使われず、それを叩くのは `npm run doctor` だけで、`vercel.json` の定時実行にも入っていない。
 * その結果 **2026-08-19 10:00 JST から1.5日間ニュースが全滅していたのに運営者へ何も届かなかった**
 * （運営者が自分でコマンドを打って初めて分かった）。CLAUDE.md 原則1「運営者が気付ける経路
 * （通知・サマリ）へ載せる」に反する。
 *
 * **毎朝の日次サマリには乗せない。** あれは`X連携済みの全利用者`へ配るもので、
 * 運営者向けの診断を混ぜると利用者へ運用の内情が届く。宛先は運営者だけにする。
 *
 * この層は**文面を作るだけ**（DB・SMTP・envを触らない）。何を送るかの判断をテストで固定できる形にする。
 */

/** 異常なしの日は送らない。正常を毎日送ると、本当の異常が埋もれて読まれなくなる（T-M7-44）。 */
export interface OperatorAlert {
  subject: string;
  body: string;
  /** 同じ日に何度も送らないための鍵。 */
  dedupeKey: string;
}

const LEVEL_LABEL: Record<string, string> = {
  error: "対応が必要",
  warn: "注意",
};

/**
 * `error` と `warn` だけを拾って1通にまとめる。
 *
 * **`nextAction` を必ず載せる**——「何が起きたか」だけでは運営者は動けない。
 * T-M8-163 で providerの失敗が「AIの利用残高が不足しています」＋購入場所まで出るようになったので、
 * その文面がそのまま運営者へ届く。
 */
export function buildOperatorAlert(
  checks: Check[],
  input: { date: string; environmentLabel: string; baseUrl?: string | null },
): OperatorAlert | null {
  const problems = checks.filter((c) => c.level === "error" || c.level === "warn");
  if (problems.length === 0) return null;

  const errors = problems.filter((c) => c.level === "error").length;
  const warns = problems.length - errors;
  const counts = [
    errors > 0 ? `対応が必要 ${errors}件` : null,
    warns > 0 ? `注意 ${warns}件` : null,
  ]
    .filter(Boolean)
    .join(" / ");

  const lines = [
    `${input.environmentLabel} の状態（${input.date}）`,
    input.baseUrl ? input.baseUrl : null,
    "",
    counts,
    "",
  ].filter((l) => l !== null);

  for (const c of problems) {
    lines.push(`■ ${c.name}【${LEVEL_LABEL[c.level] ?? c.level}】`);
    lines.push(`  ${c.detail}`);
    if (c.nextAction) lines.push(`  → ${c.nextAction}`);
    lines.push("");
  }

  lines.push("このメールは、対応が必要な項目があった日にだけ届きます。");
  lines.push("手元で詳しく見るときは `npm run doctor -- --base <URL>` を実行してください。");

  return {
    subject: `[Exos AI] ${input.environmentLabel}の状態: ${counts}`,
    body: lines.join("\n"),
    // 環境ごとに分ける（本番とstagingの両方から届いても潰し合わない）。
    dedupeKey: `operator-alert:${input.environmentLabel}:${input.date}`,
  };
}
