"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  discardSettingsProposal,
  updatePersonaSettings,
} from "@/app/actions/persona-settings";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";

import {
  personaSettingsSchema,
  type PersonaSettings,
} from "@/lib/persona-settings";
import { OPERATED_THEME_OPTIONS, THEME_OPTIONS, type ThemeId } from "@/lib/themes";
import { CardTitle } from "@/components/ui/card";
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
   * 1〜4はこのフォームから機械生成されるが、5（参考にする型）は人が書く場所で、
   * これまではプロンプト画面のmdエディタからしか触れなかった。**同じ画面で書けるようにする。**
   */
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
  initialSettings,
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
  const [discarding, setDiscarding] = useState(false);

  /** 提案を捨てて保存済みの内容へ戻す（T-M8-360）。画面ごと取り直す。 */
  function discardProposal() {
    setDiscarding(true);
    void discardSettingsProposal({ x_account_id: xAccountId })
      .then((res) => {
        if (res.status === "success") {
          setShowProposal(false);
          toast.show({ tone: "success", title: "反映を取り消しました" });
          router.refresh();
        } else {
          toast.show({ tone: "error", title: "取り消せませんでした", description: res.message });
        }
      })
      .finally(() => setDiscarding(false));
  }
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
      settings: parsed.data,
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
      **カードの外枠は `page.tsx` が持つ**（T-M8-356・運営者の指示 2026-08-28）。
      参考ソースの欄をペルソナの上へ入れるため、1枚のカードの中に
      「参考ソース → このフォーム」を並べる。ここで枠を持つと二重の枠になる。
      見出しと説明は置かない（T-M8-346。タブ名が「アカウント設定」なので繰り返さない）。
    */
    <form className="space-y-6" noValidate onSubmit={submit}>
      {/*
        **参考ソースからの反映は保存前の提案**（T-M8-349）。押した瞬間に本番の設定が
        変わると、利用者は中身を見る前に書き換えられてしまう。ここで「まだ保存されていない」
        ことを言い、保存で確定させる（原則1）。
      */}
      {showProposal ? (
        <Notice role="status" tone="info">
          <span className="block">
            参考ソースから作った内容を入れました。<strong>まだ保存されていません。</strong>
            気になるところを直してから、下の「アカウント設定を保存」を押してください。
          </span>
          {/*
            **戻る道を用意する**（T-M8-360）。気に入らない反映から抜ける方法が無いと、
            開くたびに「まだ保存されていません」が出るのに消せない状態になる（原則2）。
          */}
          <button
            className="mt-2 text-caption underline underline-offset-4 hover:no-underline disabled:opacity-60"
            disabled={discarding}
            onClick={discardProposal}
            type="button"
          >
            {discarding ? "取り消しています…" : "この反映を取り消して、保存済みの内容に戻す"}
          </button>
        </Notice>
      ) : null}

      {version >= 1 && (savedDifference || dirty) ? (
        /*
          セクション名の列挙は読み飛ばされるだけだった（T-M8-66）ので要点だけにする。
          **変更履歴は廃止した**（T-M8-362）ので「履歴から戻せる」とは書けない。
          代わりに、取っておきたい本文は**本棚へ控えを作れる**ことを案内する
          ——「戻せない」とだけ言うと、保存する前に何をすればよいか分からない（原則2）。
        */
        <Notice tone="warn"
          role="status">
          保存すると、プロンプトのアカウント.mdが書き換えられます。いまの内容を残したいときは、
          先に
          <Link className="mx-1 font-medium underline underline-offset-4" href="/app/prompts?sec=account-md">
            プロンプト画面
          </Link>
          で控えを作ってください。
        </Notice>
      ) : null}

      {/*
        **入口の対比を見出しで言う**（T-M8-406・運営者の指示 2026-09-01）。上の枠が
        「参考アカウントからアカウント設定を作る」なので、こちらは「自由入力で〜作る」。
        T-M8-346で「アカウント設定」という見出しは消したが、入口が2つ並ぶ今は
        どちらの入口かが分かる見出しが要る。文言は上の枠と同じく保存の有無で切り替える。
      */}
      <div className={groupClassName}>
        <CardTitle id="free-input-heading">
          {version >= 1 ? "自由入力で設定を更新する" : "自由入力でアカウント設定を作る"}
        </CardTitle>
        <p className="mt-1 text-body leading-6 text-ink-2">
          参考アカウントを使わず、下の項目を自分の言葉で書いて保存します（参考アカウントの反映結果を手直しする場所でもあります）。
        </p>
      </div>

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
            {/* 自由入力（T-M8-395・運営者の指示 2026-09-01）。旧enumの2択は廃止。 */}
            <input
              className={inputClassName}
              id="tone.sentence_style"
              onChange={(event) =>
                updateSettings({
                  ...settings,
                  tone: { ...settings.tone, sentence_style: event.target.value },
                })
              }
              placeholder="例: です・ます調／断定調／言い切りと体言止め中心"
              value={settings.tone.sentence_style}
            />
            {errorFor("tone.sentence_style") ? (
              <p className="mt-1 text-caption text-danger-fg">{errorFor("tone.sentence_style")}</p>
            ) : null}
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

      {/*
        スレッド量や文章量（T-M8-395・運営者の指示 2026-09-01）。アカウント.mdの4章に入る。
        旧「参考にする型」（手書きセクション）は廃止——役割は参考アカウント分析と
        パターン別の参考投稿が継いだ。
      */}
      <section aria-labelledby="volume-group" className={groupClassName} role="group">
        <CardTitle id="volume-group">スレッド量や文章量（任意）</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          アカウント.mdの4章にそのまま入ります。空なら「投稿の型の設定に従う」になります。
        </p>
        <div className="mt-5">
          <label className="sr-only" htmlFor="volume.free_text">
            スレッド量や文章量
          </label>
          <textarea
            className={inputClassName}
            id="volume.free_text"
            maxLength={500}
            onChange={(event) =>
              updateSettings({
                ...settings,
                volume: { free_text: event.target.value },
              })
            }
            placeholder="例: 1ポストは3〜5行で読み切れる密度に。スレッドは長くても4ポストまで。"
            rows={3}
            value={settings.volume.free_text}
          />
          <p className="mt-1 text-caption text-ink-3">
            {settings.volume.free_text.length} / 500字
          </p>
          {errorFor("volume.free_text") ? (
            <p className="mt-1 text-caption text-danger-fg">{errorFor("volume.free_text")}</p>
          ) : null}
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
