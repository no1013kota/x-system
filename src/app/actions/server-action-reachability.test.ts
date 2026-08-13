import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `"use server"` の export が**どこからも呼ばれていない状態**を検出する（F12）。
 *
 * Server Action の export は「外から叩けるPOST受け口」でもある。使われないまま残ると
 * 攻撃面が増えるうえ、docs のAPI表と実際の読取経路が食い違っていく（実際に
 * `getAnalyticsSummaryAction` と `listSuggestionsAction` は画面がRSCから直接読むように
 * なった後も残り、呼び出し元0件のまま docs には仕様として載っていた）。
 *
 * 判定は**import 文**を見る（識別子の部分一致だとコメント中の言及で到達扱いになる）。
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ACTIONS_DIR = join(ROOT, "src", "app", "actions");

/** 走査対象（`.tsx` は無いが将来増えても拾えるようにする）。 */
const SCAN_ROOTS = ["src", "e2e", "scripts"];
const SCAN_EXT = [".ts", ".tsx", ".mjs"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (SCAN_EXT.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** `"use server"` を持つ action ファイルの export 名一覧。 */
function serverActionExports(): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const entry of readdirSync(ACTIONS_DIR)) {
    if (!entry.endsWith(".ts") || entry.includes(".test.")) continue;
    const source = readFileSync(join(ACTIONS_DIR, entry), "utf8");
    if (!/^\s*["']use server["'];/m.test(source)) continue;
    for (const m of source.matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)/gm)) {
      out.push({ file: entry, name: m[1] });
    }
  }
  return out;
}

/**
 * その名前を action モジュールから import しているファイル（定義元は除く）。
 *
 * **静的 import と動的 import の両方を見る。** `actions.db.test.ts` は
 * `const { listDraftsAction } = await import("./drafts")` の形で使っており、
 * 静的 import だけを見ると「呼び出し元が無い」と誤判定する。
 * 識別子の部分一致にはしない（コメント中の言及で到達扱いになる）。
 */
function importersOf(name: string, file: string): string[] {
  const moduleName = file.replace(/\.ts$/, "");
  const from = `["'][^"']*(?:actions/)?${moduleName}["']`;
  const pattern = new RegExp(
    // import { name } from "...";
    `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*${from}` +
      // const { name } = await import("...");
      `|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*await\\s+import\\(\\s*${from}\\s*\\)`,
    "s",
  );
  const found: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const path of sourceFiles(join(ROOT, root))) {
      if (path.endsWith(join("app", "actions", file))) continue;
      if (path.endsWith("server-action-reachability.test.ts")) continue;
      if (pattern.test(readFileSync(path, "utf8"))) found.push(path);
    }
  }
  return found;
}

describe("Server Action の到達性", () => {
  const actions = serverActionExports();

  it("検査対象が見つかる（走査そのものが空振りしていない）", () => {
    expect(actions.length, "use server の export を1つも拾えていない").toBeGreaterThan(10);
  });

  it.each(actions.map((a) => `${a.file}:${a.name}`))(
    "%s は呼び出し元がある",
    (id) => {
      const [file, name] = id.split(":");
      expect(
        importersOf(name, file),
        `${name} を import しているファイルが無い。使わないなら削除する（"use server" の export は外から叩けるPOST受け口）`,
      ).not.toHaveLength(0);
    },
  );
});
