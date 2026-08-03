"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  updateNewsConfigAction,
  updateNotificationConfigAction,
  updateProfileAction,
} from "@/app/actions/settings";
import {
  NOTIFICATION_TYPES,
  type NewsConfig,
  type NotificationConfig,
} from "@/lib/settings";
import { NEWS_FETCH_CATEGORIES } from "@/lib/news";
import {
  clampNewsMaxItems,
  NEWS_MAX_ITEMS_MAX,
  NEWS_MAX_ITEMS_MIN,
} from "@/lib/config-defaults";

const TYPE_LABEL: Record<(typeof NOTIFICATION_TYPES)[number], string> = {
  news: "ニュース",
  draft_created: "下書き作成",
  posted: "投稿完了",
  error: "エラー",
  billing: "課金",
  usage: "利用枠",
  summary: "毎日のまとめ",
};
const CATEGORY_LABEL: Record<string, string> = {
  ai: "AI",
  web3: "Web3",
  investment: "投資",
  business: "ビジネス",
  business_ops: "業務効率化",
  sns: "SNS",
};
const IMPACT_LABEL: Record<string, string> = { high: "高", mid: "中", low: "低" };
// **選べるのは実際に取得している分野だけ**にする（T-M7-55）。取得していない分野を選べると、
// 設定はできるのに記事が永久に0件という「黙って壊れた」状態になる（CLAUDE.md 原則1）。
const ALL_CATEGORIES: readonly string[] = NEWS_FETCH_CATEGORIES;
const ALL_IMPACTS = ["high", "mid", "low"];

function ProfileForm({ displayName }: { displayName: string | null }) {
  const [value, setValue] = useState(displayName ?? "");
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  return (
    <section className="rounded-card border border-hairline bg-surface px-5 py-4 shadow-[var(--shadow-card)]">
      <h2 className="text-[15px] font-bold text-ink">プロフィール</h2>
      <label className="mt-4 block text-sm font-medium" htmlFor="display_name">
        表示名
      </label>
      <input
        className="mt-1 h-10 w-full max-w-sm rounded-lg border px-3 text-sm"
        id="display_name"
        maxLength={50}
        onChange={(e) => setValue(e.target.value)}
        value={value}
      />
      <div className="mt-4">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await updateProfileAction({ display_name: value });
              toast.show({
                tone: res.status === "success" ? "success" : "error",
                title: res.status === "success" ? "プロフィールを保存しました" : "保存できませんでした",
                description: res.status === "success" ? undefined : res.message,
              });
            })
          }
          size="lg"
          variant="brand"
          type="button"
        >
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
    </section>
  );
}

function NotificationForm({ config }: { config: NotificationConfig }) {
  const [state, setState] = useState<NotificationConfig>(config);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const toggle = (
    type: (typeof NOTIFICATION_TYPES)[number],
    channel: "in_app" | "email",
  ) =>
    setState((prev) => ({
      ...prev,
      [type]: { ...prev[type], [channel]: !prev[type][channel] },
    }));
  return (
    <section className="rounded-card border border-hairline bg-surface px-5 py-4 shadow-[var(--shadow-card)]">
      <h2 className="text-[15px] font-bold text-ink">通知</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        種別ごとにアプリ内通知とメールの受け取りを設定できます。
      </p>
      <table className="mt-4 w-full max-w-md text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 font-medium">種別</th>
            <th className="py-2 text-center font-medium">アプリ内</th>
            <th className="py-2 text-center font-medium">メール</th>
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_TYPES.map((type) => (
            <tr className="border-b last:border-0" key={type}>
              <td className="py-2">{TYPE_LABEL[type]}</td>
              {(["in_app", "email"] as const).map((channel) => (
                <td className="py-2 text-center" key={channel}>
                  <input
                    aria-label={`${TYPE_LABEL[type]}の${channel === "in_app" ? "アプリ内" : "メール"}通知`}
                    checked={state[type][channel]}
                    onChange={() => toggle(type, channel)}
                    type="checkbox"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await updateNotificationConfigAction(state);
              toast.show({
                tone: res.status === "success" ? "success" : "error",
                title: res.status === "success" ? "通知設定を保存しました" : "保存できませんでした",
                description: res.status === "success" ? undefined : res.message,
              });
            })
          }
          size="lg"
          variant="brand"
          type="button"
        >
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
    </section>
  );
}

function NewsForm({ config }: { config: NewsConfig }) {
  const [categories, setCategories] = useState<string[]>(config.categories);
  const [impacts, setImpacts] = useState<string[]>(config.impact_filter);
  const [maxItems, setMaxItems] = useState(config.max_items);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  // **押す前に止める**（T-M8-37）。以前は件数が対象外で、欄を空にする（`Number("")` → 0）か
  // 101以上を入れた状態でも保存でき、サーバー検証で「入力内容を確認してください」という
  // どの項目が悪いか分からないエラーになっていた。
  const maxItemsInvalid = maxItems < NEWS_MAX_ITEMS_MIN || maxItems > NEWS_MAX_ITEMS_MAX;
  const invalid = categories.length === 0 || impacts.length === 0 || maxItemsInvalid;
  return (
    <section className="rounded-card border border-hairline bg-surface px-5 py-4 shadow-[var(--shadow-card)]">
      <h2 className="text-[15px] font-bold text-ink">ニュース通知</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        ニュースはJST 10:00〜20:00の2時間おきに取得され、取得時刻ごとに最大1件へ集約されて届きます。
        設定条件に一致する新着が0件の時刻には通知は届きません。ここでのテーマ・インパクト・表示件数は
        一覧表示にも適用されます。
      </p>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">テーマ（1件以上）</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {ALL_CATEGORIES.map((c) => (
            <label className="flex items-center gap-1.5 text-sm" key={c}>
              <input
                checked={categories.includes(c)}
                onChange={() => toggle(categories, setCategories, c)}
                type="checkbox"
              />
              {CATEGORY_LABEL[c]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">インパクト（1件以上）</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {ALL_IMPACTS.map((i) => (
            <label className="flex items-center gap-1.5 text-sm" key={i}>
              <input
                checked={impacts.includes(i)}
                onChange={() => toggle(impacts, setImpacts, i)}
                type="checkbox"
              />
              {IMPACT_LABEL[i]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 block text-sm font-medium" htmlFor="max_items">
        表示件数（1〜100）
      </label>
      <input
        aria-describedby="max_items-error"
        aria-invalid={maxItemsInvalid}
        className="mt-1 h-10 w-28 rounded-lg border px-3 text-sm"
        id="max_items"
        max={NEWS_MAX_ITEMS_MAX}
        min={NEWS_MAX_ITEMS_MIN}
        // ニュース一覧の同じ欄と同じ丸め方をする（同じ設定項目が画面によって違う挙動をしない）。
        onChange={(e) => setMaxItems(clampNewsMaxItems(Number(e.target.value)))}
        type="number"
        value={maxItems}
      />

      <div className="mt-4">
        <Button
          disabled={pending || invalid}
          onClick={() =>
            startTransition(async () => {
              const res = await updateNewsConfigAction({
                categories,
                impact_filter: impacts,
                max_items: maxItems,
              });
              toast.show({
                tone: res.status === "success" ? "success" : "error",
                title: res.status === "success" ? "ニュース設定を保存しました" : "保存できませんでした",
                description: res.status === "success" ? undefined : res.message,
              });
            })
          }
          size="lg"
          variant="brand"
          type="button"
        >
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
      {invalid ? (
        <p className="mt-3 text-sm text-destructive" id="max_items-error" role="alert">
          {maxItemsInvalid
            ? `表示件数は${NEWS_MAX_ITEMS_MIN}〜${NEWS_MAX_ITEMS_MAX}で指定してください。`
            : "テーマとインパクトはそれぞれ1件以上選択してください。"}
        </p>
      ) : null}
    </section>
  );
}

export function SettingsPreferences({
  displayName,
  notificationConfig,
  newsConfig,
}: {
  displayName: string | null;
  notificationConfig: NotificationConfig;
  newsConfig: NewsConfig;
}) {
  // 2カラム（デザイン §設定）。1カラムのままだと、幅の広い画面で**中身は狭いのに縦に長い**という
  // 一番読みにくい形になる（デスクトップ最適化・2026-08-02 決定）。列は高さの近いもので分ける。
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <NotificationForm config={notificationConfig} />
      <div className="grid items-start gap-4">
        <ProfileForm displayName={displayName} />
        <NewsForm config={newsConfig} />
      </div>
    </div>
  );
}
