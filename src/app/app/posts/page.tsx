import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { getPool } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import {
  CreatePostForm,
  type ActiveJob,
  type PatternOption,
} from "./create-post-form";

export const metadata: Metadata = { title: "投稿 | Space AI" };

const ALL_PATTERNS: PatternOption[] = [
  { id: "p1", label: "ニュース解説", description: "話題のニュースを解説するスレッド" },
  { id: "p2", label: "自分の考え・意見", description: "本人の視点で述べる単発ポスト" },
  { id: "p3", label: "ノウハウ・ハウツー", description: "今日から実践できる手順スレッド" },
  { id: "p4", label: "トレンド便乗", description: "いま話題のトピックに便乗" },
  { id: "p6", label: "週次まとめ", description: "直近7日の関連ニュースまとめ" },
  // P-5（引用ポスト）は FEATURE_QUOTE_POST_ENABLED=true のときだけ追加する。
];

/** BYOKは valid な openai/google キー、premiumは運営キー＋画像モデルが設定済みのproviderを返す。 */
async function availableImageProviders(
  userId: string,
  plan: string | null,
): Promise<string[]> {
  if (plan === "premium") {
    const providers: string[] = [];
    if (env.OPENAI_API_KEY && env.OPENAI_IMAGE_MODEL) providers.push("openai");
    if (env.GEMINI_API_KEY && env.GEMINI_IMAGE_MODEL) providers.push("google");
    return providers;
  }
  const { rows } = await getPool().query<{ provider: string }>(
    `select provider from user_api_keys
      where user_id = $1 and provider in ('openai','google') and status = 'valid'`,
    [userId],
  );
  return rows.map((r) => r.provider);
}

export default async function PostsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8">
        <p className="text-sm text-muted-foreground">ログインが必要です。</p>
      </main>
    );
  }

  const activeXAccountId = await resolveActiveXAccountForUser(user.id);
  const profile = (
    await getPool().query<{ plan: string | null }>(`select plan from profiles where id = $1`, [
      user.id,
    ])
  ).rows[0];
  const patterns = env.FEATURE_QUOTE_POST_ENABLED
    ? [
        ...ALL_PATTERNS,
        { id: "p5", label: "引用ポスト", description: "対象ポストへの引用（URL付き投稿）" },
      ]
    : ALL_PATTERNS;
  const imageProviders = activeXAccountId
    ? await availableImageProviders(user.id, profile?.plan ?? null)
    : [];

  // 再訪復元: 進行中（queued/running）の生成jobがあればフォームがポーリングを再開する（要件06 §4.2）。
  let initialJob: ActiveJob | null = null;
  if (activeXAccountId) {
    const inflight = (
      await getPool().query<{
        id: string;
        status: string;
        progress_stage: string | null;
        created_at: Date | string;
      }>(
        `select id, status, progress_stage, created_at from generation_jobs
          where x_account_id = $1 and kind = 'post_generation' and status in ('queued','running')
          order by created_at desc limit 1`,
        [activeXAccountId],
      )
    ).rows[0];
    if (inflight) {
      initialJob = {
        id: inflight.id,
        status: inflight.status,
        progressStage: inflight.progress_stage,
        draftId: null,
        createdAt: new Date(inflight.created_at).toISOString(),
      };
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 lg:px-8 lg:py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">投稿</h1>
        <p className="text-sm text-muted-foreground">
          パターンを選んで投稿を生成し、下書きで確認・編集して投稿します。
        </p>
      </header>

      <nav aria-label="投稿タブ" className="flex gap-2 border-b">
        <span className="border-b-2 border-foreground px-4 py-3 text-sm font-medium">作成</span>
        <span className="border-b-2 border-transparent px-4 py-3 text-sm text-muted-foreground">
          下書き
        </span>
        <span className="border-b-2 border-transparent px-4 py-3 text-sm text-muted-foreground">
          履歴
        </span>
      </nav>

      {activeXAccountId ? (
        <CreatePostForm
          imageProviders={imageProviders}
          initialJob={initialJob}
          patterns={patterns}
          xAccountId={activeXAccountId}
        />
      ) : (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950" role="alert">
          <p className="font-semibold">Xアカウントの連携が必要です</p>
          <p className="mt-1 text-sm">投稿を生成するには、まずXアカウントを連携してください。</p>
          <Link
            className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
            href="/app/settings?tab=x-accounts"
          >
            設定へ
          </Link>
        </div>
      )}
    </main>
  );
}
