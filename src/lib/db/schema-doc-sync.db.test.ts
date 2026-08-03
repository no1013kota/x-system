import { readFileSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool } from "./pool";

/**
 * 要件02（データモデル）と**実際のDBスキーマ**が一致していることの検査（T-M8-33）。
 *
 * ## なぜ要るか
 *
 * CLAUDE.md は「`docs/` は常に実装の現状と一致していなければならない」と定めるが、
 * **守れているかを人が目で確かめていた**。2026-08-03の突き合わせで、M8前半の22コミットが
 * docsを1つも更新していなかったことが分かった（画面仕様の記載漏れ8件）。
 *
 * 表とカラムは機械的に比べられるので、ここで自動化する。**文書に書き忘れた列も、
 * 文書に残った消し忘れの列も、どちらも落ちる。** 画面仕様のような文章は対象外なので、
 * これは同期の一部しか守らない（残りは `/doc-sync` と人の確認）。
 */
const DOC = "docs/requirements/02_data_model.md";

/** 「### 3.x `table`」の節と、その表の1列目に並ぶカラム名を拾う。 */
function documentedColumns(): Map<string, string[]> {
  const doc = readFileSync(DOC, "utf8");
  const out = new Map<string, string[]>();
  const sections = doc.matchAll(/### 3\.\d+ `([a-z_]+)`([\s\S]*?)(?=\n### |\n## |$)/g);
  for (const [, table, body] of sections) {
    const columns = [...body.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
    if (columns.length > 0) out.set(table, columns);
  }
  return out;
}

describe("要件02とDBスキーマの一致（db）", () => {
  let available = false;
  let real = new Map<string, string[]>();

  beforeAll(async () => {
    try {
      const { rows } = await getPool().query<{ table_name: string; columns: string[] }>(
        // `column_name` は `sql_identifier` 型。`::text` を付けないと node-pg が配列として
        // 解釈できず `{a,b}` という文字列で返る（`.filter` が無いと言われて気付いた）。
        `select table_name::text as table_name,
                array_agg(column_name::text order by ordinal_position) as columns
           from information_schema.columns
          where table_schema = 'public'
          group by table_name`,
      );
      real = new Map(rows.map((r) => [r.table_name, r.columns]));
      available = true;
    } catch {
      // Supabase未起動は「未検証」として扱う（他のdbテストと同じくskipへ落とす）。
      available = false;
    }
  });
  afterAll(async () => {
    await closePool();
  });
  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  it("要件02に節がある表がすべてDBに存在する", () => {
    const missing = [...documentedColumns().keys()].filter((t) => !real.has(t));
    expect(missing, "文書にあってDBに無い表").toEqual([]);
  });

  it("**DBの表はすべて要件02に節がある**（作ったのに書き忘れていない）", () => {
    const documented = documentedColumns();
    const undocumented = [...real.keys()].filter((t) => !documented.has(t)).sort();
    expect(undocumented, "DBにあって文書に無い表").toEqual([]);
  });

  it("各表のカラムが文書と一致する（書き忘れ・消し忘れの両方を見る）", () => {
    const drift: string[] = [];
    for (const [table, columns] of documentedColumns()) {
      const actual = real.get(table);
      if (!actual) continue;
      const onlyDoc = columns.filter((c) => !actual.includes(c));
      const onlyDb = actual.filter((c) => !columns.includes(c));
      if (onlyDoc.length > 0) drift.push(`${table}: 文書のみ ${onlyDoc.join(",")}`);
      if (onlyDb.length > 0) drift.push(`${table}: DBのみ ${onlyDb.join(",")}`);
    }
    expect(drift, "要件02とDBのカラム差分").toEqual([]);
  });
});
