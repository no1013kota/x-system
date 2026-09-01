/**
 * job から出すユーザー通知の**単一の正本**（R21）。
 *
 * 同じ失敗が2つの経路で確定する。worker が自分で気付いて確定する経路（各 handler の
 * `persistFailure`）と、処理が固まったまま返ってこないものを回収する stale 経路
 * （`terminal.finalizeFailedJob`）である。以前はこの2経路が**同じ文言を別々に持ち**、
 * worker 側はSQLリテラル、stale 側は `FAILED_NOTICE` テーブルに書かれていた。
 *
 * 片方だけ直すと、同じ失敗が経路によって違う文面で届く。運営者にも利用者にも
 * 「どちらが直った版か」を判別する手段が無い。文言と発行SQLはここだけに置く。
 *
 * `terminal.ts:26-29` が D-5 として残していた「worker の失敗経路との完全共通化」の、
 * 通知部分にあたる。
 *
 * NOTE: `news-digest.ts` と `ops/daily-summary.ts` の通知INSERTは**別形**（退会競合対策の
 * `for key share of p` を持つ・T-M8-19）。揃えると振る舞いが変わるので巻き込まない。
 */

import type { ProviderCall } from "../ai/normalize";
import { recordProviderCalls } from "../db/api-usage-ledger";
import type { Queryable } from "../db/queryable";

import type { JobKind } from "./handlers";

/**
 * 失敗通知の kind別文言。link が draft_id 等に依存する kind は関数で解決する。
 * `image_generation` は本文が使えるため error 通知を出さない（テーブル外・
 * `finalizeImageStale` が draft確定/子job作成を担う）。
 */
export type FailedNotice = {
  title: string;
  body: string;
  /** 引数は `draft_id` を持つ行（`JobTerminalRow` が構造的に満たす）。 */
  link: string | ((job: { draft_id: string | null }) => string);
};

/** 未知kindの既定文言。 */
export const DEFAULT_FAILED_NOTICE: FailedNotice = {
  title: "処理に失敗しました",
  body: "時間をおいて再度お試しください。",
  link: "/app",
};

export const FAILED_NOTICE: Partial<Record<JobKind, FailedNotice>> = {
  post_generation: {
    title: "投稿の生成に失敗しました",
    body: "時間をおいて再度お試しください。設定や入力もご確認ください。",
    link: "/app/posts",
  },
  post_publish: {
    title: "投稿に失敗しました",
    body: "投稿の途中で失敗しました。下書きを確認して再度お試しください。",
    link: (job) =>
      job.draft_id ? `/app/posts?tab=drafts&draftId=${job.draft_id}` : "/app/posts",
  },
  learning_analysis: {
    title: "学習ソースの分析に失敗しました",
    body: "時間をおいて再度お試しください。対象アカウント・投稿が非公開/削除されていないかもご確認ください。",
    link: "/app/prompts?sec=account-md",
  },
  md_merge: {
    title: "学習ソースの削除が完了しませんでした",
    body: "学習ソースの削除に失敗しました。時間をおいて再度お試しください。",
    link: "/app/prompts?sec=account-md",
  },
  suggestion: {
    title: "投稿分析に失敗しました",
    body: "明日の朝に自動で再実行されます。Xアカウントの連携状態もご確認ください。",
    link: "/app/analytics",
  },
};

/** kind から文言を引き、link を解決して返す。 */
export function resolveFailedNotice(
  kind: JobKind,
  job: { draft_id: string | null },
): { title: string; body: string; link: string } {
  const notice = FAILED_NOTICE[kind] ?? DEFAULT_FAILED_NOTICE;
  return {
    title: notice.title,
    body: notice.body,
    link: typeof notice.link === "function" ? notice.link(job) : notice.link,
  };
}

/**
 * 全kind共通の失敗通知（type='error'・dedupe_key `job:{id}:failed`・通知設定を尊重）。
 * in_app OFF なら行を作らない（メール通知はT-M8-222で廃止）。`on conflict` で同じjobの二重通知を防ぐ。
 */
export async function createFailedNotification(
  db: Queryable,
  params: { userId: string; jobId: string; title: string; body: string; link: string },
): Promise<void> {
  await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled)
     select $1, 'error', $2, $4, $5, $6, jsonb_build_object('job_id', $3::text),
            coalesce((p.notification_config->'error'->>'in_app')::boolean, false)
       from profiles p
      where p.id = $1
        and coalesce((p.notification_config->'error'->>'in_app')::boolean, false)
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [params.userId, `job:${params.jobId}:failed`, params.jobId, params.title, params.body, params.link],
  );
}

/**
 * 下書きができたことの通知（R22）。
 *
 * 本文生成の成功経路・画像生成の確定経路・stale経路の3つが同じ下書きについて通知しうるため、
 * `dedupe_key` を `draft:{draftId}:created` に揃えて重複を防ぐ。以前はこの関数が
 * `post-generation.ts` / `image-generation.ts` / `terminal.ts` に**SQL差分ゼロで3重に**
 * 書かれており、文言・リンク・通知設定の見方・重複防止条件のどれを直すときも3箇所を
 * 直す必要があった（1つ忘れると成功経路とstale経路で通知が食い違う）。
 */
export async function createDraftCreatedNotification(
  db: Queryable,
  params: { userId: string; draftId: string },
): Promise<void> {
  await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled)
     select $1, 'draft_created', $2, '下書きができました',
            '生成した投稿の下書きを確認・編集できます。',
            '/app/posts?tab=drafts&draftId=' || $3::text, jsonb_build_object('draft_id', $3::text),
            coalesce((p.notification_config->'draft_created'->>'in_app')::boolean, false)
       from profiles p
      where p.id = $1
        and coalesce((p.notification_config->'draft_created'->>'in_app')::boolean, false)
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [params.userId, `draft:${params.draftId}:created`, params.draftId],
  );
}

/**
 * job失敗を確定させる3手順（R23）。
 *
 * どの job も失敗時に同じ順序で同じことをする。
 *
 * 1. `generation_jobs` へ `error` / `usage` を書く
 * 2. **失敗確定前に発生した provider call の原価を記録する**（成功・失敗を問わず記録・要件02 §3.17）
 * 3. 利用者へ失敗を通知する
 *
 * 特に 2 は、新しい job種別を足す人が落としても**全テストが緑のまま通り、AI費用が
 * 過少計上される**。費用が見えることは運営の前提（CLAUDE.md 原則4）なので、
 * 3手順を1つにまとめて「書き忘れられない」形にする。
 *
 * `error` に渡した値だけが保存される。**`providerRawError` を渡さなければキー自体が出ない**
 * （suggestion は `provider_raw_error` を持たない。`null` を足すと保存JSONが変わる）。
 *
 * 前段の後始末（image_generation の drafts.images 更新・learning_analysis の
 * learning_sources 更新）と、通知の種類が draft_created である image_generation は
 * 呼び出し側に残す。
 */
export async function persistJobFailure(
  db: Queryable,
  params: {
    jobId: string;
    userId: string;
    xAccountId: string;
    /** 原価台帳の冪等keyの接頭辞（`gen:` / `lrn:` / `sug:` / `img:`）。 */
    keyPrefix: string;
    error: {
      code: string;
      message: string;
      stage: string | null;
      /** 渡さなければ `provider_raw_error` キー自体を保存しない。 */
      providerRawError?: string | null;
    };
    usage: { calls: ProviderCall[]; estimated_cost_usd_total: number };
    /** 通知に使う kind。省略すると通知を出さない（呼び出し側が別の通知を出す場合）。 */
    notifyKind?: JobKind;
  },
): Promise<void> {
  const { code, message, stage } = params.error;
  await db.query(
    `update generation_jobs set error = $2::jsonb, usage = $3::jsonb where id = $1`,
    [
      params.jobId,
      JSON.stringify({
        code,
        message,
        retryable: false,
        stage,
        ...("providerRawError" in params.error
          ? { provider_raw_error: params.error.providerRawError ?? null }
          : {}),
      }),
      JSON.stringify(params.usage),
    ],
  );
  await recordProviderCalls(db, params.usage.calls, {
    userId: params.userId,
    xAccountId: params.xAccountId,
    jobId: params.jobId,
    keyPrefix: params.keyPrefix,
  });
  if (params.notifyKind) {
    await createFailedNotification(db, {
      userId: params.userId,
      jobId: params.jobId,
      ...resolveFailedNotice(params.notifyKind, { draft_id: null }),
    });
  }
}
