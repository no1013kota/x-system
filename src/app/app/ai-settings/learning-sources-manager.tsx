"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  addLearningSourceAction,
  listLearningSourcesAction,
  reimportOwnPostsAction,
  removeLearningSourceAction,
} from "@/app/actions/learning-sources";
import { formatJst } from "@/lib/format";
import type { LearningSourceView } from "@/lib/learning-sources";

/**
 * SC-10 学習ソースタブ（L-1〜3, 要件06 §9, T-M5-07）。参考アカウント/参考投稿の追加（type別上限）、
 * 自己過去投稿の取り込み/再取り込み（30日制御）、削除、進行/失敗表示、removing中の生成停止案内。
 */

const REF_ACCOUNT_MAX = 3;
const REF_POST_MAX = 10;
const TYPE_LABEL: Record<string, string> = {
  ref_account: "参考アカウント",
  ref_post: "参考投稿",
  own_posts: "自分の過去投稿",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "分析待ち",
  analyzed: "反映済み",
  failed: "失敗",
  removing: "削除処理中",
};

function uuid(): string {
  return crypto.randomUUID();
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export function LearningSourcesManager({
  xAccountId,
  initialSources,
  initialOwnPostsNextEligibleAt,
  plan,
}: {
  xAccountId: string;
  initialSources: LearningSourceView[];
  initialOwnPostsNextEligibleAt: string | null;
  plan: "standard" | "md" | "premium";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sources, setSources] = useState<LearningSourceView[]>(initialSources);
  const [ownPostsNextEligibleAt, setNextEligible] = useState<string | null>(initialOwnPostsNextEligibleAt);
  const [type, setType] = useState<"ref_account" | "ref_post">("ref_account");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [noteHref, setNoteHref] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // pending の経過秒（>60秒で遅延案内）を判定するため定期的に現在時刻を更新する。
  useEffect(() => {
    if (!sources.some((s) => s.status === "pending" || s.status === "removing")) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [sources]);

  const refCount = (t: string) => sources.filter((s) => s.type === t).length;
  const removing = sources.some((s) => s.status === "removing");
  const ownPosts = sources.find((s) => s.type === "own_posts") ?? null;
  const ownPostsBlockedDays = ownPostsNextEligibleAt ? daysUntil(ownPostsNextEligibleAt) : 0;

  async function refresh() {
    const res = await listLearningSourcesAction();
    if (res.status === "success" && res.sources) setSources(res.sources);
  }

  function setError(res: { message?: string; details?: Record<string, unknown> }) {
    setNote(res.message ?? "処理に失敗しました。");
    const path = res.details?.settingsPath;
    setNoteHref(typeof path === "string" ? path : null);
  }

  function add() {
    if (!url.trim()) return;
    startTransition(async () => {
      const res = await addLearningSourceAction({ request_key: uuid(), x_account_id: xAccountId, type, url: url.trim() });
      if (res.status === "success") {
        setUrl("");
        setNote(null);
        setNoteHref(null);
        await refresh();
      } else {
        setError(res);
      }
    });
  }

  function remove(sourceId: string) {
    if (!confirm("この学習ソースを削除しますか？反映済みの場合はベースmdから知見を取り除く処理が実行されます。")) return;
    startTransition(async () => {
      const res = await removeLearningSourceAction({ request_key: uuid(), x_account_id: xAccountId, source_id: sourceId });
      if (res.status === "success") {
        setNote(null);
        await refresh();
      } else {
        setError(res);
      }
    });
  }

  function reimport() {
    startTransition(async () => {
      const res = await reimportOwnPostsAction({ request_key: uuid(), x_account_id: xAccountId });
      if (res.status === "success") {
        setNote(null);
        await refresh();
        router.refresh(); // サーバの次回可能日時を更新
      } else {
        if (res.details?.next_available_at) {
          setNextEligible(String(res.details.next_available_at));
        }
        setError(res);
      }
    });
  }

  function isStalePending(s: LearningSourceView): boolean {
    return s.status === "pending" && now - new Date(s.updatedAt).getTime() > 60_000;
  }

  return (
    <div className="space-y-6">
      {removing ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
          学習ソースの削除処理中です。削除が完了するまで、このアカウントの新規生成を一時停止しています。
        </p>
      ) : null}
      {note ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
          {note}
          {noteHref ? (
            <Link className="ml-2 font-medium underline underline-offset-2" href={noteHref}>
              設定を開く
            </Link>
          ) : null}
        </p>
      ) : null}

      {/* 追加フォーム（参考アカウント/参考投稿） */}
      <section className="rounded-card border border-hairline bg-surface p-4">
        <h2 className="text-sm font-semibold">参考ソースを追加</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          参考アカウント（最大{REF_ACCOUNT_MAX}）・参考投稿（最大{REF_POST_MAX}）のX URLを登録すると、文体・型を学習してベースmdへ反映します。
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs font-semibold text-muted-foreground">種別</span>
            <select
              className="mt-1 rounded-md border px-2 py-1"
              onChange={(e) => setType(e.target.value as "ref_account" | "ref_post")}
              value={type}
            >
              <option disabled={refCount("ref_account") >= REF_ACCOUNT_MAX} value="ref_account">
                参考アカウント{refCount("ref_account") >= REF_ACCOUNT_MAX ? "（上限）" : `（${refCount("ref_account")}/${REF_ACCOUNT_MAX}）`}
              </option>
              <option disabled={refCount("ref_post") >= REF_POST_MAX} value="ref_post">
                参考投稿{refCount("ref_post") >= REF_POST_MAX ? "（上限）" : `（${refCount("ref_post")}/${REF_POST_MAX}）`}
              </option>
            </select>
          </label>
          <label className="min-w-0 flex-1 text-sm">
            <span className="block text-xs font-semibold text-muted-foreground">URL</span>
            <input
              className="mt-1 w-full rounded-md border px-2 py-1"
              onChange={(e) => setUrl(e.target.value)}
              placeholder={type === "ref_account" ? "https://x.com/handle" : "https://x.com/handle/status/123"}
              type="url"
              value={url}
            />
          </label>
          <button
            className="inline-flex h-9 items-center rounded-card bg-brand px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
            disabled={pending || removing || (refCount(type) >= (type === "ref_account" ? REF_ACCOUNT_MAX : REF_POST_MAX))}
            onClick={add}
            type="button"
          >
            追加
          </button>
        </div>
      </section>

      {/* 自己過去投稿の取り込み/再取り込み */}
      <section className="rounded-card border border-hairline bg-surface p-4">
        <h2 className="text-sm font-semibold">自分の過去投稿から学習</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          直近100件の投稿から「自分らしさ」を抽出してベースmdへ反映します。再取り込みは
          <strong className="font-medium">成功した取り込みから</strong>30日ごとに1回まで（失敗したときはすぐやり直せます）。
          {plan === "premium" ? "（生成枠を1消費）" : ""}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            className="inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
            disabled={pending || removing || ownPostsBlockedDays > 0}
            onClick={reimport}
            type="button"
          >
            {ownPosts ? "再取り込み" : "取り込み"}
          </button>
          {ownPostsBlockedDays > 0 ? (
            <span className="text-xs text-muted-foreground">次回の再取り込みまであと{ownPostsBlockedDays}日</span>
          ) : null}
        </div>
      </section>

      {/* 一覧 */}
      <section>
        <h2 className="text-sm font-semibold">登録済みの学習ソース</h2>
        {sources.length === 0 ? (
          <p className="mt-2 rounded-xl border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
            まだ学習ソースはありません。
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sources.map((s) => (
              <li className="rounded-card border border-hairline bg-surface p-4" key={s.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">{TYPE_LABEL[s.type] ?? s.type}</span>
                  <span className="rounded px-2 py-0.5 text-xs font-medium">
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">分析日時: {formatJst(s.updatedAt)}</span>
                </div>
                {s.url ? (
                  <a className="mt-1 block truncate text-sm hover:underline" href={s.url} rel="noopener noreferrer" target="_blank">
                    {s.url}
                  </a>
                ) : null}
                {isStalePending(s) ? (
                  <p className="mt-2 text-xs text-amber-700">開始が遅れています。自動で再開されます（最大5分）。</p>
                ) : s.status === "pending" ? (
                  <p className="mt-2 text-xs text-muted-foreground">分析中です…</p>
                ) : null}
                {s.status === "failed" ? (
                  <p className="mt-2 text-xs text-red-700">
                    分析に失敗しました。対象が非公開/削除されていないかご確認ください。
                    {s.type === "own_posts"
                      ? "上の「再取り込み」からやり直せます。"
                      : "削除して再登録するとやり直せます。"}
                  </p>
                ) : null}
                {s.status !== "removing" ? (
                  <button
                    className="mt-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                    disabled={pending || removing}
                    onClick={() => remove(s.id)}
                    type="button"
                  >
                    削除
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
