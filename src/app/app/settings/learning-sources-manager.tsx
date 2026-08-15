"use client";

import { useEffect, useState, useTransition } from "react";

import {
  addLearningSourceAction,
  listLearningSourcesAction,
  removeLearningSourceAction,
} from "@/app/actions/learning-sources";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatJst } from "@/lib/format";
import type { LearningSourceView } from "@/lib/learning-sources";
import { CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

/**
 * 参考ソース（L-1/L-2, 要件06 §9, T-M5-07）。参考アカウント/参考投稿の追加（type別上限）、
 * 削除、進行/失敗表示、removing中の生成停止案内。アカウント設定タブの一番下に置く（T-M8-103）。
 * 「自分の過去投稿から学習」（own_posts・30日制御）は T-M8-103 で廃止——毎朝の投稿分析（K-2）が
 * 自分の投稿の分析を担うため重複機能になった。
 */

const REF_ACCOUNT_MAX = 3;
const REF_POST_MAX = 10;
const TYPE_LABEL: Record<string, string> = {
  ref_account: "参考アカウント",
  ref_post: "参考投稿",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "分析待ち",
  analyzed: "反映済み",
  failed: "失敗",
  removing: "削除処理中",
};
/**
 * 状態→色は**意味で決める**（`Badge` の tone・デザイン §カラー）。x-accounts と同じ形にして、
 * 状態色の決め方をアプリ全体で1つに揃える（T-M8-36）。
 *
 * 以前は背景色・文字色の指定が無い生の span で、4状態が**すべて同じ見た目**だった。
 * 学習の失敗はアカウント.mdへ知見が反映されない状態なので、一覧をざっと見て気付けないと実害がある。
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  pending: "info",
  analyzed: "success",
  failed: "danger",
  removing: "warn",
};

function uuid(): string {
  return crypto.randomUUID();
}

export function LearningSourcesManager({
  xAccountId,
  initialSources,
}: {
  xAccountId: string;
  initialSources: LearningSourceView[];
}) {
  const [pending, startTransition] = useTransition();
  const [sources, setSources] = useState<LearningSourceView[]>(initialSources);
  const [type, setType] = useState<"ref_account" | "ref_post">("ref_account");
  const [url, setUrl] = useState("");
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());

  // pending の経過秒（>60秒で遅延案内）を判定するため定期的に現在時刻を更新する。
  useEffect(() => {
    if (!sources.some((s) => s.status === "pending" || s.status === "removing")) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [sources]);

  const refCount = (t: string) => sources.filter((s) => s.type === t).length;
  const removing = sources.some((s) => s.status === "removing");

  async function refresh() {
    const res = await listLearningSourcesAction();
    if (res.status === "success" && res.sources) setSources(res.sources);
  }

  /** 失敗をトーストで伝える（T-M8-18）。設定導線があれば一緒に載せる。 */
  function showError(res: { message?: string; details?: Record<string, unknown> }) {
    const path = res.details?.settingsPath;
    toast.show({
      tone: "error",
      title: "実行できませんでした",
      description: res.message ?? "処理に失敗しました。",
      ...(typeof path === "string" ? { action: { href: path, label: "設定を開く" } } : {}),
    });
  }

  function add() {
    // 押せない状態にしてあるので通常は到達しない（保険）。**黙って return しない**のが要点で、
    // 以前はここで無言で抜けており、ボタンは押せるのに何も起きなかった（T-M8-37）。
    if (!url.trim()) {
      toast.show({ tone: "error", title: "XのURLを入力してください" });
      return;
    }
    startTransition(async () => {
      const res = await addLearningSourceAction({ request_key: uuid(), x_account_id: xAccountId, type, url: url.trim() });
      if (res.status === "success") {
        setUrl("");
        toast.show({ tone: "success", title: "学習ソースを追加しました" });
        await refresh();
      } else {
        showError(res);
      }
    });
  }

  function remove(sourceId: string) {
    if (!confirm("この学習ソースを削除しますか？反映済みの場合はアカウント.mdから知見を取り除く処理が実行されます。")) return;
    startTransition(async () => {
      const res = await removeLearningSourceAction({ request_key: uuid(), x_account_id: xAccountId, source_id: sourceId });
      if (res.status === "success") {
        toast.show({ tone: "success", title: "学習ソースを削除しました" });
        await refresh();
      } else {
        showError(res);
      }
    });
  }

  function isStalePending(s: LearningSourceView): boolean {
    return s.status === "pending" && now - new Date(s.updatedAt).getTime() > 60_000;
  }

  return (
    <div className="space-y-6">
      {removing ? (
        <Notice tone="warn">
          学習ソースの削除処理中です。削除が完了するまで、このアカウントの新規生成を一時停止しています。
        </Notice>
      ) : null}

      {/* 追加フォーム（参考アカウント/参考投稿） */}
      <section className="rounded-card border border-hairline bg-surface p-4">
        <CardTitle>参考ソースを追加</CardTitle>
        {/* 上限は種別セレクトの (n/3) 表示に一本化する（T-M8-66）。 */}
        <p className="mt-1 text-xs text-muted-foreground">
          参考にしたいXアカウントや投稿のURLを登録すると、文体・型を学習してアカウント.mdへ反映します。
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs font-semibold text-muted-foreground">種別</span>
            <select
              className="mt-1 min-h-11 rounded-lg border bg-background px-3"
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
              className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"
              onChange={(e) => setUrl(e.target.value)}
              placeholder={type === "ref_account" ? "https://x.com/handle" : "https://x.com/handle/status/123"}
              type="url"
              value={url}
            />
          </label>
          <button
            className="inline-flex h-9 items-center rounded-card bg-brand px-4 text-body font-medium text-white transition-colors duration-150 hover:bg-brand-hover disabled:opacity-50"
            disabled={
              pending ||
              removing ||
              !url.trim() ||
              refCount(type) >= (type === "ref_account" ? REF_ACCOUNT_MAX : REF_POST_MAX)
            }
            onClick={add}
            type="button"
          >
            追加
          </button>
        </div>
        {/* **押せない理由を出す**（T-M8-37）。無効化だけだと壊れているのか区別できない。 */}
        {!url.trim() && !removing ? (
          <p className="mt-2 text-xs text-muted-foreground">XのURLを入力すると追加できます。</p>
        ) : null}
      </section>

      {/* 一覧 */}
      <section>
        <CardTitle>登録済みの学習ソース</CardTitle>
        {sources.length === 0 ? (
          <p className="mt-2 rounded-card border bg-background px-4 py-8 text-center text-sm text-muted-foreground">
            まだ学習ソースはありません。
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sources.map((s) => (
              <li className="rounded-card border border-hairline bg-surface p-4" key={s.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{TYPE_LABEL[s.type] ?? s.type}</Badge>
                  <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">分析日時: {formatJst(s.updatedAt)}</span>
                </div>
                {s.url ? (
                  <a className="mt-1 block truncate text-sm hover:underline" href={s.url} rel="noopener noreferrer" target="_blank">
                    {s.url}
                  </a>
                ) : null}
                {isStalePending(s) ? (
                  <p className="mt-2 text-xs text-warn-fg">開始が遅れています。自動で再開されます（最大5分）。</p>
                ) : s.status === "pending" ? (
                  <p className="mt-2 text-xs text-muted-foreground">分析中です…</p>
                ) : null}
                {s.status === "failed" ? (
                  <p className="mt-2 text-xs text-danger-fg">
                    分析に失敗しました。対象が非公開/削除されていないかご確認ください。
                    削除して再登録するとやり直せます。
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
