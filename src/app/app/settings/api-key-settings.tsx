"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteApiKey,
  saveAiApiKey,
  saveXApiKey,
  verifyApiKey,
} from "@/app/actions/api-keys";
import { UsageSummaryCard } from "@/components/app-shell/usage-summary-card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  aiApiKeySaveBlocker,
  aiApiKeySavePayload,
  xApiKeySaveBlocker,
  xApiKeySavePayload,
  type AiKeyProvider,
} from "@/lib/api-keys";
import {
  maskedApiKeyLabel,
  type ApiKeyViewProvider,
  type ApiKeyViewState,
} from "@/lib/api-key-view";
import { formatJst } from "@/lib/format";
import { isOperatorManagedPlan, type PlanId } from "@/lib/plans";
import type { UsageSummary } from "@/lib/usage/usage-summary";
import { Card, CardTitle, cardClassName } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { settingsTabHref } from "./tabs";

/**
 * 取得ページへのリンクを各社に持たせる（T-M8-58）。X側には手順ガイドがあるのにAI側には
 * 取得方法が無く、非エンジニアはどこでキーを作ればよいか分からなかった。
 */
/**
 * 各社の**できること**をカードに明示する（T-M8-59）。「Claudeしかできないのでは」という
 * 誤解が実際に出た——プレミアムでは文章が運営Claude固定なので、そう見える。BYOKでは
 * 3社とも文章生成＋Webリサーチに対応している（`openai.ts`／`gemini.ts` に webSearch 実装、
 * 実APIの契約テストも3社分）。画像だけは OpenAI / Google のみ。
 */
const AI_PROVIDERS: Array<{
  label: string;
  provider: AiKeyProvider;
  consoleUrl: string;
  capabilities: string;
}> = [
  {
    label: "Anthropic (Claude)",
    provider: "anthropic",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    capabilities: "文章生成・リサーチ",
  },
  {
    label: "OpenAI",
    provider: "openai",
    consoleUrl: "https://platform.openai.com/api-keys",
    capabilities: "文章生成・リサーチ・画像生成",
  },
  {
    label: "Google (Gemini)",
    provider: "google",
    consoleUrl: "https://aistudio.google.com/apikey",
    capabilities: "文章生成・リサーチ・画像生成",
  },
];

const STATUS_LABELS = {
  invalid: "要確認",
  unchecked: "未確認",
  valid: "確認済み",
} as const;

interface ApiKeySettingsProps {
  callbackUrl: string;
  initialKeys: ApiKeyViewState[];
  plan: PlanId | null;
  /**
   * プレミアムの利用枠（契約期間ごと・デザイン §設定・T-M8-25）。premium以外・未取得は null。
   *
   * キー登録が不要なプランでは、このタブは「不要です」の一文だけで**何も操作できない行き止まり**
   * だった。キーの代わりに何が付いてくるのか（契約期間ごとの枠と残量）をここで見せる。
   * カードはホーム・課金タブと同じ `UsageSummaryCard` を使う（表示の定義を増やさない）。
   */
  usage?: UsageSummary | null;
  usageResetLabel?: string;
}

/**
 * 最終確認の日時（T-M8-254）。**表示は日本時間で固定する**（`formatJst`）。
 *
 * 以前はここだけ `timeZone` を指定しておらず、実行環境のTZで描かれていた——
 * サーバー（Vercel＝UTC）で焼いたHTMLとブラウザ（JST）で9時間ずれ、
 * hydration不一致で描き直しが起きていた。**アプリの他の日時は全てJST固定**なので、
 * 端末のTZに左右される表示がここだけ混ざるのも揃わない。
 * `formatJst` は非nullのISO文字列前提なので、null は呼ぶ前に外す（`?? ""` にしない——
 * 空文字は `RangeError` になり、画面が落ちる）。
 */
function verificationDate(value: string | null): string | null {
  if (!value) return null;
  return formatJst(value);
}

function StatusBadge({ status }: { status: ApiKeyViewState["status"] }) {
  const tone: BadgeTone =
    status === "valid" ? "success" : status === "invalid" ? "danger" : "warn";
  return <Badge tone={tone}>{STATUS_LABELS[status]}</Badge>;
}

function SavedKeySummary({ keyState }: { keyState: ApiKeyViewState }) {
  const verified = verificationDate(keyState.verifiedAt);
  return (
    <div className="rounded-card border bg-muted/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-sm">{maskedApiKeyLabel(keyState)}</p>
        <StatusBadge status={keyState.status} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        保存したキーは再表示されません。
        {verified
          ? `最終確認: ${verified}`
          : keyState.status === "invalid"
            ? "疎通確認に失敗しました。"
            : "疎通確認は未実施です。"}
      </p>
      {keyState.provider !== "x" && keyState.status !== "valid" ? (
        // 生成の前提は valid のみ（execution-prereqs）。未確認/失敗のままだと投稿生成が始まらない。
        <Notice className="mt-2" tone="warn">
          {keyState.status === "invalid"
            ? "このキーは認証できませんでした。正しいキーを貼り直すまで投稿生成には使えません。"
            : "疎通確認が済むまで、このキーは投稿生成に使えません。「疎通確認」を実行してください。"}
        </Notice>
      ) : null}
    </div>
  );
}

export function ApiKeySettings({
  callbackUrl,
  initialKeys,
  plan,
  usage = null,
  usageResetLabel = "",
}: ApiKeySettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [keys, setKeys] = useState<Record<string, ApiKeyViewState>>(() =>
    Object.fromEntries(initialKeys.map((key) => [key.provider, key])),
  );
  const toast = useToast();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [aiSecrets, setAiSecrets] = useState<Record<AiKeyProvider, string>>({
    anthropic: "",
    google: "",
    openai: "",
  });
  const [copied, setCopied] = useState(false);
  /**
   * 保存できるか／押せない理由は**サーバー検証と同じスキーマ**を通して決める（T-M8-84）。
   *
   * 以前はここで条件を写経しており（長さの下限だけ）、**文字種と上限を見ていなかった**。
   * そのため `bad id` や上限超えでも押せて、押してからサーバーに弾かれた。
   * 写経をやめたので、条件が増えても画面側の追従漏れが起きない。文言の正本もスキーマ側。
   */
  const xSaveBlocker = xApiKeySaveBlocker({ clientId, clientSecret });
  /** 失敗を伝える。文面はServer Actionが返すものをそのまま出す（原因が具体的なため）。 */
  function showError(message: string) {
    toast.show({ tone: "error", title: "実行できませんでした", description: message });
  }

  function finishAction(title: string) {
    toast.show({ tone: "success", title });
    router.refresh();
  }

  function saveX() {
    startTransition(async () => {
      /**
       * 種別は**Client Secretの有無から導出する**（T-M8-63）。現在のDeveloper Consoleに
       * Public/Confidentialを選ぶUIは無いが、Type of Appで「Web App, Automated App or Bot」
       * を選ぶとconfidential clientになり、**token交換にClient Secretが必須**
       * （実測: Secretなしの交換は 401 unauthorized_client で拒否された・2026-08-06）。
       * 「Client種別」という利用者が答えられない質問を復活させず、入力の有無で決める。
       */
      // 押せる条件と送る値を同じ関数から出す（ずれると「押せたのに弾かれる」が復活する）。
      const result = await saveXApiKey(xApiKeySavePayload({ clientId, clientSecret }));
      if (result.status === "error" || !result.displayHint) {
        showError(result.message);
        return;
      }
      const displayHint = result.displayHint;
      setKeys((current) => ({
        ...current,
        x: {
          displayHint,
          provider: "x",
          status: "unchecked",
          verifiedAt: null,
        },
      }));
      setClientId("");
      setClientSecret("");
      // **次にやること（X連携）まで出す**（T-M8-59）。保存だけでは投稿できず、
      // Xアカウントの連携（OAuth）が要る。AIキー保存側の「AIモデル設定を開く」と同じ形。
      toast.show({
        tone: "success",
        title: result.message,
        description: "次に「Xアカウント」タブから、投稿するアカウントを連携してください。",
        action: { href: settingsTabHref("general"), label: "Xアカウント連携を開く" },
      });
      router.refresh();
    });
  }

  function saveAi(provider: AiKeyProvider) {
    startTransition(async () => {
      const result = await saveAiApiKey(aiApiKeySavePayload({ apiKey: aiSecrets[provider], provider }));
      if (result.status === "error" || !result.displayHint) {
        showError(result.message);
        return;
      }
      const displayHint = result.displayHint;
      setKeys((current) => ({
        ...current,
        [provider]: {
          displayHint,
          provider,
          status: "unchecked",
          verifiedAt: null,
        },
      }));
      setAiSecrets((current) => ({ ...current, [provider]: "" }));
      // 未確認のキーは投稿生成に使えないため、保存に続けて疎通確認まで自動で行う
      // （利用者が「保存しただけで使える」と誤解して詰まるのを防ぐ・要件06 §3.2）。
      toast.show({ tone: "success", title: "保存しました", description: "疎通を確認しています…" });
      const verified = await verifyApiKey({ provider });
      setKeys((current) => {
        const existing = current[provider];
        if (!existing || !verified.keyStatus) return current;
        return {
          ...current,
          [provider]: {
            ...existing,
            status: verified.keyStatus,
            verifiedAt: verified.keyStatus === "valid" ? new Date().toISOString() : null,
          },
        };
      });
      if (verified.keyStatus === "valid") {
        // **次にやることまで出す。** 保存しただけでは投稿を作れず、AIモデル設定での割り当てが要る
        // （要件06 §3.2）。5秒で消えるトーストに手順を書くと読み切れないので導線を添える。
        toast.show({
          tone: "success",
          title: "APIキーを保存し、疎通を確認しました",
          description: "プロンプト＞「AIモデル設定」でこのAIを文章生成に割り当てると投稿を作成できます。",
          action: { href: "/app/prompts?sec=ai-models", label: "AIモデル設定を開く" },
        });
        router.refresh();
      } else {
        showError(verified.message);
        router.refresh();
      }
    });
  }

  function verify(provider: ApiKeyViewProvider) {
    startTransition(async () => {
      const result = await verifyApiKey({ provider });
      if (result.status === "error" && result.keyStatus !== "invalid") {
        showError(result.message);
        return;
      }
      setKeys((current) => {
        const existing = current[provider];
        if (!existing || !result.keyStatus) return current;
        return {
          ...current,
          [provider]: {
            ...existing,
            status: result.keyStatus,
            verifiedAt:
              result.keyStatus === "valid" ? new Date().toISOString() : null,
          },
        };
      });
      if (result.status === "error") showError(result.message);
      else toast.show({ tone: "success", title: result.message });
      router.refresh();
    });
  }

  function remove(provider: ApiKeyViewProvider) {
    if (!window.confirm(
        provider === "x"
          ? "X APIキーを削除します。連携中のXアカウントはX側の許可も取り消され、再連携するまで予約・自動投稿が止まります。続行しますか？"
          : "このAPIキーを削除します。このAIを文章・画像づくりに割り当てている場合は割り当てが解除され、別のAIを設定するまで生成が止まります。続行しますか？",
      )) {
      return;
    }
    startTransition(async () => {
      const result = await deleteApiKey({ provider });
      if (result.status === "error") {
        showError(result.message);
        return;
      }
      setKeys((current) => {
        const next = { ...current };
        delete next[provider];
        return next;
      });
      finishAction(result.message);
    });
  }

  /**
   * callback URL のコピー（T-M8-38）。
   *
   * **失敗を黙って捨てない。** クリップボード書き込みは非セキュアコンテキスト
   * （`navigator.clipboard` が undefined）・権限拒否・ドキュメント非フォーカスのいずれでも失敗する。
   * 以前は try/catch が無く、失敗すると unhandled rejection になって `setCopied(true)` に到達せず、
   * ボタンは「コピー」のまま**何も起きなかった**。
   *
   * この文字列は X Developer Console へ**完全一致で登録**する値なので、コピーできたつもりで
   * 古いクリップボード内容を貼るとX側の設定が食い違い、ログイン・連携が失敗する。
   * 相手側の設定ミスはコードに現れず、モックしたテストでは原理的に見えない
   * （2026-08-01、stagingでログイン・新規登録が両方不可だったのと同型）。
   */
  async function copyCallbackUrl() {
    try {
      await navigator.clipboard.writeText(callbackUrl);
    } catch {
      toast.show({
        tone: "error",
        title: "コピーできませんでした",
        description: "左のURLを選択して手動でコピーしてください。",
      });
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (isOperatorManagedPlan(plan)) {
    return (
      <Card as="section" className="px-5 py-4" aria-labelledby="premium-key-heading">
        <div className="flex items-start gap-4">
          <div className="rounded-card bg-success-bg p-3 text-success-fg">
            <Icon name="verified_user" className="size-6" />
          </div>
          <div>
            <CardTitle id="premium-key-heading">
              ご契約中のプランはキー登録不要です
            </CardTitle>
            {/* 「登録不要」の言い直しは見出しと重複するため書かない（T-M8-66）。 */}
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              APIキーはExos AIの運営キーを使います。
            </p>
          </div>
        </div>
        {usage ? (
          <div className="mt-5">
            <UsageSummaryCard nextResetLabel={usageResetLabel} summary={usage} />
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/*
        **最初に全体像を出す**（T-M8-58）。フォームが先に並ぶと、いくつ登録すれば使えるのかが
        読めない。必要なのは2つ（Xキー1つ＋AIキーどれか1社）だと先に言う。
      */}
      <Notice tone="info">
        投稿を作って投稿するには、① X APIキー（Xへの投稿に使う）と
        ② 生成AIのAPIキー（文章・画像づくりに使う）の2つが必要です。
      </Notice>

      <section className={`${cardClassName} p-5 sm:p-6`} aria-labelledby="x-key-heading">
        <div className="flex items-start gap-3">
          <div className="rounded-card bg-brand-subtle p-2 text-brand">
            <Icon name="key" size={20} />
          </div>
          <div>
            <CardTitle id="x-key-heading">X APIキー</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              OAuth 2.0のClient IDとClient Secretを登録します。{" "}
              <a className="text-info-fg underline underline-offset-2" href="#x-guide-heading">
                取得・設定手順を見る
              </a>
            </p>
          </div>
        </div>

        {keys.x ? <div className="mt-5"><SavedKeySummary keyState={keys.x} /></div> : null}

        {/*
          「Client種別」セレクタは置かない（T-M8-62。現在のConsoleにPublic/Confidentialの
          選択は無い）。種別はSecretの有無から導出する（saveX のコメント参照・T-M8-63）。
        */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">
            Client ID
            <input
              autoComplete="off"
              className="h-11 w-full rounded-lg border bg-background px-3 font-mono text-sm"
              disabled={isPending}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="Client IDを入力"
              type="password"
              value={clientId}
            />
          </label>
          <label className="space-y-2 text-sm font-medium">
            Client Secret
            <input
              autoComplete="new-password"
              className="h-11 w-full rounded-lg border bg-background px-3 font-mono text-sm"
              disabled={isPending}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder="Client Secretを入力"
              type="password"
              value={clientSecret}
            />
            {/*
              **画面に注記は出さない**（運営者の判断 2026-08-24）。保存は Client ID だけで通るが、
              手順ガイドが指示する「Web App, Automated App or Bot」は confidential client なので、
              Secret 無しの token 交換は401（unauthorized_client）で拒否される。
              つまり**空のまま保存でき、失敗するのは連携を試みたとき**になる（T-M8-63 が注記で
              塞いでいた経路。BACKLOG T-M8-284 に記録）。
            */}
          </label>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button className="min-h-10" disabled={isPending || xSaveBlocker !== null} onClick={saveX} type="button">
            {keys.x ? "Xキーを差し替え" : "Xキーを保存"}
          </Button>
          {keys.x ? (
            <>
              {/*
                「形式を確認」は出さない（T-M8-59）。Xキーは実装上ここでは何も確認できず
                （検証はOAuth連携が行う）、押すと確認済み表示を「未確認」へ戻すだけだった。
              */}
              <Button className="min-h-10" disabled={isPending} onClick={() => remove("x")} type="button" variant="outline">
                <Icon name="delete" size={16} />削除
              </Button>
            </>
          ) : null}
        </div>
        {/*
          **押せない理由を書く**（T-M8-46）。以前は薄いボタンだけが出ていて、何を入れれば
          押せるようになるのかが画面のどこにも無かった（T-M8-37 と同型）。
        */}
        {xSaveBlocker ? (
          <p className="mt-2 text-xs text-muted-foreground">{xSaveBlocker}</p>
        ) : null}
      </section>

      <section className={`${cardClassName} p-5 sm:p-6`} aria-labelledby="ai-key-heading">
        <CardTitle id="ai-key-heading">AI APIキー</CardTitle>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          文章生成・リサーチはAnthropic、OpenAI、Googleのいずれかの登録が必要です。画像生成はOpenAIとGoogleのいずれかの登録が必要です。
        </p>
        <div className="mt-5 grid gap-4">
          {AI_PROVIDERS.map(({ label, provider, consoleUrl, capabilities }) => {
            const keyState = keys[provider];
            return (
              <article className="rounded-card border p-4" key={provider}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{label}</h3>
                  <Badge>{capabilities}</Badge>
                </div>
                <a
                  className="mt-0.5 inline-flex items-center gap-1 text-xs text-info-fg underline underline-offset-2"
                  href={consoleUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  APIキーの取得ページを開く
                  <Icon name="open_in_new" size={13} />
                </a>
                {keyState ? <div className="mt-3"><SavedKeySummary keyState={keyState} /></div> : (
                  <p className="mt-3 text-sm text-muted-foreground">未登録</p>
                )}
                <label className="mt-4 block space-y-2 text-sm font-medium">
                  {keyState ? "新しいキーに差し替え" : "APIキー"}
                  <input
                    aria-label={`${label} APIキー`}
                    autoComplete="new-password"
                    className="h-11 w-full rounded-lg border bg-background px-3 font-mono text-sm"
                    disabled={isPending}
                    onChange={(event) =>
                      setAiSecrets((current) => ({
                        ...current,
                        [provider]: event.target.value,
                      }))
                    }
                    placeholder="APIキーを入力"
                    type="password"
                    value={aiSecrets[provider]}
                  />
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    className="min-h-10"
                    disabled={isPending || aiApiKeySaveBlocker({ apiKey: aiSecrets[provider], provider }) !== null}
                    onClick={() => saveAi(provider)}
                    size="sm"
                    type="button"
                  >
                    {keyState ? "差し替え" : "保存"}
                  </Button>
                  {keyState ? (
                    <>
                      <Button className="min-h-10" disabled={isPending} onClick={() => verify(provider)} size="sm" type="button" variant="outline">
                        疎通確認
                      </Button>
                      <Button aria-label={`${label} APIキーを削除`} className="min-h-10 min-w-10" disabled={isPending} onClick={() => remove(provider)} size="sm" type="button" variant="outline">
                        <Icon name="delete" size={16} />
                      </Button>
                    </>
                  ) : null}
                </div>
                {/*
                  押せない理由もサーバー検証と同じスキーマから出す（T-M8-84）。
                  以前は長さしか見ておらず、空白入りの値（`^\S+$` 違反）や上限超えでも押せた。
                */}
                {aiSecrets[provider].length > 0 &&
                aiApiKeySaveBlocker({ apiKey: aiSecrets[provider], provider }) ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {aiApiKeySaveBlocker({ apiKey: aiSecrets[provider], provider })}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className={`${cardClassName} p-5 sm:p-6`} aria-labelledby="x-guide-heading">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-info-bg text-sm font-bold text-info-fg">?</span>
          <CardTitle id="x-guide-heading">X Developer Appの取得・設定手順</CardTitle>
        </div>
        {/*
          手順は**利用者が実機のConsoleを操作して確認した構成**に合わせる（T-M8-62・2026-08-06）:
          ①開発者アカウント → ②AppタブでApp作成（Environment: Production）→ ③OAuth 2.0の
          セットアップ（Read and Write / Web App, Automated App or Bot）→ ④Client ID＋Secret →
          ⑤Credit。scopeはConsole側の設定ではない（連携時にこのアプリが要求し、Xの許可画面で
          本人が承認する。T-M8-59）。Consumer Key・Bearer Token は使わないことを明記する——
          「どれをコピーすればいいのか」が非エンジニアの最初の詰まりどころのため。
          **Client Secret は必要**（T-M8-63。「Web App, Automated App or Bot」=confidential client
          で、Secretなしのtoken交換は401で拒否されることを実測で確認した）。
        */}
        <ol className="mt-5 space-y-6 text-sm leading-6">
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">1.</span>
            <div>
              <p className="font-medium">開発者アカウントを作る（無料・5分ほど）</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>下のリンクから X Developer Console を開き、ふだんお使いの<strong>Xアカウントでサインイン</strong>します。</li>
                <li>初回は開発者向けの利用規約（英語）への同意を求められます。内容を確認して同意してください。</li>
                <li>利用目的などを聞かれた場合は、「I want to automate posts on my X account to save time and maintain a consistent schedule, and improve audience engagement.」などと入力すれば大丈夫です。</li>
              </ul>
              <a className="mt-1 inline-flex min-h-10 items-center gap-1 text-info-fg underline underline-offset-4" href="https://console.x.com/" rel="noreferrer" target="_blank">
                X Developer Consoleを開く<Icon name="open_in_new" size={16} />
              </a>
            </div>
          </li>
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">2.</span>
            <div>
              <p className="font-medium">「App」タブへ移動して、Appを作る</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                <li><strong>Environment（環境）</strong>: 「<strong>Production</strong>」を選びます（実際に投稿するための本番用という意味です）。</li>
                <li><strong>App名</strong>: 好きな名前でかまいません（例: <code className="rounded bg-muted px-1">MyPostTool</code>。他の開発者と重複しない名前にします）。</li>
                <li>
                  作成すると <strong>Consumer Key（API KeyとSecret）</strong>や<strong> Bearer Token </strong>が表示されますが、
                  <strong>このアプリでは使いません</strong>。控えなくて大丈夫です（使うのは手順3の後に発行される Client ID と Client Secret です）。
                </li>
              </ul>
            </div>
          </li>
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">3.</span>
            <div>
              <p className="font-medium">OAuth 2.0をセットアップする</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>作ったAppの設定画面で、OAuth 2.0 Keys → User authentication settings → Set upを開きます。</li>
                <li><strong>App permissions（権限）</strong>: 「<strong>Read and Write</strong>」を選びます（投稿するには書き込み権限が必要です）。</li>
                <li><strong>Type of App（アプリの種類）</strong>: 「<strong>Web App, Automated App or Bot</strong>」を選びます。</li>
                <li>
                  <strong>Callback URI / Redirect URL</strong>: 下のURLを<strong>そのまま</strong>貼り付けます。
                  1文字でも違うと連携できません（httpsとhttp、末尾の / の有無まで完全一致）。
                </li>
                <li><strong>Website URL</strong>: ご自身のXプロフィールのURL（例: <code className="rounded bg-muted px-1">https://x.com/あなたのユーザー名</code>）を入力すれば大丈夫です。</li>
              </ul>
              <div className="mt-2 flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                {/* コピーできない環境でも手順を終えられるように、手で選びやすくする。 */}
                <code className="break-all text-xs select-all sm:text-sm">{callbackUrl}</code>
                {/*
                  `aria-label` を**置かない**（T-M8-38）。付けると読み上げ名が固定され、
                  「コピー」→「コピー済み」の変化が支援技術に伝わらない（アイコンは aria-hidden）。
                  文脈は可視テキストへ入れる。
                */}
                <Button className="min-h-10" onClick={copyCallbackUrl} size="sm" type="button" variant="outline">
                  {copied ? <Icon name="check" size={16} /> : <Icon name="content_copy" size={16} />}
                  {copied ? "コピー済み" : "callback URLをコピー"}
                </Button>
              </div>
            </div>
          </li>
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">4.</span>
            <div>
              <p className="font-medium">Client IDとClient Secretをコピーして、このページに保存する</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>セットアップを終えると <strong>Client ID</strong> と <strong>Client Secret</strong> が表示されます。<strong>Client Secretはこの1回しか表示されない</strong>ので、この場で両方コピーします。</li>
                <li>このページ上部の「X APIキー」の入力欄に<strong>両方とも</strong>貼って、「Xキーを保存」を押します。</li>
                <li>Client Secretを控え損ねた場合は、「Keys and Tokens」ページで<strong>再発行（Regenerate）</strong>できます。</li>
              </ul>
            </div>
          </li>
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">5.</span>
            <div>
              <p className="font-medium">Credit（前払いクレジット）の支払いを設定する</p>
              <p className="mt-1 text-muted-foreground">
                X APIは<strong>前払い（クレジット）方式の従量課金</strong>です。Billing → Credits → Purchase Creditsから購入できます。
                クレジット（米ドル）を購入しておくと、投稿のたびにそこから差し引かれます。
              </p>
              <a className="mt-2 inline-flex min-h-10 items-center gap-1 text-info-fg underline underline-offset-4" href="https://docs.x.com/x-api/getting-started/pricing" rel="noreferrer" target="_blank">
                X公式の料金・予算設定を確認<Icon name="open_in_new" size={16} />
              </a>
            </div>
          </li>
        </ol>
      </section>
    </div>
  );
}
