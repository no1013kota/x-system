"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
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

const TYPE_LABEL: Record<(typeof NOTIFICATION_TYPES)[number], string> = {
  news: "ニュース",
  draft_created: "下書き作成",
  posted: "投稿完了",
  error: "エラー",
  billing: "課金",
  usage: "利用枠",
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
const ALL_CATEGORIES = ["ai", "web3", "investment", "business", "business_ops", "sns"];
const ALL_IMPACTS = ["high", "mid", "low"];

interface Notice {
  message: string;
  tone: "error" | "success";
}

function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      className={`mt-3 rounded-lg border p-2.5 text-sm ${
        notice.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-red-200 bg-red-50 text-red-900"
      }`}
      role={notice.tone === "success" ? "status" : "alert"}
    >
      {notice.message}
    </p>
  );
}

function ProfileForm({ displayName }: { displayName: string | null }) {
  const [value, setValue] = useState(displayName ?? "");
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">プロフィール</h2>
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
              setNotice(null);
              const res = await updateProfileAction({ display_name: value });
              setNotice({ message: res.message, tone: res.status });
            })
          }
          size="lg"
          type="button"
        >
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
      <NoticeLine notice={notice} />
    </section>
  );
}

function NotificationForm({ config }: { config: NotificationConfig }) {
  const [state, setState] = useState<NotificationConfig>(config);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  const toggle = (
    type: (typeof NOTIFICATION_TYPES)[number],
    channel: "in_app" | "email",
  ) =>
    setState((prev) => ({
      ...prev,
      [type]: { ...prev[type], [channel]: !prev[type][channel] },
    }));
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">通知</h2>
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
              setNotice(null);
              const res = await updateNotificationConfigAction(state);
              setNotice({ message: res.message, tone: res.status });
            })
          }
          size="lg"
          type="button"
        >
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
      <NoticeLine notice={notice} />
    </section>
  );
}

function NewsForm({ config }: { config: NewsConfig }) {
  const [categories, setCategories] = useState<string[]>(config.categories);
  const [impacts, setImpacts] = useState<string[]>(config.impact_filter);
  const [maxItems, setMaxItems] = useState(config.max_items);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice | null>(null);
  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const invalid = categories.length === 0 || impacts.length === 0;
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">ニュース通知</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        ニュースはJST 9:00〜20:00の取得時刻ごとに最大1件へ集約されて届きます。設定条件に一致する新着が
        0件の時刻には通知は届きません。ここでの分野・インパクト・表示件数は一覧表示にも適用されます。
      </p>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">分野（1件以上）</legend>
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
        className="mt-1 h-10 w-28 rounded-lg border px-3 text-sm"
        id="max_items"
        max={100}
        min={1}
        onChange={(e) => setMaxItems(Number(e.target.value))}
        type="number"
        value={maxItems}
      />

      <div className="mt-4">
        <Button
          disabled={pending || invalid}
          onClick={() =>
            startTransition(async () => {
              setNotice(null);
              const res = await updateNewsConfigAction({
                categories,
                impact_filter: impacts,
                max_items: maxItems,
              });
              setNotice({ message: res.message, tone: res.status });
            })
          }
          size="lg"
          type="button"
        >
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
      {invalid ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          分野とインパクトはそれぞれ1件以上選択してください。
        </p>
      ) : null}
      <NoticeLine notice={notice} />
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
  return (
    <div className="space-y-6">
      <ProfileForm displayName={displayName} />
      <NotificationForm config={notificationConfig} />
      <NewsForm config={newsConfig} />
    </div>
  );
}
