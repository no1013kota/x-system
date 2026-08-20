import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { collectDiagnostics } from "./diagnostics";

/**
 * `doctor` の検査項目と運用メモの表を機械的に突き合わせる（T-M8-165）。
 *
 * **手で数え上げた一覧は必ず古くなる。** ADR-0005 は nonce付きCSPと静的prerenderの因果を
 * 正しく書いていながら、適用先を手で列挙していたため認証画面が漏れ、本番の `/signup` が
 * 18日間動かなかった（T-M8-87）。同じ形を作らないため、項目を増やしたら表も直さないと落ちる形にする。
 *
 * 判定の正本はコード（`diagnostics.ts`）。**表が足りなければ表を直す**。
 */

const DOC = fileURLToPath(
  new URL("../../../docs/operations/monitoring.md", import.meta.url),
);

/** DBを触らないスタブ。**項目名の一覧を取るだけ**なので、中身は空で構わない。 */
const stubDb = {
  query: async () => ({ rows: [], rowCount: 0 }),
} as never;

/** doctorがデプロイ先に対して出す項目名。`config` を渡した完全な形で取る。 */
async function deployedCheckNames(): Promise<string[]> {
  const report = await collectDiagnostics(stubDb, {
    schedulerExpected: true,
    config: {
      appEnv: "production",
      postingMode: "live",
      appBaseUrl: "https://example.com",
      actualOrigin: "https://example.com",
      stripeKeyKind: "live",
      sentryDsnKind: "usable",
      sentryPublicDsnKind: "usable",
      sentryHost: "o1.ingest.de.sentry.io",
    },
  });
  return report.checks.map((c) => c.name);
}

/**
 * §2「doctorの検査項目」の表の1列目だけを拾う。
 * **節を限定する**——文書冒頭のヘッダ表（バージョン・更新日）まで拾うと検査が意味を失う。
 */
function documentedNames(): string[] {
  const md = readFileSync(DOC, "utf8");
  const start = md.indexOf("## 2. doctorの検査項目");
  const end = md.indexOf("## 3.", start);
  expect(start, "§2の見出しが見つかりません（節名を変えたら検査も直す）").toBeGreaterThan(-1);
  expect(end, "§3の見出しが見つかりません").toBeGreaterThan(start);

  const names: string[] = [];
  for (const line of md.slice(start, end).split("\n")) {
    const m = /^\|\s*([^|]+?)\s*\|\s*[^|]+\|\s*$/.exec(line);
    if (!m) continue;
    const cell = m[1];
    if (cell === "検査項目" || /^-+$/.test(cell)) continue;
    names.push(cell);
  }
  return names;
}

describe("doctorの検査項目と運用メモの同期", () => {
  it("表が空振りしていない（検出器そのものの生存確認）", () => {
    expect(documentedNames().length).toBeGreaterThan(10);
  });

  it("doctorが出す項目はすべて運用メモの表に載っている", async () => {
    const documented = documentedNames();
    const missing = (await deployedCheckNames()).filter(
      (name) => !documented.includes(name),
    );

    expect(
      missing,
      "docs/operations/monitoring.md §2 の表へ追記してください（項目を増やしたら表も直す）",
    ).toEqual([]);
  });

  /** 逆向きも見る。消した項目が表に残ると、運営者は「見ているはず」と誤解する。 */
  it("運用メモの表にある項目のうち、デプロイ先向けのものは実際に出る", async () => {
    const emitted = new Set(await deployedCheckNames());
    // ローカル実行時だけの項目は `scripts/doctor.mjs` 側が足すため、この一覧から除く。
    const localOnly = new Set([
      "データの保存先",
      "データ構造の更新",
      "溜まったテストデータ",
      "確認メールの行き先（ローカル）",
      "アプリ／データの状態",
    ]);
    const stale = documentedNames().filter(
      (name) => !emitted.has(name) && !localOnly.has(name),
    );

    expect(
      stale,
      "コードから消えた項目が表に残っています（見ているはずと誤解させる）",
    ).toEqual([]);
  });
});
