"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteApiKey,
  saveAiApiKey,
  saveXApiKey,
  verifyApiKey,
} from "@/app/actions/api-keys";
import { aiSettingsTabHref } from "@/app/app/ai-settings/tabs";
import { UsageSummaryCard } from "@/components/app-shell/usage-summary-card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  AI_SECRET_MIN_LENGTH,
  X_CLIENT_ID_MIN_LENGTH,
  X_CLIENT_SECRET_MIN_LENGTH,
  type AiKeyProvider,
  type XClientType,
} from "@/lib/api-keys";
import {
  maskedApiKeyLabel,
  type ApiKeyViewProvider,
  type ApiKeyViewState,
} from "@/lib/api-key-view";
import type { PlanId } from "@/lib/plans";
import type { UsageSummary } from "@/lib/usage/usage-summary";
import { Card, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { settingsTabHref } from "./tabs";
import { X_SCOPES } from "@/lib/x/scopes";

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
  plan: PlanId;
  /**
   * プレミアムの月間利用枠（デザイン §設定・T-M8-25）。premium以外・未取得は null。
   *
   * キー登録が不要なプランでは、このタブは「不要です」の一文だけで**何も操作できない行き止まり**
   * だった。キーの代わりに何が付いてくるのか（月間の枠と残量）をここで見せる。
   * カードはホーム・課金タブと同じ `UsageSummaryCard` を使う（表示の定義を増やさない）。
   */
  usage?: UsageSummary | null;
  usageResetLabel?: string;
}

function verificationDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
  /**
   * **保存済みの種別から初期化する**（T-M8-59・bug）。常に "public" で初期化すると、
   * Confidentialで保存済みの利用者がClient IDだけ差し替えて保存したとき、
   * **無警告でPublicとして上書き**され、以後のtoken交換（Basic認証必須）が全滅する。
   */
  const [clientType, setClientType] = useState<XClientType>(() =>
    initialKeys.find((key) => key.provider === "x")?.displayHint.client_type === "confidential"
      ? "confidential"
      : "public",
  );
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [aiSecrets, setAiSecrets] = useState<Record<AiKeyProvider, string>>({
    anthropic: "",
    google: "",
    openai: "",
  });
  const [copied, setCopied] = useState(false);
  /**
   * Xキーを保存できるか。**サーバー検証と同じ条件**を名前付きで持つ（T-M8-46）。
   * 以前は `clientId.length < 5` が直書きで、Confidential のときに Secret が要ることは
   * 画面から読めなかった（押せない理由がどこにも無い状態だった）。
   */
  const xSavable =
    clientId.trim().length >= X_CLIENT_ID_MIN_LENGTH &&
    (clientType !== "confidential" ||
      clientSecret.trim().length >= X_CLIENT_SECRET_MIN_LENGTH);
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
      const result = await saveXApiKey({
        client_id: clientId,
        client_secret: clientType === "confidential" ? clientSecret : null,
        client_type: clientType,
      });
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
      // Xアカウントの連携（OAuth）が要る。AIキー保存側の「AI用途を開く」と同じ形。
      toast.show({
        tone: "success",
        title: result.message,
        description: "次に「Xアカウント」タブから、投稿するアカウントを連携してください。",
        action: { href: settingsTabHref("x-accounts"), label: "Xアカウント連携を開く" },
      });
      router.refresh();
    });
  }

  function saveAi(provider: AiKeyProvider) {
    startTransition(async () => {
      const result = await saveAiApiKey({
        api_key: aiSecrets[provider],
        provider,
      });
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
        // **次にやることまで出す。** 保存しただけでは投稿を作れず、AI用途への割り当てが要る
        // （要件06 §3.2）。5秒で消えるトーストに手順を書くと読み切れないので導線を添える。
        toast.show({
          tone: "success",
          title: "APIキーを保存し、疎通を確認しました",
          description: "「AI用途」でこのAIを文章生成に割り当てると投稿を作成できます。",
          action: { href: aiSettingsTabHref("purposes"), label: "AI用途を開く" },
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

  if (plan === "premium") {
    return (
      <Card as="section" className="px-5 py-4" aria-labelledby="premium-key-heading">
        <div className="flex items-start gap-4">
          <div className="rounded-card bg-success-bg p-3 text-success-fg">
            <Icon name="verified_user" className="size-6" />
          </div>
          <div>
            <CardTitle id="premium-key-heading">
              プレミアムプランはキー登録不要です
            </CardTitle>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              X連携と文章生成にはSpace AIの運営キーを使用します。あなた自身のX Developer App資格情報やAI APIキーを入力する必要はありません。API費用の追加負担もありません。
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
    <div className="space-y-7">
      {/*
        **最初に全体像を出す**（T-M8-58）。フォームが先に並ぶと、いくつ登録すれば使えるのかが
        読めない。必要なのは2つ（Xキー1つ＋AIキーどれか1社）だと先に言う。
      */}
      <Notice tone="info">
        このプランで投稿の生成・投稿を行うには、<strong>2つのキー</strong>が必要です:
        ① X APIキー（Xへの投稿に使う）
        ② 生成AIのAPIキー（文章・画像づくりに使う。<strong>3社のうちどれか1社でOK</strong>）。
        取得方法は各カードの案内と、ページ下部の手順ガイドをご覧ください。
      </Notice>

      <section className="rounded-card border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="x-key-heading">
        <div className="flex items-start gap-3">
          <div className="rounded-card bg-brand-subtle p-2 text-brand">
            <Icon name="key" size={20} />
          </div>
          <div>
            <CardTitle id="x-key-heading">X APIキー</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              OAuth 2.0のClient IDを登録します。差し替えると、このキーで連携済みのXアカウントは再認証が必要になります。{" "}
              <a className="text-info-fg underline underline-offset-2" href="#x-guide-heading">
                取得・設定手順を見る
              </a>
            </p>
          </div>
        </div>

        {keys.x ? <div className="mt-5"><SavedKeySummary keyState={keys.x} /></div> : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">
            Client種別
            <select
              className="h-11 w-full rounded-lg border bg-background px-3"
              disabled={isPending}
              onChange={(event) => {
                const value = event.target.value as XClientType;
                setClientType(value);
                if (value === "public") setClientSecret("");
              }}
              value={clientType}
            >
              <option value="public">Public（PKCE）</option>
              <option value="confidential">Confidential</option>
            </select>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              通常は「Public（PKCE）」のままで構いません。X Developer Console側で
              Confidential client として作成した場合のみ切り替えてください。
            </span>
          </label>
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
          {clientType === "confidential" ? (
            <label className="space-y-2 text-sm font-medium sm:col-start-2">
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
            </label>
          ) : null}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button className="min-h-10" disabled={isPending || !xSavable} onClick={saveX} type="button">
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
        {!xSavable ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {clientType === "confidential"
              ? "Client ID と Client Secret を入力すると保存できます。"
              : clientId.trim().length > 0
                ? `Client IDは${X_CLIENT_ID_MIN_LENGTH}文字以上です（いま${clientId.trim().length}文字）。`
                : "Client ID を入力すると保存できます。"}
          </p>
        ) : null}
      </section>

      <section className="rounded-card border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="ai-key-heading">
        <CardTitle id="ai-key-heading">AI APIキー</CardTitle>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          <strong>3社のうちどれか1社を登録すれば使えます</strong>（複数登録して使い分けることもできます）。
          文章生成・リサーチはAnthropic、OpenAI、Googleのどれでも。画像生成に使えるのはOpenAIとGoogleです。
          いずれも従量課金です。予期しない支出を防ぐため、取得時に支払い設定と利用上限（budget）の設定をおすすめします。
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
                    disabled={isPending || aiSecrets[provider].length < AI_SECRET_MIN_LENGTH}
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
                {/* 16文字という条件はどこにも書かれていなかった（T-M8-46）。 */}
                {aiSecrets[provider].length > 0 && aiSecrets[provider].length < AI_SECRET_MIN_LENGTH ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    APIキーは{AI_SECRET_MIN_LENGTH}文字以上です（いま{aiSecrets[provider].length}文字）。
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-card border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="x-guide-heading">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-info-bg text-sm font-bold text-info-fg">?</span>
          <CardTitle id="x-guide-heading">X Developer Appの取得・設定手順</CardTitle>
        </div>
        {/*
          手順は公式ドキュメントで確認した実際のConsoleの構成に合わせる（T-M8-59。以前の手順は
          「必要scopeを5つ許可」を**Console側の設定**として書いていたが、そのような設定は存在しない。
          scopeは連携時にこのアプリが要求し、Xの許可画面で本人が承認する）。
        */}
        <ol className="mt-5 space-y-5 text-sm leading-6">
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">1.</span>
            <div>
              <p className="font-medium">X Developer Consoleにサインインし、Appを作成</p>
              <p className="mt-1 text-muted-foreground">
                Xアカウントでサインインし、開発者契約に同意してAppを作ります。作成するとClient ID等の認証情報が発行されます。
              </p>
              <a className="mt-1 inline-flex min-h-10 items-center gap-1 text-info-fg underline underline-offset-4" href="https://console.x.com/" rel="noreferrer" target="_blank">
                X Developer Consoleを開く<Icon name="open_in_new" size={16} />
              </a>
            </div>
          </li>
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">2.</span>
            <div>
              <p className="font-medium">Appの設定でアプリタイプを選ぶ</p>
              <p className="mt-1 text-muted-foreground">
                「Web App / Automated App or Bot」＝Confidential、「Native App / Single Page App」＝Public（PKCE）です。
                ここで選んだ種類を、上の「Client種別」でも同じに設定してください（迷ったらどちらも
                Public（PKCE）のままで構いません）。
              </p>
            </div>
          </li>
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">3.</span>
            <div>
              <p className="font-medium">同じ設定画面でcallback URLを登録</p>
              <p className="mt-1 text-muted-foreground">
                プロトコル・末尾スラッシュまで<strong>完全一致</strong>で登録します（下のURLをそのまま貼り付け）。
              </p>
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
              <p className="font-medium">Client IDをコピーして、このページの「X APIキー」へ保存</p>
              <p className="mt-1 text-muted-foreground">
                Client IDはAppの「Keys and Tokens」にあります。Confidentialを選んだ場合はClient Secretも保存してください。
              </p>
            </div>
          </li>
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">5.</span>
            <div>
              <p className="font-medium">credits残高・自動チャージ・spending limitを確認</p>
              <p className="mt-1 text-muted-foreground">X APIは従量課金です。予期しない停止や支出を防ぐため、利用開始前に予算を設定してください。</p>
              <a className="mt-1 inline-flex min-h-10 items-center gap-1 text-info-fg underline underline-offset-4" href="https://docs.x.com/x-api/getting-started/pricing" rel="noreferrer" target="_blank">
                X公式の料金・予算設定を確認<Icon name="open_in_new" size={16} />
              </a>
            </div>
          </li>
        </ol>
        <p className="mt-4 rounded-lg border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
          権限（scope）はConsoleでは設定しません。保存後に「Xアカウント」タブから連携すると、
          Xの許可画面で {X_SCOPES.join("・")} の許可を求めます。すべて許可してください。
        </p>
      </section>
    </div>
  );
}
