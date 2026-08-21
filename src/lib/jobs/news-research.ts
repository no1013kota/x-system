import { z } from "zod";
import { stripProviderMarkup } from "../ai/gen-output";

import type { ProviderCall } from "../ai/normalize";
import { runTextGeneration, usageFromError } from "../ai/pipeline";
import { formatRejectedItems } from "../ai/raw-error";
import type { Provider, TextGen } from "../ai/types";
import type { GenerationUsage } from "../ai/usage-schema";
import { recordProviderCalls } from "../db/api-usage-ledger";
import type { NewsCategory } from "../news";
import { SYS_NEWS } from "../prompts/gen-prompts";
import { newsCategoryLabel } from "../themes";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import {
  formatDropReasons,
  META_TOO_OLD_MAX_AGE_H,
  META_TOO_OLD_MIN_AGE_H,
  REASON_TOO_OLD,
} from "@/lib/news-outcome";

/**
 * 判定・整形の実体は `lib/news-outcome.ts`（診断・通知・スモークの単一の正本）。
 * 呼び出し側の import を変えずに済ませるため、ここからも出しておく。
 */
export { formatDropReasons } from "@/lib/news-outcome";

/**
 * NEWS実行モジュール（1分野・運営側, プロンプト設計書 §6.10/§4.2/§5.6/§7, 要件04 §2/§6, T-M4-10）。
 * SYS-NEWS を起動時刻由来の `{{hours}}` で組み立て（各回が直近数時間を重ねて取得＝3回に1回成功で欠落なし。
 * D-3/ADR-0003）、Web検索付きで生成→zod検証（コードフェンス除去＋修復call 1回は runTextGeneration が担う）
 * →provider call を原価台帳（external_api_usage_events, user_id=null）へ冪等記録する。
 *
 * NEWS は generation_jobs へ保存しない（要件04 §2）。providerは運営 NEWS_TEXT_PROVIDER 固定で解決し
 * （resolveNewsKey・要件01 §7）、無効時は失敗させ別providerへ自動切替しない。呼び出し側（T-M4-11 の
 * news-fetch route）が6分野を最大3並列で回し分野別にcommitする。本モジュールは1分野の実行に専念する。
 */

export const NEWS_MAX_ITEMS = 5;

/** 受理できる見出しの長さ。プロンプトの目標は30字（`SYS_NEWS`）で、これはその安全側の上限。 */
export const NEWS_TITLE_MAX_LENGTH = 60;
/** 受理できる要約の長さ（要決定D-12 案B・2026-07-28）。 */
export const NEWS_SUMMARY_MAX_LENGTH = 200;
const KNOWN_URLS_WINDOW_HOURS = 48;
const KNOWN_URLS_LIMIT = 200;
const NEWS_WEB_SEARCH_MAX_USES = 5;

/**
 * `published_at` をISO 8601（オフセット付き）へ寄せる。寄せられなければ `undefined` を返し、
 * **itemそのものは残す**（任意項目のために本体を失わないため）。
 * 受け付ける形: `2026-07-28` / `2026-07-28T09:43:00` / `2026-07-28 09:43:00` / 既にISOのもの。
 */
export function normalizePublishedAt(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (value === "") return undefined;
  // 日付のみ → その日の00:00 UTCとして扱う（時刻不明を捏造しない範囲で最小の補完）。
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  // 「日付 時刻」区切りの空白をTへ、タイムゾーンが無ければUTCとみなす。
  const iso = value.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(iso)) return `${iso}Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/**
 * 引用タグの除去を zod の前処理として使うための包み（T-M8-06）。
 *
 * **文字列以外はそのまま通す。** ここで例外を投げると、欠けた項目を検出して item を捨てる
 * という本来の判定に到達できなくなる（`title` 未指定の応答で実際に落ちた）。
 */
function stripMarkupLoose(value: unknown): unknown {
  return typeof value === "string" ? stripProviderMarkup(value) : value;
}

const newsItemSchema = z.object({
  /**
   * **文字数を数える前に引用タグを落とす**（T-M8-06）。
   *
   * Web検索を使う実行では Anthropic が `<cite index="43-1">…</cite>` を JSON文字列の中へ
   * 混ぜてくる。生成側は T-M7-20 で対処済みだったが、**ニュース側は未対応で、タグがそのまま
   * 画面に出ていた**（ローカルDBに実データを確認）。タグ込みで字数を数えると上限判定も狂う。
   */
  // **プロンプトの目標（30字）と受理の上限（60字）を分ける**（T-M8-47）。
  //
  // 30字はプロンプトで明示していれば守られる、という前提でD-12のときに据え置いた。
  // その前提は実測で崩れた——2026-08-04 の `smoke:live` で ai テーマの4件のうち
  // **2件が `title:too_big` で落ち、分野が0件になった**（英語ソースの見出しは実測38〜56字）。
  // 投稿側の `TARGET_WEIGHTED_LENGTH`(240) と `MAX_WEIGHTED_LENGTH`(280) と同じ考え方で、
  // 「短く書かせる指示」と「受理できる限界」を別の数にする。
  //
  // 表示は折り返すだけでレイアウトは壊れない（DBの列は `text`、見出しに固定高さは無い）。
  // **長い見出しが出ることより、ニュースが1件も来ないことの方が害が大きい。**
  title: z.preprocess(stripMarkupLoose, z.string().min(1).max(NEWS_TITLE_MAX_LENGTH)),
  // 200字上限（要決定D-12 案B・2026-07-28）。当初120字だったが、モデルが安定して守れず
  // `summary:too_big` で分野ごと全滅する事象が実測で2回連続発生した（T-M7-25）。
  // 表示側は `line-clamp-2` なので長くてもレイアウトは破綻しない。
  summary: z.preprocess(stripMarkupLoose, z.string().min(1).max(NEWS_SUMMARY_MAX_LENGTH)),
  source_url: z.url(),
  impact: z.enum(["high", "mid", "low"]),
  // **任意項目なので、形式が違っても item ごと捨てない**（正規化できなければ落とすだけ）。
  // ニュース記事は日付だけ（`2026-07-28`）やタイムゾーン無しで書かれることが多く、
  // 厳密な ISO 8601 を要求していたため 5件すべてが弾かれ分野が0件になっていた（D-12検証時に実測）。
  published_at: z.preprocess(normalizePublishedAt, z.iso.datetime({ offset: true }).optional()),
});

/** SYS-NEWS 応答契約（最大5件・空配列許容, §6.10/§7）。1件でも欠ければ応答全体が不正。 */
export const newsOutputSchema = z.object({
  items: z.array(newsItemSchema).max(NEWS_MAX_ITEMS),
});

/**
 * 検証に渡す外側の器。**item単位の妥当性はここでは見ない**。
 *
 * 厳密な `newsOutputSchema` をそのまま検証に使うと、1件でも規定を外れた瞬間に応答全体が捨てられ、
 * 修復callも空配列を返して**その分野のニュースが常にゼロ件**になる（2026-07-28、web3で実測:
 * 英語ソースのため title 38〜56字・summary 210〜293字となり当時の上限30/120字に抵触、4件すべて破棄）。
 * 器だけを検証して item は個別に選別する（`pickValidItems`）。
 */
const newsEnvelopeSchema = z.object({
  items: z.array(z.unknown()).max(NEWS_MAX_ITEMS * 4),
});

/**
 * 規定を満たす item だけを残す。落とした件数と**理由**を返す。
 *
 * 理由を返すのは、0件になったときに「該当ニュースが無い」のか「応答が契約を満たさず全滅した」のかを
 * 呼び出し側が説明できるようにするため。件数だけだと運用でどちらか判別できない（T-M7-24）。
 */
export function pickValidItems(raw: unknown[]): {
  items: NewsItemOut[];
  dropped: number;
  /** 落とした理由の内訳（例 `title:too_big` → 3）。 */
  reasons: Record<string, number>;
  /**
   * 落とした候補の**中身**（T-M8-86）。件数と理由だけでは「プロンプトを直すべきか」が
   * 判断できないため、実際に何が返ってきたかを呼び出し側が保存できるようにする。
   */
  rejected: { reasons: string[]; raw: unknown }[];
} {
  const items: NewsItemOut[] = [];
  const reasons: Record<string, number> = {};
  const rejected: { reasons: string[]; raw: unknown }[] = [];
  let dropped = 0;
  for (const candidate of raw) {
    const parsed = newsItemSchema.safeParse(candidate);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      dropped++;
      const itemReasons: string[] = [];
      for (const issue of parsed.error.issues) {
        const key = `${issue.path.join(".") || "(root)"}:${issue.code}`;
        reasons[key] = (reasons[key] ?? 0) + 1;
        itemReasons.push(key);
      }
      rejected.push({ raw: candidate, reasons: itemReasons });
    }
    if (items.length >= NEWS_MAX_ITEMS) break;
  }
  return { items, dropped, reasons, rejected };
}

/**
 * `published_at` が未来だと判断する許容幅（分）。時計ずれの分だけ許す。
 * ホームの重要ニュースは `coalesce(published_at, fetched_at)` の降順で上位3件しか出さないため、
 * 未来日時が1件入ると**そこに居座り続ける**（2026-07-31、1時間先の日時で実測・T-M7-40）。
 */
export const PUBLISHED_AT_FUTURE_TOLERANCE_MIN = 5;

/**
 * 取得窓（`{{hours}}`）より何時間古いものまで許すか。
 *
 * プロンプトで「直近{{hours}}時間」と指示しても守られない前提で組む（開発とテストの進め方 §12）。
 * 一方で窓ぴったりで切ると、日付だけで書かれた記事（00:00補完）や日付をまたいだ更新記事を
 * 正当に落としてしまう。そのため**窓＋24時間**までは許し、それより古いものは分野違いの
 * 混入として捨てる（2026-07-31、3時間窓の指示に対し4か月前の記事が保存された）。
 */
export const PUBLISHED_AT_AGE_SLACK_HOURS = 24;

export interface RecencyPolicyResult {
  items: NewsItemOut[];
  /** 古すぎて捨てた件数。 */
  dropped: number;
  reasons: Record<string, number>;
  /** 未来日時だったため `published_at` を落として `fetched_at` 扱いに寄せた件数。 */
  futureAdjusted: number;
}

/**
 * 取得窓に対する新しさで item を選別する。
 *
 * - **未来**（now + 許容幅より後）: `published_at` を落として item は残す。任意項目のために
 *   本体を捨てない方針（開発とテストの進め方 §12）に従い、並び順だけを `fetched_at` へ寄せる。
 * - **古すぎる**（now - (hours + slack) より前）: item を捨てる。窓外の記事は「今のニュース」として
 *   出すと運営者を誤解させるため。
 * - `published_at` が無い item はそのまま残す（判定材料が無いだけで、内容は有効）。
 */
export function applyRecencyPolicy(
  items: NewsItemOut[],
  opts: { now: Date; hours: number },
): RecencyPolicyResult {
  const nowMs = opts.now.getTime();
  const futureLimit = nowMs + PUBLISHED_AT_FUTURE_TOLERANCE_MIN * 60_000;
  const oldestAllowed = nowMs - (opts.hours + PUBLISHED_AT_AGE_SLACK_HOURS) * 3_600_000;
  const kept: NewsItemOut[] = [];
  const reasons: Record<string, number> = {};
  let dropped = 0;
  let futureAdjusted = 0;

  // 捨てた記事が「何時間古かったか」を残す（T-M8-83）。件数だけでは、境界をわずかに越えたのか
  // そもそも古い記事しか無かったのかが区別できず、窓を広げるべきかの判断ができなかった。
  const tooOldAgesH: number[] = [];

  for (const item of items) {
    if (!item.published_at) {
      kept.push(item);
      continue;
    }
    const ts = new Date(item.published_at).getTime();
    if (Number.isNaN(ts)) {
      kept.push({ ...item, published_at: undefined });
      continue;
    }
    if (ts > futureLimit) {
      kept.push({ ...item, published_at: undefined });
      futureAdjusted += 1;
      continue;
    }
    if (ts < oldestAllowed) {
      dropped += 1;
      reasons[REASON_TOO_OLD] = (reasons[REASON_TOO_OLD] ?? 0) + 1;
      tooOldAgesH.push((nowMs - ts) / 3_600_000);
      continue;
    }
    kept.push(item);
  }

  if (tooOldAgesH.length > 0) {
    reasons[META_TOO_OLD_MIN_AGE_H] = Math.round(Math.min(...tooOldAgesH) * 10) / 10;
    reasons[META_TOO_OLD_MAX_AGE_H] = Math.round(Math.max(...tooOldAgesH) * 10) / 10;
  }
  return { items: kept, dropped, reasons, futureAdjusted };
}

export type NewsItemOut = z.infer<typeof newsItemSchema>;

/** 定時取得の起動時刻（JST）。9〜21時の3時間おき・1日5回（2026-08-22 運営者決定・T-M8-195）。 */
export const NEWS_FETCH_JST_HOURS = [9, 12, 15, 18, 21] as const;

/** 起動間隔（時間）。窓はこれより広く取り、隣の回と必ず重ねる。 */
const FETCH_INTERVAL_HOURS = 3;
/** 重なり分。1回失敗しても次の回が拾えるようにするための余裕。 */
const OVERLAP_HOURS = 1;

/**
 * `{{hours}}` 切替（§6.10）。**起動間隔より広い窓**にして、隣の回と必ず重ねる
 * （1回失敗しても次で拾える＝欠落しない）。
 *
 * 2026-08-02、毎時×6分野の実費が月$518〜1,071と判明し2時間おきへ縮小（T-M7-55・当時3分野）。
 * 2026-08-22、運用6分野へ再拡大（T-M8-189）のうえ**9〜21時の3時間おき（1日5回）**へ変更
 * （T-M8-195・運営者の指示）。**頻度だけ変えると窓が足りずニュースを取りこぼす**ので、窓も追随させる。
 *
 * - 初回（9:00）: 前日の最終回（21:00）からの空白を埋めるため **12時間**さかのぼる。
 * - 以降（12:00〜21:00）: 間隔3時間＋重なり1時間の **4時間**。
 * - 想定外の時刻に起動された場合も欠落させない方へ倒し、初回と同じ12時間を使う。
 */
export function newsLookbackHours(jstHour: number): number {
  const [first, ...rest] = NEWS_FETCH_JST_HOURS;
  if (jstHour === first) return 24 - NEWS_FETCH_JST_HOURS[NEWS_FETCH_JST_HOURS.length - 1] + first;
  if ((rest as readonly number[]).includes(jstHour)) return FETCH_INTERVAL_HOURS + OVERLAP_HOURS;
  return 24 - NEWS_FETCH_JST_HOURS[NEWS_FETCH_JST_HOURS.length - 1] + first;
}

/** UTC時刻→JSTの時（0-23）。 */
export function jstHourOf(now: Date): number {
  return new Date(now.getTime() + 9 * 3600 * 1000).getUTCHours();
}

export interface NewsResearchDeps {
  db: Queryable;
  /** 解決済み NEWS provider アダプタ（server配線は resolveNewsKey→アダプタ構築）。 */
  textGen: TextGen;
  /** 解決済みprovider（例外で終わったcallの台帳記録に使う）。 */
  provider: Provider;
  model: string;
  /** 起動時刻。`{{hours}}` 算出に使う（テストで固定可能）。 */
  clock: Date;
  /** 原価台帳の冪等keyプレフィックス（例 `news:{window_key}:{category}`）。call連番を付す。 */
  ledgerKeyPrefix: string;
  /** latency計測用（既定 Date.now）。 */
  now?: () => number;
  makeDeadline?: () => Deadline;
  webSearchMaxUses?: number;
}

export interface NewsResearchResult {
  items: NewsItemOut[];
  /** 規定を満たさず除外したitem数。**0件が「該当なし」か「全滅」かを呼び出し側が区別するために返す**。 */
  dropped: number;
  /** 除外理由の内訳（例 `title:too_big` → 3）。 */
  dropReasons: Record<string, number>;
  /** 未来日時だったため `published_at` を落として並び順を `fetched_at` へ寄せた件数。 */
  futureAdjusted: number;
  usage: GenerationUsage;
  hours: number;
  /**
   * 契約違反で落とした候補の中身（T-M8-86）。**`published_at:too_old` だけの除外では作らない**
   * ——窓より古いだけの item は契約を満たしており良性なので、本文を積むと
   * 「正常な空」と混ざる（`news-outcome.ts` の `onlyOutsideWindow` と同じ考え方）。
   * **HTTP応答へは載せない**（要件01 §8）。保存先は `news_fetch_outcomes.provider_raw_error`。
   */
  providerRawError: string | null;
}

/** 直近48時間に取得済みの同分野 source_url（<known_urls> 用・重複除外）。 */
async function loadKnownUrls(db: Queryable, category: NewsCategory): Promise<string[]> {
  const { rows } = await db.query<{ source_url: string }>(
    `select source_url from news_items
      where category = $1 and fetched_at > now() - make_interval(hours => $2)
      order by fetched_at desc
      limit $3`,
    [category, KNOWN_URLS_WINDOW_HOURS, KNOWN_URLS_LIMIT],
  );
  return rows.map((r) => r.source_url);
}

/** provider call を原価台帳へ冪等記録する（user_id=null・job外NEWS。要件02 §3.17・§5.6）。 */
async function recordNewsUsage(
  deps: NewsResearchDeps,
  calls: ProviderCall[],
): Promise<void> {
  await recordProviderCalls(deps.db, calls, {
    userId: null,
    keyPrefix: deps.ledgerKeyPrefix,
  });
}

/** 1分野のニュースリサーチを実行する。 */
export async function researchNews(
  category: NewsCategory,
  deps: NewsResearchDeps,
): Promise<NewsResearchResult> {
  const hours = newsLookbackHours(jstHourOf(deps.clock));
  const knownUrls = await loadKnownUrls(deps.db, category);

  const system = SYS_NEWS.replaceAll("{{category_ja}}", newsCategoryLabel(category))
    .replaceAll("{{hours}}", String(hours))
    .replaceAll("{{n}}", String(NEWS_MAX_ITEMS));
  const user = `<known_urls>\n${knownUrls.join("\n")}\n</known_urls>`;

  const deadline = (deps.makeDeadline ?? createDeadline)();
  // Web検索併用のため構造化出力(jsonSchema)は使わず、JSON出力指示＋コード検証へフォールバックする（§5.1）。
  let result;
  try {
    result = await runTextGeneration({
      provider: deps.textGen,
      providerId: deps.provider,
      request: {
        system: [system],
        user,
        webSearch: { maxUses: deps.webSearchMaxUses ?? NEWS_WEB_SEARCH_MAX_USES },
        timeoutMs: deadline.callTimeoutMs(),
      },
      schema: newsEnvelopeSchema,
      model: deps.model,
      operation: "text_generation",
      now: deps.now,
    });
  } catch (error) {
    // 例外で終わったcallも原価台帳へ残す（D-4 案A・要件04 §10）。分野単位で失敗しても記帳は行う。
    const failedUsage = usageFromError(error);
    if (failedUsage && failedUsage.calls.length > 0) {
      await recordNewsUsage(deps, failedUsage.calls);
    }
    throw error;
  }

  await recordNewsUsage(deps, result.usage.calls);
  const picked = pickValidItems(result.parsed.items);
  // 契約を満たした item を、さらに取得窓の新しさで選別する（プロンプトの指示だけに頼らない）。
  const recency = applyRecencyPolicy(picked.items, { now: deps.clock, hours });
  const dropped = picked.dropped + recency.dropped;
  const reasons = { ...picked.reasons, ...recency.reasons };
  if (dropped > 0) {
    // 規定外は捨てるが、黙って減らすと「取得0件」と区別が付かないので必ず残す。
    console.warn(
      `[news_fetch] ${category}: 規定を満たさない ${dropped} 件を除外しました（${formatDropReasons(reasons)}）`,
    );
  }
  if (recency.futureAdjusted > 0) {
    console.warn(
      `[news_fetch] ${category}: 未来の日時 ${recency.futureAdjusted} 件を取得時刻扱いへ寄せました`,
    );
  }
  return {
    items: recency.items,
    dropped,
    dropReasons: reasons,
    futureAdjusted: recency.futureAdjusted,
    usage: result.usage,
    hours,
    // 契約違反で落ちた分だけ中身を残す（`published_at:too_old` は良性なので残さない・T-M8-86）。
    providerRawError: formatRejectedItems(picked.rejected),
  };
}
