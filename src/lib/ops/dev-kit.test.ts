import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * 配布キット（プラグイン `docdd`）の記録 `kit/BUILD.json` が正本と一致するか（T-M8-434・T-M8-435）。
 *
 * 配布物 `dist/docdd/` は gitignore 済みで、公開リポジトリ（no1013kota/claude-docdd-dev-kit）へ手で push する。
 * 正本（`.claude/skills/`・`kit/`・ルートの `.mcp.json`／許可設定／検査スクリプト）を変えて `npm run dev-kit` を
 * 忘れると、公開側が古いまま誰も気付かない。`scripts/dev-kit.mjs --check` が正本から作り直した中身のハッシュを
 * `kit/BUILD.json` と突き合わせ、ずれていれば「npm run dev-kit を実行してください」で赤にする。
 * 生成はしない（tmpdir だけを使う）。
 */
describe("配布キット（dev-kit）", () => {
  it("kit/BUILD.json が正本と一致する（ずれていたら npm run dev-kit）", () => {
    const r = spawnSync("node", ["scripts/dev-kit.mjs", "--check"], { cwd: process.cwd(), encoding: "utf8" });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  }, 60_000);
});
