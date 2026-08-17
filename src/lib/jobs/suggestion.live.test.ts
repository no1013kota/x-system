import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";

// env（ANTHROPIC_API_KEY等）を import 前に読み込む（provider-contract.live.test.ts と同じ作法）。
const testNodeEnv = process.env.NODE_ENV;
Reflect.set(process.env, "NODE_ENV", "development");
Object.assign(process.env, loadEnvConfig(process.cwd(), true, console, true).combinedEnv);
if (testNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
else Reflect.set(process.env, "NODE_ENV", testNodeEnv);

import { describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import { executeSuggestion } from "./suggestion";
import { buildInputFromStored } from "./suggestion-input";
import { loadStoredTimeline, upsertTimelinePosts } from "./suggestion-timeline-store";

/**
 * 投稿分析の実AI 1周検証（T-M8-94）。`npm run check:suggest` で実行する（SUGGEST_LIVE=1 ゲート）。
 *
 * X取得だけ注入（現実的な12件・伸びた/伸びないの差つき）し、それ以外は本物を通す:
 * 実DB（x_timeline_posts への upsert・読み出し）→ 実Claude → zod検証 → improvement_suggestions 保存。
 * PT-SUGGESTのプロンプト・出力schemaを変えたときは必ずこれを1回回す（実費 約$0.02）。
 * 通常の `npm test` / CI では skip される（provider-contract.live.test.ts と同じ方式）。
 */
const ENABLED = process.env.SUGGEST_LIVE === "1";

const db: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

const now = Date.now();
const day = 86_400_000;
const mk = (id: string, daysAgo: number, text: string, imp: number, likes: number, extra: object = {}) => ({
  id, text, createdAt: new Date(now - daysAgo * day).toISOString(), inReplyToId: null,
  impressions: imp, likes, reposts: Math.floor(likes / 3), replies: Math.floor(likes / 5),
  hasMedia: false, hasUrl: false, ...extra,
});
const POSTS = [
  mk("9001", 1, "ChatGPTとClaude、結局どっちを使えばいいのか。1ヶ月両方使って分かった使い分けを3つにまとめました。", 4200, 85, { hasMedia: true }),
  mk("9002", 3, "AIツールの導入で一番失敗しやすいのは「ツール選び」ではなく「業務フローの整理不足」です。", 3800, 72),
  mk("9003", 5, "今日のランチ。おいしかった。", 180, 3, { hasMedia: true }),
  mk("9004", 7, "【保存版】経理業務をAIで半自動化する5ステップ。1.請求書の読み取り…", 5100, 120, { hasMedia: true }),
  mk("9005", 9, "新しいオフィスに引っ越しました！", 240, 8),
  mk("9006", 11, "生成AIの業務利用、社内規程はもう作りましたか？ひな形を無料公開している自治体が増えています。", 2900, 54, { hasUrl: true }),
  mk("9007", 14, "週末に読んだ本の感想です。", 150, 2),
  mk("9008", 16, "Excel作業を月20時間削減した話。使ったのはAIではなく、実は関数の見直しでした。オチまで読んでください。", 4600, 98),
  mk("9009", 19, "フォロワーの皆さんに質問。AIツールの月額、いくらまでなら払えますか？", 1900, 30),
  mk("9010", 22, "朝のニュースまとめ。", 320, 5),
  mk("9011", 25, "個人事業主こそAIを使うべき理由を、確定申告の実体験から話します。数字も出します。", 3400, 66),
  mk("9012", 28, "テストです。", 90, 1),
];
const TAGS = new Map([
// パターンは**名前**で渡す（T-M8-129 U5。LLMにも名前で見せる）。
  ["9004", { pattern: "ノウハウ・ハウツー", theme: "business_ops" }],
  ["9008", { pattern: "自分の考え・意見", theme: "business_ops" }],
]);

describe.runIf(ENABLED)("投稿分析 実AI 1周（手動）", () => {
  it("実DB保存→実Claude→zod検証→レポート保存まで通る", async () => {
    const { uid, xid, jobId } = await withTransaction(async (c) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(`insert into profiles (id, email, plan) values ($1,$2,'md') on conflict (id) do nothing`, [uid, `${uid}@example.com`]);
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
           values ($1,$2,'live_test','n','byok','active') returning id`,
          [uid, `x-${randomUUID()}`],
        )
      ).rows[0].id;
      const jobId = (
        await c.query<{ id: string }>(
          `insert into generation_jobs (x_account_id, kind, trigger, status)
           values ($1,'suggestion','schedule','running') returning id`,
          [xid],
        )
      ).rows[0].id;
      return { uid, xid, jobId };
    });
    try {
      await upsertTimelinePosts(db, xid, POSTS, TAGS);
      const stored = await loadStoredTimeline(db, xid);
      console.log(`保存済み投稿: ${stored.length}件`);

      const { createAnthropicTextGen } = await import("../ai/anthropic-client");
      const textGen = createAnthropicTextGen();
      const started = Date.now();
      const res = await executeSuggestion({
        db,
        jobId,
        runInTx: (fn) => withTransaction((c) => fn(c as unknown as Queryable)),
        resolveProvider: async () => ({
          textGen,
          provider: "anthropic",
          model: process.env.ANTHROPIC_TEXT_MODEL!,
        }),
        fetchPosts: async () => buildInputFromStored(stored),
        recordStage: async () => {},
      });
      console.log(`結果: ${JSON.stringify(res)} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      expect(res.status).toBe("saved");

      const saved = await db.query<{
        content: string;
        evidence: {
          good_posts: { id: string; why: string }[];
          advice: Record<string, { recommended: unknown; reason: string } & { kind?: string; content?: string }>;
        };
      }>(
        `select content, evidence from improvement_suggestions where x_account_id = $1`,
        [xid],
      );
      const row = saved.rows[0];
      console.log("\n===== 生成された分析レポート =====");
      console.log("総評:", row.content);
      for (const g of row.evidence.good_posts) console.log(`良かった投稿 ${g.id}: ${g.why}`);
      const a = row.evidence.advice;
      console.log("推奨の型:", a.pattern.recommended, "—", a.pattern.reason);
      console.log("推奨テーマ:", a.theme.recommended, "—", a.theme.reason);
      console.log("画像:", a.image.recommended, "—", a.image.reason);
      console.log("\n----- プロンプト（kind=" + a.prompt.kind + "） -----");
      console.log(a.prompt.content);
      const usage = await db.query<{ usage: { estimated_cost_usd_total?: number } }>(
        `select usage from generation_jobs where id = $1`,
        [jobId],
      );
      console.log("\n推定AI費用: $" + usage.rows[0]?.usage?.estimated_cost_usd_total);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
      await closePool();
    }
  }, 180_000);
});

describe.runIf(!ENABLED)("投稿分析 実AI 1周（無効）", () => {
  it("SUGGEST_LIVE=1 のときだけ実行する", () => {
    expect(ENABLED).toBe(false);
  });
});
