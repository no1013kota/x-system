import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { validatePatternInput } from "@/lib/post/post-patterns-store";
import { createScheduleSlotSchema } from "@/lib/schedule-slots";
import { usagePeriodKeyExpr } from "@/lib/usage/usage-period";

import { closePool, getPool } from "./pool";

/**
 * **アプリが作る値が、DBのCHECK制約を実際に通ることを確かめる**（T-M8-307）。
 *
 * 2026-08-25、前日に入った T-M8-299（利用枠の期間キーに世代 `#N` を付ける変更）が
 * **使われた瞬間に利用者を止める状態**で本番へ出ていた。`usage_events` / `usage_counters` の
 * `month` は `^\d{4}-\d{2}(-\d{2})?$` で縛られており、`#1` を弾く。トライアル中に
 * プランを下げた利用者は、以後どの生成も利用枠を記録できず**何もできなくなる**。
 * しかも読み取り側は行が無いだけなので画面には「残り満額」と出る（原則1の最悪の形）。
 *
 * 単体テスト・DBテストは合計2,620件が緑だった。**キーを組み立てる検査と、枠を書く検査が
 * 別々にあり、「世代を進めた後に書く」という繋ぎ目を誰も通っていなかった**のが原因。
 *
 * そこでこの検査は、層をまたいで次の2つを機械的に固定する。
 *
 * 1. **生成側が通す値は、DBも受け入れる。** 値は固定文字列ではなく**実物の生成側**
 *    （`usagePeriodKeyExpr` / zodスキーマ / `validatePatternInput`）から作る。
 *    生成側を緩めたのにDB側を直さなければ、ここで落ちる。
 * 2. **DBが弾くべき値を、DBがいまも弾く。** 制約を `.*` へ緩めるなど、
 *    検出器そのものが死んだ場合に落とす（開発とテストの進め方 §11「検出器が死んでいても緑になる」）。
 *
 * 判定には**DBに実在する制約定義**（`pg_get_constraintdef`）をそのまま使う。
 * migration の文字列を読むのではなく、いま適用されている定義で一時テーブルを作って書いてみる。
 */

/** 1エントリ＝1つのCHECK制約。`accept` は実物の生成側から作る。 */
interface Registered {
  table: string;
  constraint: string;
  /** 制約式が参照する列。一時テーブルをこの列名で作る。 */
  column: string;
  /** どこが値を作るか（落ちたときに直す場所が分かるように書く）。 */
  producer: string;
  /** 生成側が通す値。DBが受け入れなければならない。 */
  accept: () => Promise<string[]>;
  /** DBが弾かなければならない値（制約が生きていることの確認）。 */
  reject: string[];
}

/** 実物の期間キー。`profiles` の代わりに VALUES を渡し、同じ式をDBに評価させる。 */
async function realPeriodKeys(): Promise<string[]> {
  const { rows } = await getPool().query<{ k: string }>(
    `select ${usagePeriodKeyExpr("p")} as k
       from (values
         (now(), 0),          -- 契約期間が同期済み・世代なし
         (now(), 1),          -- トライアル中に下げてリセットした直後
         (now(), 12),         -- 何度も往復した利用者
         (null::timestamptz, 0),  -- 未同期（暦月で数える）
         (null::timestamptz, 5)   -- 未同期のまま下げた利用者
       ) as p(current_period_start, usage_epoch)`,
  );
  return rows.map((r) => r.k);
}

/** zodが通す参考URL（`""` は null へ落ちるので対象外）。 */
async function acceptedSourceUrls(): Promise<string[]> {
  const candidates = [
    "https://example.com/a",
    "https://example.com/path?q=1#frag",
    "https://example.com/日本語",
    `https://example.com/${"a".repeat(1900)}`,
    "http://example.com/a",
    "ftp://example.com/a",
    "example.com",
    "",
  ];
  const field = createScheduleSlotSchema.shape.source_url;
  return candidates.filter((v) => {
    const parsed = field.safeParse(v);
    return parsed.success && typeof parsed.data === "string";
  });
}

/** `validatePatternInput` が通す名前。**実際にinsertされるのは trim 後の値**。 */
async function acceptedPatternNames(): Promise<string[]> {
  const candidates = [
    "ふつうの名前",
    "スペース 入り",
    "記号! @ # $ % & * ( ) - _ = + [ ] ; : ' \" , . ? / \\ |",
    "  前後に空白  ",
    "絵文字🙂入り",
    "a<b",
    "a>b",
    "a\nb",
    "a\rb",
  ];
  const out: string[] = [];
  for (const name of candidates) {
    try {
      validatePatternInput(
        { name, description: null, prompt: "本文を書いてください", placeholders: [] },
        { isSystemDefault: false },
      );
      out.push(name.trim()); // 保存されるのは trim 後（`applyCreatePattern`）
    } catch {
      // 生成側が弾く値はDBまで届かないので対象外。
    }
  }
  return out;
}

const REGISTRY: Registered[] = [
  {
    table: "usage_events",
    constraint: "usage_events_month_format",
    column: "month",
    producer: "src/lib/usage/usage-period.ts の usagePeriodKeyExpr",
    accept: realPeriodKeys,
    reject: ["2026-8", "202608", "2026-08#", "2026-08#x", "2026-08-", ""],
  },
  {
    table: "usage_counters",
    constraint: "usage_counters_month_format",
    column: "month",
    producer: "src/lib/usage/usage-period.ts の usagePeriodKeyExpr",
    accept: realPeriodKeys,
    reject: ["2026-8", "202608", "2026-08#", "2026-08#x", "2026-08-", ""],
  },
  {
    table: "schedule_slots",
    constraint: "schedule_slots_source_url_scheme",
    column: "source_url",
    producer: "src/lib/schedule-slots.ts の createScheduleSlotSchema.source_url",
    accept: acceptedSourceUrls,
    reject: ["http://example.com/a", "ftp://example.com/a", "example.com"],
  },
  {
    table: "post_patterns",
    constraint: "post_patterns_name_safe",
    column: "name",
    producer: "src/lib/post/post-patterns-store.ts の validatePatternInput",
    accept: acceptedPatternNames,
    reject: ["a<b", "a>b", "a\nb", "a\rb"],
  },
];

describe("DBのCHECK制約とアプリが作る値（local DB）", () => {
  let available = false;

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
    }
  });
  afterAll(async () => {
    await closePool();
  });
  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  /** いま適用されている、正規表現でテキストを縛るCHECK制約の一覧。 */
  async function liveRegexConstraints(): Promise<{ table: string; constraint: string; def: string }[]> {
    const { rows } = await getPool().query<{ table: string; constraint: string; def: string }>(
      `select rel.relname as table, con.conname as constraint, pg_get_constraintdef(con.oid) as def
         from pg_constraint con
         join pg_class rel on rel.oid = con.conrelid
         join pg_namespace ns on ns.oid = rel.relnamespace
        where con.contype = 'c' and ns.nspname = 'public'
          and pg_get_constraintdef(con.oid) like '%~%'
        order by 1, 2`,
    );
    return rows;
  }

  /**
   * 実在の制約定義で一時テーブルを作り、値を1つずつ書いてみる。
   * savepointで包むので、弾かれてもトランザクションは続けられる。
   */
  async function probe(
    def: string,
    column: string,
    values: string[],
  ): Promise<{ value: string; accepted: boolean }[]> {
    const c = await getPool().connect();
    try {
      await c.query("begin");
      await c.query(`create temporary table constraint_probe ("${column}" text, ${def}) on commit drop`);
      const out: { value: string; accepted: boolean }[] = [];
      for (const value of values) {
        await c.query("savepoint p");
        try {
          await c.query(`insert into constraint_probe ("${column}") values ($1)`, [value]);
          out.push({ value, accepted: true });
        } catch {
          out.push({ value, accepted: false });
        }
        await c.query("rollback to savepoint p");
      }
      await c.query("rollback");
      return out;
    } finally {
      c.release();
    }
  }

  /**
   * **分母を先に出す**（CLAUDE.md 原則1・`/security-audit` §1と同じ考え方）。
   * 新しい制約を足したのにここへ登録しなければ落ちる——「検査されていないのに緑」を作らない。
   */
  it("正規表現のCHECK制約はすべてこの検査に登録されている", async () => {
    const live = (await liveRegexConstraints()).map((r) => `${r.table}.${r.constraint}`).sort();
    const registered = REGISTRY.map((r) => `${r.table}.${r.constraint}`).sort();
    expect(
      live,
      "新しいCHECK制約が増えた（または消えた）。REGISTRY へ、その値を作る実物の関数と一緒に登録すること",
    ).toEqual(registered);
  });

  it.each(REGISTRY.map((r) => `${r.table}.${r.constraint}`))(
    "%s: アプリが作る値をDBが受け入れる",
    async (key) => {
      const entry = REGISTRY.find((r) => `${r.table}.${r.constraint}` === key)!;
      const live = (await liveRegexConstraints()).find(
        (r) => r.table === entry.table && r.constraint === entry.constraint,
      );
      expect(live, `${key} がDBに存在しない`).toBeDefined();

      const values = await entry.accept();
      // 候補が空だと「全部通った」ことになって静かに素通りする（検出器の生存確認）。
      expect(values.length, `${entry.producer} から値が1件も取れていない`).toBeGreaterThan(0);

      const results = await probe(live!.def, entry.column, values);
      const rejected = results.filter((r) => !r.accepted).map((r) => JSON.stringify(r.value));
      expect(
        rejected,
        `${entry.producer} が作る値を ${entry.constraint} が弾いた。` +
          `アプリは保存したつもりでDBが拒否するため、利用者には原因の分からない失敗になる`,
      ).toEqual([]);
    },
  );

  it.each(REGISTRY.map((r) => `${r.table}.${r.constraint}`))(
    "%s: 弾くべき値をいまも弾く（制約が生きている）",
    async (key) => {
      const entry = REGISTRY.find((r) => `${r.table}.${r.constraint}` === key)!;
      const live = (await liveRegexConstraints()).find(
        (r) => r.table === entry.table && r.constraint === entry.constraint,
      );
      const results = await probe(live!.def, entry.column, entry.reject);
      const accepted = results.filter((r) => r.accepted).map((r) => JSON.stringify(r.value));
      expect(
        accepted,
        `${entry.constraint} が通してはいけない値を通した。制約が緩められていないか確認する`,
      ).toEqual([]);
    },
  );
});
