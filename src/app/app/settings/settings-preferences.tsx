"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  updateNewsConfigAction,
  updateNewsEmailNotificationAction,
  updateNotificationConfigAction,
} from "@/app/actions/settings";
import {
  NOTIFICATION_TYPES,
  type NewsConfig,
  type NotificationConfig,
} from "@/lib/settings";
import { NEWS_FETCH_CATEGORIES } from "@/lib/news";
import { Card, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

/**
 * 通知はアプリ内のみ（メール通知はT-M8-222で廃止・運営者の指示 2026-08-22）。
 * 旧「種別×アプリ内/メール」の表を、種別ごとの説明つきトグル行へ刷新した。
 */

const TYPE_LABEL: Record<(typeof NOTIFICATION_TYPES)[number], string> = {
  news: "ニュース",
  draft_created: "下書き作成",
  posted: "投稿完了",
  error: "エラー",
  billing: "課金",
  usage: "利用枠",
  summary: "毎日のまとめ",
};

/** 種別が何を届けるか。名前だけでは「課金」「利用枠」が何の通知か読めない。 */
const TYPE_DESCRIPTION: Record<(typeof NOTIFICATION_TYPES)[number], string> = {
  news: "設定した条件に合う新着ニュースのダイジェスト",
  draft_created: "投稿の下書きができたとき",
  posted: "予約・自動投稿が完了したとき",
  error: "生成・投稿・X連携が失敗したとき",
  billing: "お支払いを確認できなかったとき",
  usage: "利用枠の残りが少なくなったとき",
  summary: "運用状況の毎日のまとめレポート",
};

const CATEGORY_LABEL: Record<string, string> = {
  ai: "AI",
  web3: "Web3",
  sns: "SNS",
  investment: "投資",
  love: "恋愛",
  beauty: "美容",
  // 旧分野（運用終了・T-M8-189）。古い保存値の表示用に残す。
  business: "ビジネス",
  business_ops: "業務効率化",
};
const IMPACT_LABEL: Record<string, string> = { high: "高", mid: "中", low: "低" };
// **選べるのは実際に取得している分野だけ**にする（T-M7-55）。取得していない分野を選べると、
// 設定はできるのに記事が永久に0件という「黙って壊れた」状態になる（CLAUDE.md 原則1）。
const ALL_CATEGORIES: readonly string[] = NEWS_FETCH_CATEGORIES;
const ALL_IMPACTS = ["high", "mid", "low"];

/**
 * トグルスイッチ。素のcheckboxは13px四方でタップしづらく、ON/OFFの現在値も読み取りにくい
 * （T-M8-70と同じ理由）。checkboxを`sr-only`にしてスイッチの見た目を重ね、状態は色＋ノブ位置で示す。
 */
function ToggleSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center p-1">
      <input
        aria-label={label}
        checked={checked}
        className="peer sr-only"
        disabled={disabled}
        onChange={onChange}
        type="checkbox"
      />
      <span className="h-6 w-10 rounded-pill bg-black/15 transition-colors duration-150 peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50" />
      <span className="pointer-events-none absolute left-1.5 top-1/2 size-5 -translate-y-1/2 rounded-pill bg-surface shadow-sm transition-transform duration-150 motion-reduce:transition-none peer-checked:translate-x-4" />
    </label>
  );
}

/** チップ型の複数選択。選択中は色だけでなくチェックアイコンでも示す（色覚に依存しない）。 */
function ChipCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-pill border px-3 text-body transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
        checked
          ? "border-brand/50 bg-brand-subtle font-medium text-brand"
          : "border-hairline bg-surface text-ink-2 hover:bg-black/[0.02]"
      }`}
    >
      <input checked={checked} className="sr-only" onChange={onChange} type="checkbox" />
      {checked ? <Icon name="check" size={14} /> : null}
      {label}
    </label>
  );
}

function NotificationForm({ config }: { config: NotificationConfig }) {
  const [state, setState] = useState<NotificationConfig>(config);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const toggle = (type: (typeof NOTIFICATION_TYPES)[number]) =>
    setState((prev) => ({
      ...prev,
      [type]: { ...prev[type], in_app: !prev[type].in_app },
    }));
  return (
    <Card as="section" className="px-5 py-4">
      <CardTitle>アプリ内通知</CardTitle>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        受け取る通知を選べます。通知は画面右上のベルに届きます。
      </p>
      <ul className="mt-3 divide-y divide-hairline">
        {NOTIFICATION_TYPES.map((type) => (
          <li className="flex items-center justify-between gap-3 py-2.5" key={type}>
            <span className="min-w-0">
              <span className="block text-body font-medium text-ink">{TYPE_LABEL[type]}</span>
              <span className="mt-0.5 block text-caption leading-4 text-ink-3">
                {TYPE_DESCRIPTION[type]}
              </span>
            </span>
            <ToggleSwitch
              checked={state[type].in_app}
              disabled={pending}
              label={`${TYPE_LABEL[type]}の通知`}
              onChange={() => toggle(type)}
            />
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              // **in_app だけを送る**（T-M8-407）。ニュースの email はニュース通知カードが持つ値なので、
              // ここから送ると画面を開いた時点の古い値で上書きしてしまう（省略＝保存済みを保つ）。
              const res = await updateNotificationConfigAction(
                Object.fromEntries(
                  NOTIFICATION_TYPES.map((type) => [type, { in_app: state[type].in_app }]),
                ),
              );
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

function NewsForm({
  config,
  emailEnabled,
}: {
  config: NewsConfig;
  /** ニュース通知をメールでも受け取るか（`notification_config.news.email`・T-M8-407）。 */
  emailEnabled: boolean;
}) {
  const [categories, setCategories] = useState<string[]>(config.categories);
  const [impacts, setImpacts] = useState<string[]>(config.impact_filter);
  const [email, setEmail] = useState(emailEnabled);
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
        ニュースは10分おきに新着を確認し、該当する新着があった時間帯に1時間1回までまとめて届きます。ここでは通知するニュースの条件を選びます。
      </p>

      <fieldset className="mt-4">
        <legend className="text-body font-medium">テーマ（1件以上）</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALL_CATEGORIES.map((c) => (
            <ChipCheckbox
              checked={categories.includes(c)}
              key={c}
              label={CATEGORY_LABEL[c]}
              onChange={() => toggle(categories, setCategories, c)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-body font-medium">インパクト（1件以上）</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALL_IMPACTS.map((i) => (
            <ChipCheckbox
              checked={impacts.includes(i)}
              key={i}
              label={IMPACT_LABEL[i]}
              onChange={() => toggle(impacts, setImpacts, i)}
            />
          ))}
        </div>
      </fieldset>

      {/*
        **メールでも受け取る**（T-M8-407・運営者の指示 2026-09-01）。アプリ内通知（左のカード）とは
        別に保存する（`updateNewsEmailNotificationAction`）——2つの画面が互いの値を上書きしない。
        宛先はログイン中のメールアドレス（変更欄は持たない）。
      */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-4">
        <span className="min-w-0">
          <span className="block text-body font-medium text-ink">メールでも受け取る</span>
          <span className="mt-0.5 block text-caption leading-4 text-ink-3">
            登録メールアドレス宛に、アプリ内通知と同じ内容（件数・見出し・一覧リンク）が届きます。
          </span>
        </span>
        <ToggleSwitch
          checked={email}
          disabled={pending}
          label="ニュース通知をメールでも受け取る"
          onChange={() => setEmail((v) => !v)}
        />
      </div>

      <div className="mt-4">
        <Button
          disabled={pending || invalid}
          onClick={() =>
            startTransition(async () => {
              const res = await updateNewsConfigAction({
                categories,
                impact_filter: impacts,
              });
              // 条件が保存できたらメール設定も保存する（片方だけ失敗したときは、その旨を言う）。
              const mail =
                res.status === "success"
                  ? await updateNewsEmailNotificationAction({ email })
                  : null;
              const ok = res.status === "success" && mail?.status === "success";
              toast.show({
                tone: ok ? "success" : "error",
                title: ok ? "ニュース設定を保存しました" : "保存できませんでした",
                description: ok
                  ? undefined
                  : res.status !== "success"
                    ? res.message
                    : `通知の条件は保存しましたが、メール設定を保存できませんでした。${mail?.message ?? ""}`,
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
      <NewsForm config={newsConfig} emailEnabled={notificationConfig.news.email} />
    </div>
  );
}
