"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  updateNewsConfigAction,
  updateNotificationConfigAction,
} from "@/app/actions/settings";
import {
  NOTIFICATION_TYPES,
  type NewsConfig,
  type NotificationConfig,
} from "@/lib/settings";
import { NEWS_FETCH_CATEGORIES } from "@/lib/news";
import { Card, CardTitle } from "@/components/ui/card";

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
    <Card as="section" className="px-5 py-4">
      <CardTitle>通知</CardTitle>
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
                <td className="text-center" key={channel}>
                  {/* タップ対象はラベル全体（約40px四方）。素のcheckboxは13px四方しかない（T-M8-70）。 */}
                  <label className="inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center">
                    <input
                      aria-label={`${TYPE_LABEL[type]}の${channel === "in_app" ? "アプリ内" : "メール"}通知`}
                      checked={state[type][channel]}
                      className="size-4"
                      onChange={() => toggle(type, channel)}
                      type="checkbox"
                    />
                  </label>
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
    </Card>
  );
}

function NewsForm({ config }: { config: NewsConfig }) {
  const [categories, setCategories] = useState<string[]>(config.categories);
  const [impacts, setImpacts] = useState<string[]>(config.impact_filter);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  // 表示件数の欄はT-M8-187で廃止（一覧は最新500件・50件ずつのページ表示。T-M8-188）。
  const invalid = categories.length === 0 || impacts.length === 0;
  return (
    <Card as="section" className="px-5 py-4">
      <CardTitle>ニュース通知</CardTitle>
      {/* 集約仕様・0件時の配信条件は読まなくても操作できる内部説明のため書かない（T-M8-66）。 */}
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        ニュースは10:00〜20:00（日本時間）に2時間おきに届きます。ここでの設定は通知の対象を決めます（一覧は最新500件を表示します）。
      </p>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">テーマ（1件以上）</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {ALL_CATEGORIES.map((c) => (
            <label className="flex min-h-9 cursor-pointer items-center gap-1.5 pr-1 text-sm" key={c}>
              <input
                checked={categories.includes(c)}
                className="size-4"
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
            <label className="flex min-h-9 cursor-pointer items-center gap-1.5 pr-1 text-sm" key={i}>
              <input
                checked={impacts.includes(i)}
                className="size-4"
                onChange={() => toggle(impacts, setImpacts, i)}
                type="checkbox"
              />
              {IMPACT_LABEL[i]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <Button
          disabled={pending || invalid}
          onClick={() =>
            startTransition(async () => {
              const res = await updateNewsConfigAction({
                categories,
                impact_filter: impacts,
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
        <p className="mt-3 text-sm text-destructive" role="alert">
          テーマとインパクトはそれぞれ1件以上選択してください。
        </p>
      ) : null}
    </Card>
  );
}

export function SettingsPreferences({
  notificationConfig,
  newsConfig,
}: {
  notificationConfig: NotificationConfig;
  newsConfig: NewsConfig;
}) {
  // 2カラム（デザイン §設定）。1カラムのままだと、幅の広い画面で**中身は狭いのに縦に長い**という
  // 一番読みにくい形になる（デスクトップ最適化・2026-08-02 決定）。列は高さの近いもので分ける。
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <NotificationForm config={notificationConfig} />
      {/* 表示名（プロフィール）は削除した（T-M8-59）。どこにも使われておらず、
          「何のための入力か分からない欄」だけが残っていた（2026-08-05 ユーザー判断）。 */}
      <NewsForm config={newsConfig} />
    </div>
  );
}
