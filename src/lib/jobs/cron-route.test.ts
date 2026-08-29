import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 費用の出るcronを検証環境で止める仕組み（T-M8-326）。
 *
 * `news_fetch` は**本番の外部API費用の97.6%**を占める（2026-08-27 実測:
 * Anthropic $23.31 のうち $23.14 が196回のニュース取得）。stg・ローカルで回すと
 * 同じだけ費用が出るので、運営者が戻すまで production 限定にする。
 *
 * ここはソース走査。**検出器が空振りしていないこと**を、実ファイルに当たることで確かめる
 * （開発とテストの進め方 §11「検出器が死んでいても緑になる」）。
 */
const SRC = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(`${SRC}${p}`, "utf8");

describe("費用の出るcronの環境ガード（T-M8-326）", () => {
  it("news_fetch は productionOnly が付いている", () => {
    expect(
      read("app/api/cron/news-fetch/route.ts"),
      "news_fetch から productionOnly が外れている。stg・ローカルでもAI費用が出る",
    ).toContain("productionOnly: true");
  });

  it("handleCronRoute が productionOnly を実装している（検出器の生存確認）", () => {
    const src = read("lib/jobs/cron-route.ts");
    expect(src).toContain("productionOnly");
    // production 以外は ran:false と理由を返す。黙って何もしない形にしない（原則1）。
    expect(src).toContain("skipped");
    expect(src).toContain('env.APP_ENV !== "production"');
  });

  it("env は認証を通したあとに遅延ロードする（module読込で検証を走らせない）", () => {
    const src = read("lib/jobs/cron-route.ts");
    expect(src, "env を先頭でimportすると route-auth.test.ts が env 無しで落ちる").not.toMatch(
      /^import \{ env \}/m,
    );
    expect(src).toContain('await import("@/lib/env")');
  });
});
