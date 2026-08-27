"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { updatePersonaSettings } from "@/app/actions/persona-settings";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";

import {
  FREE_SECTION_MAX_CHARS,
  personaSettingsSchema,
  type PersonaSettings,
} from "@/lib/persona-settings";
import { OPERATED_THEME_OPTIONS, THEME_OPTIONS, type ThemeId } from "@/lib/themes";
import { cardClassName, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

interface PersonaSettingsFormProps {
  baseMdVersion: number;
  initialDifference: boolean;
  initialSettings: PersonaSettings;
  /**
   * 参考ソースから作った**保存前の提案**（T-M8-349・運営者の指示 2026-08-28）。
   * あるときは各欄をこの値で埋め、「保存すると確定する」ことを画面で言う。
   * null は「提案が無い」——保存済みの設定をそのまま出す。
   */
  proposal: PersonaSettings | null;
  /**
   * アカウント.mdの手書きセクション（T-M8-355・運営者の指示 2026-08-28）。
   * 1〜4はこのフォームから機械生成されるが、5〜6は人が書く場所で、これまでは
   * プロンプト画面のmdエディタからしか触れなかった。**同じ画面で書けるようにする。**
   */
  initialVoice: string;
  initialReferenceStyle: string;
  xAccountId: string;
}

const inputClassName =
  "mt-2 min-h-11 w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
/**
 * 入力の束（T-M8-23）。
 *
 * **`<fieldset>` + `<legend>` は使わない。** `<legend>` はブラウザがカードの上枠の中へ描くため、
 * 枠線が途切れて背景の灰色が覗く。`display:block` では直らず、`float` で流れへ戻すと
 * 中の grid が崩れる（実際に崩した）。`role="group"` ＋ `aria-labelledby` で読み上げ上の
 * グループは保ったまま、見出しを普通の要素にしてレイアウトを取り戻す。
 *
 * **カードは1枚**（T-M8-349・運営者の指示 2026-08-28）。以前は ペルソナ／テーマ／トーン／NG設定 が
 * それぞれ独立したカードで、間に灰色の地が見えて「4つの別の設定」に見えていた。
 * 中は区切り線で分ける——ひと続きの1つの設定であることを形で示す。
 */
const groupClassName = "border-t border-hairline pt-6 first:border-t-0 first:pt-0";

type NgField = "words" | "topics" | "rules";

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function PersonaSettingsForm({
  baseMdVersion,
  initialDifference,
  initialReferenceStyle,
  initialSettings,
  initialVoice,
  proposal,
  xAccountId,
}: PersonaSettingsFormProps) {
  const router = useRouter();
  /*
    **提案があればそれを出す**（T-M8-349）。参考ソースからの反映は保存前の下書きなので、
    保存済みの値ではなく提案を欄へ入れる。保存するまで `settings` は変わらない。
  */
  const [settings, setSettings] = useState(proposal ?? initialSettings);
  const [version, setVersion] = useState(baseMdVersion);
  const [dirty, setDirty] = useState(false);
  /** 提案を表示中か（保存すると消える）。 */
  const [showProposal, setShowProposal] = useState(proposal != null);
  /*
    アカウント.mdの5・6セクション（T-M8-355）。**参考ソースの反映では変わらない**——
    反映が書き換えるのは1〜4（ペルソナ〜NG設定）だけで、ここは人が書く場所。
  */
  const [voice, setVoice] = useState(initialVoice);
  const [referenceStyle, setReferenceStyle] = useState(initialReferenceStyle);
  const [savedDifference, setSavedDifference] = useState(initialDifference);
  const [submitting, setSubmitting] = useState(false);
  /**
   * **入力検証のまとめだけ**を画面に残す（T-M8-18）。項目ごとのエラーの直上に置く必要があるため
   * トーストにしない。保存の成否（サーバの応答）はトーストへ出す。
   */
  const [validationMessage, setValidationMessage] = useState("");
  const toast = useToast();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  // NG設定は入力中の生テキストを保持する。表示値を正規化済み配列から作ると、改行した瞬間に
  // 末尾の空行が捨てられて2行目が打てなくなるため（保存する値は従来どおり正規化した配列）。
  const [ngText, setNgText] = useState<Record<NgField, string>>(() => {
    const base = proposal ?? initialSettings;
    return {
      rules: base.ng.rules.join("\n"),
      topics: base.ng.topics.join("\n"),
      words: base.ng.words.join("\n"),
    };
  });

  const updateSettings = (next: PersonaSettings) => {
    setSettings(next);
    setDirty(true);
    setValidationMessage("");
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
      setValidationMessage("入力内容を確認してください。");
      return;
    }
    setFieldErrors({});
    setValidationMessage("");
    setSubmitting(true);
    const result = await updatePersonaSettings({
      expected_base_md_version: version,
      reference_style: referenceStyle,
      settings: parsed.data,
      voice,
      x_account_id: xAccountId,
    });
    setSubmitting(false);
    if (result.status !== "success") {
      toast.show({ tone: "error", title: "保存できませんでした", description: result.message });
      return;
    }
    toast.show({ tone: "success", title: "アカウント設定を保存しました" });
    if (result.version !== undefined) {
      setVersion(result.version);
      setDirty(false);
      setSavedDifference(false);
      setShowProposal(false);
      router.refresh();
    }
  };

  return (
    /*
      **1枚の白いカードに全部入れる**（T-M8-349・運営者の指示 2026-08-28）。
      見出しと説明は置かない（T-M8-346。タブ名が「アカウント設定」なので繰り返さない）。
      対象アカウントの行はタブの直下（`page.tsx`）へ移した——どのアカウントを直しているかは
      **編集を始める前に**見えている必要がある。
    */
    <form className={`${cardClassName} space-y-6 p-5 sm:p-6`} noValidate onSubmit={submit}>
      {/*
        **参考ソースからの反映は保存前の提案**（T-M8-349）。押した瞬間に本番の設定が
        変わると、利用者は中身を見る前に書き換えられてしまう。ここで「まだ保存されていない」
        ことを言い、保存で確定させる（原則1）。
      */}
      {showProposal ? (
        <Notice role="status" tone="info">
          参考ソースから作った内容を入れました。<strong>まだ保存されていません。</strong>
          気になるところを直してから、下の「アカウント設定を保存」を押してください。
        </Notice>
      ) : null}

      {version >= 1 && (savedDifference || dirty) ? (
        // 6セクションのタイトル列挙は読み飛ばされるだけだった（T-M8-66）。
        // 「戻せる」導線があれば安心して保存できるので、要点2文に絞る。
        // 学習の反映先が**この設定そのもの**になった（T-M8-344）ので、
        // 「学習で磨いた分が戻る」という注意は要らなくなった（同じ値を編集している）。
        <Notice tone="warn"
          role="status">
          保存すると、プロンプトのアカウント.mdが書き換えられます。以前の内容は
          <Link className="mx-1 font-medium underline underline-offset-4" href="/app/prompts?sec=account-md">
            プロンプト画面の変更履歴
          </Link>
          からいつでも戻せます。
        </Notice>
      ) : null}

      <section aria-labelledby="persona-group" className={groupClassName} role="group">
        <CardTitle id="persona-group">
          ペルソナ
        </CardTitle>
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
      </section>

      <section
        aria-describedby={errorFor("themes.primary") ? "themes-primary-error" : undefined}
        aria-labelledby="themes-group"
        className={groupClassName}
        role="group"
      >
        <CardTitle id="themes-group">
          テーマ
        </CardTitle>
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
                {/*
                  選択肢は運用中の6テーマ（T-M8-189）。旧テーマ（ビジネス等）は**開いた時点で
                  選択されていたものだけ**出す——編集中stateで判定すると、チェックを外した瞬間に
                  選択肢ごと消えて戻せなくなる（レビュー指摘・T-M8-192）。初期値基準なら
                  外しても選択肢は残り、保存前なら再チェックできる。
                */}
                {[
                  ...OPERATED_THEME_OPTIONS,
                  ...THEME_OPTIONS.filter(
                    (theme) =>
                      !OPERATED_THEME_OPTIONS.some((o) => o.id === theme.id) &&
                      initialSettings.themes[group].includes(theme.id),
                  ),
                ].map((theme) => (
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
      </section>

      <section aria-labelledby="tone-group" className={groupClassName} role="group">
        <CardTitle id="tone-group">
          トーン
        </CardTitle>
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
      </section>

      <section aria-labelledby="ng-group" className={groupClassName} role="group">
        <CardTitle id="ng-group">
          NG設定（任意）
        </CardTitle>
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
                className={inputClassName}
                id={`ng.${field}`}
                // 3行ぶん（投稿作成の追加指示と同じ高さ）。以前は112px固定で、他の入力より
                // 背が高く浮いていた。入りきらない分は利用者が縁を掴んで伸ばせる。
                rows={3}
                onChange={(event) => {
                  const raw = event.target.value;
                  setNgText((current) => ({ ...current, [field]: raw }));
                  updateSettings({
                    ...settings,
                    ng: { ...settings.ng, [field]: lines(raw) },
                  });
                }}
                value={ngText[field]}
              />
            </div>
          ))}
        </div>
      </section>

      {/*
        **アカウント.mdの手書きセクション**（T-M8-355・運営者の指示 2026-08-28）。
        1〜4はこの画面から機械生成されるが、5〜6は人が書く場所で、これまでは
        プロンプト画面のmdエディタからしか触れなかった。同じ画面で書けるようにする。
        **参考ソースの反映では変わらない**——反映が書き換えるのは1〜4だけ。
      */}
      <section aria-labelledby="free-group" className={groupClassName} role="group">
        <CardTitle id="free-group">文体・参考にする型（任意）</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          アカウント.mdの5・6章にそのまま入ります。空でも保存できます。
        </p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {([
            ["voice", "文体・自分らしさ", voice, setVoice, "例: 数字と手順で書く。断定は根拠とセットにする。"],
            [
              "reference",
              "参考にする型",
              referenceStyle,
              setReferenceStyle,
              "例: 結論→理由→具体例→まとめ の4段で書く。",
            ],
          ] as const).map(([id, label, value, setValue, placeholder]) => (
            <div key={id}>
              <label className="text-sm font-medium" htmlFor={`free.${id}`}>
                {label}
              </label>
              <textarea
                className={inputClassName}
                id={`free.${id}`}
                maxLength={FREE_SECTION_MAX_CHARS}
                onChange={(event) => {
                  setValue(event.target.value);
                  setDirty(true);
                }}
                placeholder={placeholder}
                rows={4}
                value={value}
              />
              <p className="mt-1 text-caption text-ink-3">
                {value.length} / {FREE_SECTION_MAX_CHARS}字
              </p>
            </div>
          ))}
        </div>
      </section>

      {validationMessage ? (
        <Notice role="alert" tone="danger">
          {validationMessage}
        </Notice>
      ) : null}

      {/*
        **保存はカードの中の左下**（T-M8-349・運営者の指示 2026-08-28）。
        下の「アカウント設定を反映する」と同じ側に置いて、押す場所を揃える。
      */}
      <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
        <button
          className="min-h-11 rounded-card bg-brand px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "保存しています…" : "アカウント設定を保存"}
        </button>
        <span className="text-caption text-ink-3">
          {version >= 1 ? "保存すると次の生成から反映されます。" : "保存するとアカウント.mdが作られます。"}
        </span>
      </div>
    </form>
  );
}
