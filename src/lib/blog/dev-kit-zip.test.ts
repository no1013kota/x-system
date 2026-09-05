import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * 配布キット（`public/blog-files/claude-code-dev-kit.zip`・`kit/BUILD.json`）が正本と一致するか（T-M8-434）。
 *
 * zip は**コミット対象の生成物**で、正本（`.claude/skills/`・`kit/`・ルートの `.mcp.json`／許可設定／検査スクリプト）を
 * 変えて `npm run dev-kit` を忘れても何も止まらなかった（記事の「約NNKB」も手で合わせていた）。
 * `scripts/dev-kit.mjs --check` が正本から作り直した中身と zip を突き合わせ、ずれていれば
 * 「npm run dev-kit を実行してください」で赤にする。生成はしない（tmpdir だけを使う）。
 */
describe("配布キット（dev-kit）", () => {
  it("zip と kit/BUILD.json が正本と一致する（ずれていたら npm run dev-kit）", () => {
    const r = spawnSync("node", ["scripts/dev-kit.mjs", "--check"], { cwd: process.cwd(), encoding: "utf8" });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  }, 60_000);
});
