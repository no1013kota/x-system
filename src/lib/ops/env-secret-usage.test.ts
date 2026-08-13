/**
 * デプロイ先を叩く script が**環境ごとの鍵**を使っていることの静的検査（T-M7-47）。
 *
 * 鍵は環境ごとに違う（`cronSecretEnvName` / release-gate.ts）。ローカルの鍵でデプロイ先を叩くと
 * 401 になり、運営者には「壊れている」と見分けがつかない。
 *
 * 2026-08-01、`smoke-live.mjs` だけが対応表を使い、`doctor.mjs` は `CRON_SECRET` を直接読んでいた
 * ため、staging 宛の `npm run doctor` が「確認用の鍵が一致しません」で止まった。**共有ヘルパーを
 * 使い忘れる**のは次に script が増えたときも起こるので、一覧ではなく「`--base` を受ける script は
 * すべて `cronSecretEnvName` を通す」という規則そのものをテストにする
 * （`outbound-channels.test.ts` と同じ考え方）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// 実行時のカレントディレクトリに依存させない（T-M8-51・R19）。
const SCRIPT_DIR = join(fileURLToPath(new URL("../../../", import.meta.url)), "scripts");

/**
 * `--base <URL>` でデプロイ先を指定できる script（＝ローカル以外を叩き得る）。
 *
 * `baseUrl()` も見る（R32）。共通ヘルパー `scripts/lib/cli.mjs` へ `argOf("base")` を
 * 集約したとき、**この検出条件が当たらなくなって検査全体が空振りした**（下の
 * 「1つ以上ある」ガードが実際に落ちて気付いた）。判定材料を増やすときは、
 * その材料を共通化しても当たり続けるかを確かめること。
 */
function scriptsAcceptingBase(): { file: string; source: string }[] {
  return readdirSync(SCRIPT_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .map((file) => ({ file, source: readFileSync(`${SCRIPT_DIR}/${file}`, "utf8") }))
    .filter(
      ({ source }) =>
        source.includes('"--base"') ||
        source.includes('argOf("base")') ||
        source.includes("baseUrl()"),
    );
}

/** 鍵を読む script（読まないものは間違えようがないので対象外）。 */
function scriptsReadingSecret(): string[] {
  return scriptsAcceptingBase()
    .filter(({ source }) => /CRON_SECRET/.test(source) && /envValue\(/.test(source))
    .map(({ file }) => file);
}

describe("デプロイ先を叩くscriptの鍵の読み方", () => {
  it("--base を受けるscriptが1つ以上ある（検査が空振りしていないこと）", () => {
    expect(scriptsAcceptingBase().length).toBeGreaterThan(0);
  });

  it("鍵を読むscriptが1つ以上ある（規則が空振りしていないこと）", () => {
    expect(scriptsReadingSecret().length).toBeGreaterThan(0);
  });

  it.each(scriptsReadingSecret())("%s は cronSecretEnvName で鍵の名前を決める", (file) => {
    const source = readFileSync(`${SCRIPT_DIR}/${file}`, "utf8");
    expect(
      source.includes("cronSecretEnvName"),
      `${file} が CRON_SECRET を直接読んでいます。環境ごとの鍵は cronSecretEnvName（release-gate.ts）で決めてください`,
    ).toBe(true);
  });

  it.each(scriptsAcceptingBase().map(({ file }) => file))(
    "%s は環境名の付かない CRON_SECRET を直接読まない",
    (file) => {
      const source = readFileSync(`${SCRIPT_DIR}/${file}`, "utf8");
      // `envValue("CRON_SECRET")` のような固定読みを禁じる（変数経由なら可）。
      expect(
        /envValue\(\s*["'`]CRON_SECRET["'`]\s*\)/.test(source),
        `${file} が CRON_SECRET を固定で読んでいます。ローカルの鍵でデプロイ先を叩くと401になります`,
      ).toBe(false);
    },
  );
});
