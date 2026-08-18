import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * cron の全routeは、何か仕事をする前に CRON_SECRET の bearer が無ければ401で拒否する。
 * 認可を先に見るのでDBには触らない。
 *
 * **対象はディレクトリ走査で集める**（T-M8-137）。以前は4本の手書き列挙で、
 * あとから増えた `canary` と `doctor` が検査外だった——**両方の認可を消しても
 * 全テストが緑のまま通る**状態で、この検査が守っているつもりの範囲と実際がずれていた
 * （docs/operations/development-and-testing.md §11「走査対象はディレクトリ走査にし、
 * ファイル名の手書き列挙を避ける」）。
 */
describe("cron route auth", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  // `route.ts` を持つ直下ディレクトリ名を集める。基点は import.meta.url（§11）。
  const here = fileURLToPath(new URL(".", import.meta.url));
  const names = readdirSync(here, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => {
      try {
        return readdirSync(`${here}${e.name}`).includes("route.ts");
      } catch {
        return false;
      }
    })
    .map((e) => e.name)
    .sort();

  it("検査対象のrouteを取り違えていない（0件で緑にしない）", () => {
    // **見つからない＝検査が空振り**。走査条件が壊れたらここで止める。
    expect(names.length).toBeGreaterThanOrEqual(4);
    // 実際に存在するものが全部入っていること（増えたら自動で対象になる）。
    expect(names).toContain("canary");
    expect(names).toContain("doctor");
  });

  for (const name of names) {
    it(`${name} returns 401 without a valid bearer`, async () => {
      const mod: { GET: (req: Request) => Promise<Response> } = await import(`./${name}/route.ts`);
      const noAuth = await mod.GET(new Request("http://localhost/api/cron/x"));
      expect(noAuth.status).toBe(401);
      const wrong = await mod.GET(
        new Request("http://localhost/api/cron/x", {
          headers: { authorization: "Bearer wrong" },
        }),
      );
      expect(wrong.status).toBe(401);
    });
  }
});
