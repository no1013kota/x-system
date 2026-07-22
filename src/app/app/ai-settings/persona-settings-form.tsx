"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { updatePersonaSettings } from "@/app/actions/persona-settings";
import {
  personaSettingsSchema,
  type PersonaSettings,
} from "@/lib/persona-settings";
import { THEME_OPTIONS, type ThemeId } from "@/lib/themes";

interface PersonaSettingsFormProps {
  accountHandle: string;
  baseMdVersion: number;
  initialDifference: boolean;
  initialSettings: PersonaSettings;
  xAccountId: string;
}

const inputClassName =
  "mt-2 min-h-11 w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const groupClassName = "rounded-2xl border bg-card p-5 shadow-sm sm:p-6";

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function PersonaSettingsForm({
  accountHandle,
  baseMdVersion,
  initialDifference,
  initialSettings,
  xAccountId,
}: PersonaSettingsFormProps) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [version, setVersion] = useState(baseMdVersion);
  const [dirty, setDirty] = useState(false);
  const [savedDifference, setSavedDifference] = useState(initialDifference);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"error" | "success" | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const updateSettings = (next: PersonaSettings) => {
    setSettings(next);
    setDirty(true);
    setStatus(null);
    setMessage("");
  };
  const errorFor = (path: string) => fieldErrors[path]?.[0];

  const toggleTheme = (
    group: "primary" | "secondary",
    themeId: ThemeId,
    checked: boolean,
  ) => {
    const other = group === "primary" ? "secondary" : "primary";
    const nextGroup = checked
      ? [...settings.themes[group], themeId]
      : settings.themes[group].filter((id) => id !== themeId);
    updateSettings({
      ...settings,
      themes: {
        ...settings.themes,
        [group]: nextGroup,
        [other]: checked
          ? settings.themes[other].filter((id) => id !== themeId)
          : settings.themes[other],
      },
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = personaSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        errors[path] = [...(errors[path] ?? []), issue.message];
      }
      setFieldErrors(errors);
      setStatus("error");
      setMessage("入力内容を確認してください。");
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    const result = await updatePersonaSettings({
      expected_base_md_version: version,
      settings: parsed.data,
      x_account_id: xAccountId,
    });
    setSubmitting(false);
    setStatus(result.status);
    setMessage(result.message);
    if (result.status === "success" && result.version !== undefined) {
      setVersion(result.version);
      setDirty(false);
      setSavedDifference(false);
      router.refresh();
    }
  };

  return (
    <form className="space-y-6" noValidate onSubmit={submit}>
      <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span>
          対象アカウント: <strong>@{accountHandle}</strong>
        </span>
        <span className="font-mono text-xs">base_md version {version}</span>
      </div>

      {version >= 1 && (savedDifference || dirty) ? (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
          role="status"
        >
          保存すると、現行ベースmdのセクション1〜4をこのフォーム内容で上書きします。学習で作られたセクション5〜6は保持されます。
        </div>
      ) : null}

      <fieldset className={groupClassName}>
        <legend className="px-1 text-lg font-semibold">ペルソナ</legend>
        <p className="mt-1 text-sm text-muted-foreground">
          誰が、誰に、どんな価値を届けるかを定義します。
        </p>
        <div className="mt-5 grid gap-5">
          {([
            ["speaker", "発信者", "例: 中小企業向け業務改善コンサルタント"],
            ["audience", "対象読者", "例: 従業員30名以下の経営者"],
            ["value", "提供価値", "例: 明日の実務で使える効率化"],
          ] as const).map(([field, label, placeholder]) => {
            const path = `persona.${field}`;
            const error = errorFor(path);
            return (
              <div key={field}>
                <label className="text-sm font-medium" htmlFor={path}>
                  {label} <span aria-hidden="true">*</span>
                </label>
                <input
                  aria-describedby={error ? `${path}-error` : undefined}
                  aria-invalid={Boolean(error)}
                  className={inputClassName}
                  id={path}
                  onChange={(event) =>
                    updateSettings({
                      ...settings,
                      persona: {
                        ...settings.persona,
                        [field]: event.target.value,
                      },
                    })
                  }
                  placeholder={placeholder}
                  value={settings.persona[field]}
                />
                {error ? (
                  <p className="mt-2 text-sm text-destructive" id={`${path}-error`}>
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset
        aria-describedby={errorFor("themes.primary") ? "themes-primary-error" : undefined}
        className={groupClassName}
      >
        <legend className="px-1 text-lg font-semibold">テーマ</legend>
        <p className="mt-1 text-sm text-muted-foreground">
          主テーマを1件以上選択してください。同じテーマを主・副の両方には設定できません。
        </p>
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          {(["primary", "secondary"] as const).map((group) => (
            <div key={group}>
              <p className="text-sm font-medium">
                {group === "primary" ? "主テーマ *" : "副テーマ（任意）"}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {THEME_OPTIONS.map((theme) => (
                  <label
                    className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
                    key={theme.id}
                  >
                    <input
                      checked={settings.themes[group].includes(theme.id)}
                      onChange={(event) =>
                        toggleTheme(group, theme.id, event.target.checked)
                      }
                      type="checkbox"
                    />
                    {theme.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        {errorFor("themes.primary") ? (
          <p className="mt-3 text-sm text-destructive" id="themes-primary-error">
            主テーマを1件以上選択してください。
          </p>
        ) : null}
        <div className="mt-5">
          <label className="text-sm font-medium" htmlFor="themes.free_text">
            自由入力テーマ（任意）
          </label>
          <input
            className={inputClassName}
            id="themes.free_text"
            onChange={(event) =>
              updateSettings({
                ...settings,
                themes: { ...settings.themes, free_text: event.target.value },
              })
            }
            value={settings.themes.free_text}
          />
        </div>
      </fieldset>

      <fieldset className={groupClassName}>
        <legend className="px-1 text-lg font-semibold">トーン</legend>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium" htmlFor="tone.sentence_style">
              文末
            </label>
            <select
              className={inputClassName}
              id="tone.sentence_style"
              onChange={(event) =>
                updateSettings({
                  ...settings,
                  tone: {
                    ...settings.tone,
                    sentence_style: event.target.value as "polite" | "assertive",
                  },
                })
              }
              value={settings.tone.sentence_style}
            >
              <option value="polite">です・ます調</option>
              <option value="assertive">断定調</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="tone.first_person">
              一人称
            </label>
            <input
              className={inputClassName}
              id="tone.first_person"
              onChange={(event) =>
                updateSettings({
                  ...settings,
                  tone: { ...settings.tone, first_person: event.target.value },
                })
              }
              value={settings.tone.first_person}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="tone.emoji_policy">
              絵文字
            </label>
            <select
              className={inputClassName}
              id="tone.emoji_policy"
              onChange={(event) => {
                const emojiPolicy = event.target.value as "none" | "limited";
                updateSettings({
                  ...settings,
                  tone: {
                    ...settings.tone,
                    emoji_max_per_post:
                      emojiPolicy === "none"
                        ? 0
                        : Math.max(settings.tone.emoji_max_per_post, 1),
                    emoji_policy: emojiPolicy,
                  },
                });
              }}
              value={settings.tone.emoji_policy}
            >
              <option value="limited">上限を設定して使う</option>
              <option value="none">使わない</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="tone.emoji_max_per_post">
              1ポストの絵文字上限
            </label>
            <input
              className={inputClassName}
              disabled={settings.tone.emoji_policy === "none"}
              id="tone.emoji_max_per_post"
              min={0}
              onChange={(event) =>
                updateSettings({
                  ...settings,
                  tone: {
                    ...settings.tone,
                    emoji_max_per_post: Number(event.target.value),
                  },
                })
              }
              type="number"
              value={settings.tone.emoji_max_per_post}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="tone.hashtags_max">
              ハッシュタグ上限
            </label>
            <input
              className={inputClassName}
              id="tone.hashtags_max"
              min={0}
              onChange={(event) =>
                updateSettings({
                  ...settings,
                  tone: {
                    ...settings.tone,
                    hashtags_max: Number(event.target.value),
                  },
                })
              }
              type="number"
              value={settings.tone.hashtags_max}
            />
          </div>
          <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border px-3 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            <input
              checked={settings.tone.thread_numbering}
              onChange={(event) =>
                updateSettings({
                  ...settings,
                  tone: {
                    ...settings.tone,
                    thread_numbering: event.target.checked,
                  },
                })
              }
              type="checkbox"
            />
            スレッド番号を付ける
          </label>
        </div>
      </fieldset>

      <fieldset className={groupClassName}>
        <legend className="px-1 text-lg font-semibold">NG設定（任意）</legend>
        <p className="mt-1 text-sm text-muted-foreground">
          1行に1件ずつ入力してください。すべて空でも保存できます。
        </p>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {([
            ["words", "NGワード"],
            ["topics", "NGトピック"],
            ["rules", "自由ルール"],
          ] as const).map(([field, label]) => (
            <div key={field}>
              <label className="text-sm font-medium" htmlFor={`ng.${field}`}>
                {label}
              </label>
              <textarea
                className={`${inputClassName} min-h-28`}
                id={`ng.${field}`}
                onChange={(event) =>
                  updateSettings({
                    ...settings,
                    ng: { ...settings.ng, [field]: lines(event.target.value) },
                  })
                }
                value={settings.ng[field].join("\n")}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {message ? (
        <p
          className={`rounded-lg border p-3 text-sm ${
            status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
          role={status === "success" ? "status" : "alert"}
        >
          {message}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          className="min-h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "保存しています…" : "発信設定を保存"}
        </button>
      </div>
    </form>
  );
}
