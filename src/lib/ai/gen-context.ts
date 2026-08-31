import { SYS_GEN } from "@/lib/prompts/gen-prompts";

import type { Queryable } from "../x/token-refresh";

/**
 * GEN のコンテキスト組み立て（プロンプト設計書 §4.1/§4.2, 要件02 §4.4, T-M3-04）。
 * system は「SYS-GEN＋<base_md>」の固定バイト列（可変値を混ぜない＝プロンプトキャッシュ効率）。
 * user は <pattern><user_input><recent_posts>（P-6のみ<news_digest>／P-5有効化後のみ<quote_post>）。
 * DB読取は注入し純粋に保つ。recent_posts のためのX API追加読取は行わない（保存済みdraftから組む）。
 */

export const UNSPECIFIED = "（未指定）";
export const RECENT_POSTS_MAX = 10;
export const RECENT_POST_HEAD_CHARS = 80;
export const NEWS_DIGEST_MAX = 10;

export interface NewsDigestItem {
  title: string;
  summary: string;
  source_url: string;
  impact: string;
}

/**
 * 固定部。`SYS_GEN` ＋ アカウント.md。
 *
 * **アカウント.mdが空なら `<base_md>` ごと渡さない**（T-M8-337）。アカウント設定が未保存でも
 * 生成できるようにしたため、空の封筒を渡すと「発信定義書は空です」という情報を
 * わざわざ伝えることになり、モデルが「定義が無い」ことに引きずられる。
 * 渡さなければ、パターンのプロンプトと入力だけで書く。
 */
export function buildGenSystem(baseMd: string): string[] {
  return baseMd.trim() ? [SYS_GEN, `<base_md>\n${baseMd}\n</base_md>`] : [SYS_GEN];
}

/** codepoint単位で先頭n文字に切り詰める（絵文字のサロゲートペアを割らない）。 */
function truncateChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

/** recent_posts を「- 先頭80字」× 最大10件へ整形する。 */
export function formatRecentPosts(bodies: string[]): string {
  return bodies
    .slice(0, RECENT_POSTS_MAX)
    .map((body) => `- ${truncateChars(body.replace(/\s+/g, " ").trim(), RECENT_POST_HEAD_CHARS)}`)
    .join("\n");
}

export interface GenUserParams {
/** 解決済みのパターン別プロンプト（利用者が編集可能）。 */
  pattern: string;
  /**
   * パターンの設定（分量・Web検索・参考URL）を文にしたもの（T-M8-131）。
   * `buildPatternRules` が作る。設定の数字を書くのは**ここだけ**——
   * プロンプト本文にも書くと、設定を変えたとき片方だけ古い数字が残る。
   */
  patternRules?: string | null;
  /** 参考URL／自分の考え／追加指示。未入力は「（未指定）」。 */
  input?: string | null;
  /** 直近posted draftの各先頭（呼び出し側が fetchRecentPostBodies で取得）。 */
  recentPosts: string[];
  /** P-6のみ。undefinedならタグ自体を出さない。空配列（非該当）は `[]` を出す。 */
  newsDigest?: NewsDigestItem[];
  /** 再生成（regenerateDraft）時の前回下書き本文。改善の素材として渡す（指示ではない）。 */
  previousDraft?: string[];
  /** P-5有効化後のみ（インターフェース確保。現行は呼び出さない）。 */
  quotePost?: string | null;
}

/** 可変部を組み立てる。未入力は「（未指定）」。可変値は system へ入れない。 */
export function buildGenUser(params: GenUserParams): string {
  const parts: string[] = [];
parts.push(`<pattern>\n${params.pattern}\n</pattern>`);
  // パターンの設定（分量・Web検索・参考URL）を明示する（T-M8-131）。
  // 指示しないまま生成後に切り詰めると「締めが落ちた」形になるため、先に伝える。
  if (params.patternRules) {
    parts.push(`<pattern_rules>\n${params.patternRules}\n</pattern_rules>`);
  }
  parts.push(`<user_input>\n${params.input?.trim() ? params.input.trim() : UNSPECIFIED}\n</user_input>`);
  const recent = params.recentPosts.length > 0 ? formatRecentPosts(params.recentPosts) : UNSPECIFIED;
  parts.push(`<recent_posts>\n${recent}\n</recent_posts>`);
  if (params.previousDraft && params.previousDraft.length > 0) {
    parts.push(
      `<previous_draft>\n${params.previousDraft.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n</previous_draft>`,
    );
  }
  if (params.newsDigest !== undefined) {
    parts.push(
      `<news_digest>\n${JSON.stringify(params.newsDigest.slice(0, NEWS_DIGEST_MAX))}\n</news_digest>`,
    );
  }
  if (params.quotePost) {
    parts.push(`<quote_post>\n${params.quotePost}\n</quote_post>`);
  }
  return parts.join("\n\n");
}

/**
 * 当該Xアカウントの直近posted draftから recent_posts 用の本文（各threadの先頭ポスト）を新しい順に返す。
 * X上の存在が確認できるposted draftのみを対象にし、X API追加読取はしない（§4.1）。
 */
export async function fetchRecentPostBodies(
  db: Queryable,
  xAccountId: string,
): Promise<string[]> {
  const { rows } = await db.query<{ thread: unknown }>(
    `select thread from drafts
      where x_account_id = $1 and status = 'posted'
      order by posted_at desc nulls last, created_at desc
      limit $2`,
    [xAccountId, RECENT_POSTS_MAX],
  );
  return rows.map((r) => firstPostText(r.thread)).filter((t) => t.length > 0);
}

function firstPostText(thread: unknown): string {
  if (!Array.isArray(thread) || thread.length === 0) return "";
  const first = thread[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "text" in first) {
    const t = (first as { text?: unknown }).text;
    return typeof t === "string" ? t : "";
  }
  return "";
}

/**
 * 該当 news_category の news_items から直近7日・impact優先（high→mid→low、同impactは新しい順）で
 * 最大10件の digest を返す（§4.1）。categories が空なら空配列（P-6非該当＝空で渡す）。
 */
export async function fetchNewsDigest(
  db: Queryable,
  categories: string[],
): Promise<NewsDigestItem[]> {
  if (categories.length === 0) return [];
  const { rows } = await db.query<NewsDigestItem>(
    `select title, summary, source_url, impact
       from news_items
      where category::text = any($1)
        and published_at is not null
        and published_at >= now() - interval '7 days'
      order by case impact when 'high' then 0 when 'mid' then 1 else 2 end,
               published_at desc
      limit $2`,
    [categories, NEWS_DIGEST_MAX],
  );
  return rows.map((r) => ({
    title: r.title,
    summary: r.summary,
    source_url: r.source_url,
    impact: r.impact,
  }));
}
