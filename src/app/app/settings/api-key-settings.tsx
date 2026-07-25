"use client";

import { Check, Clipboard, ExternalLink, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteApiKey,
  saveAiApiKey,
  saveXApiKey,
  verifyApiKey,
} from "@/app/actions/api-keys";
import { Button } from "@/components/ui/button";
import type { AiKeyProvider, XClientType } from "@/lib/api-keys";
import {
  maskedApiKeyLabel,
  type ApiKeyViewProvider,
  type ApiKeyViewState,
} from "@/lib/api-key-view";
import type { PlanId } from "@/lib/plans";

const AI_PROVIDERS: Array<{ label: string; provider: AiKeyProvider }> = [
  { label: "Anthropic (Claude)", provider: "anthropic" },
  { label: "OpenAI", provider: "openai" },
  { label: "Google (Gemini)", provider: "google" },
];

const STATUS_LABELS = {
  invalid: "要確認",
  unchecked: "未確認",
  valid: "確認済み",
} as const;

interface ActionNotice {
  message: string;
  tone: "error" | "success";
}

interface ApiKeySettingsProps {
  callbackUrl: string;
  initialKeys: ApiKeyViewState[];
  plan: PlanId;
}

function verificationDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: ApiKeyViewState["status"] }) {
  const tone =
    status === "valid"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "invalid"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function SavedKeySummary({ keyState }: { keyState: ApiKeyViewState }) {
  const verified = verificationDate(keyState.verifiedAt);
  return (
    <div className="rounded-xl border bg-muted/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-sm">{maskedApiKeyLabel(keyState)}</p>
        <StatusBadge status={keyState.status} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        秘密値は再表示されません。
        {verified
          ? `最終確認: ${verified}`
          : keyState.status === "invalid"
            ? "疎通確認に失敗しました。"
            : "疎通確認は未実施です。"}
      </p>
      {keyState.provider !== "x" && keyState.status !== "valid" ? (
        // 生成の前提は valid のみ（execution-prereqs）。未確認/失敗のままだと投稿生成が始まらない。
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-950">
          {keyState.status === "invalid"
            ? "このキーは認証できませんでした。正しいキーを貼り直すまで投稿生成には使えません。"
            : "疎通確認が済むまで、このキーは投稿生成に使えません。「疎通確認」を実行してください。"}
        </p>
      ) : null}
    </div>
  );
}

export function ApiKeySettings({
  callbackUrl,
  initialKeys,
  plan,
}: ApiKeySettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [keys, setKeys] = useState<Record<string, ApiKeyViewState>>(() =>
    Object.fromEntries(initialKeys.map((key) => [key.provider, key])),
  );
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [clientType, setClientType] = useState<XClientType>("public");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [aiSecrets, setAiSecrets] = useState<Record<AiKeyProvider, string>>({
    anthropic: "",
    google: "",
    openai: "",
  });
  const [copied, setCopied] = useState(false);
  function finishAction(message: string) {
    setNotice({ message, tone: "success" });
    router.refresh();
  }

  function saveX() {
    setNotice(null);
    startTransition(async () => {
      const result = await saveXApiKey({
        client_id: clientId,
        client_secret: clientType === "confidential" ? clientSecret : null,
        client_type: clientType,
      });
      if (result.status === "error" || !result.displayHint) {
        setNotice({ message: result.message, tone: "error" });
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
      finishAction(result.message);
    });
  }

  function saveAi(provider: AiKeyProvider) {
    setNotice(null);
    startTransition(async () => {
      const result = await saveAiApiKey({
        api_key: aiSecrets[provider],
        provider,
      });
      if (result.status === "error" || !result.displayHint) {
        setNotice({ message: result.message, tone: "error" });
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
      setNotice({ message: "保存しました。疎通を確認しています…", tone: "success" });
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
        finishAction("APIキーを保存し、疎通を確認しました。AI設定の「AI用途」で、このAIを文章生成に割り当てると投稿を作成できます。");
      } else {
        setNotice({ message: verified.message, tone: "error" });
        router.refresh();
      }
    });
  }

  function verify(provider: ApiKeyViewProvider) {
    setNotice(null);
    startTransition(async () => {
      const result = await verifyApiKey({ provider });
      if (result.status === "error" && result.keyStatus !== "invalid") {
        setNotice({ message: result.message, tone: "error" });
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
      setNotice({
        message: result.message,
        tone: result.status === "error" ? "error" : "success",
      });
      router.refresh();
    });
  }

  function remove(provider: ApiKeyViewProvider) {
    if (!window.confirm("このAPIキーを削除します。元に戻せません。続行しますか？")) {
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const result = await deleteApiKey({ provider });
      if (result.status === "error") {
        setNotice({ message: result.message, tone: "error" });
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

  async function copyCallbackUrl() {
    await navigator.clipboard.writeText(callbackUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (plan === "premium") {
    return (
      <section className="rounded-2xl border bg-card p-6 shadow-sm" aria-labelledby="premium-key-heading">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-emerald-100 p-3 text-emerald-800">
            <ShieldCheck aria-hidden="true" className="size-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold" id="premium-key-heading">
              Premiumはキー登録不要です
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              X連携と文章生成にはSpace AIの運営キーを使用します。あなた自身のX Developer App資格情報やAI APIキーを入力する必要はありません。
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-7">
      {notice ? (
        <p
          className={`rounded-xl border p-4 text-sm ${
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="x-key-heading">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-foreground p-2 text-background">
            <KeyRound aria-hidden="true" className="size-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold" id="x-key-heading">X APIキー</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              OAuth 2.0のClient IDを登録します。差し替えると既存のBYOK X連携は再認証が必要です。
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
          <Button className="min-h-10" disabled={isPending || clientId.length < 5} onClick={saveX} type="button">
            {keys.x ? "Xキーを差し替え" : "Xキーを保存"}
          </Button>
          {keys.x ? (
            <>
              <Button className="min-h-10" disabled={isPending} onClick={() => verify("x")} type="button" variant="outline">
                形式を確認
              </Button>
              <Button className="min-h-10" disabled={isPending} onClick={() => remove("x")} type="button" variant="outline">
                <Trash2 aria-hidden="true" className="size-4" />削除
              </Button>
            </>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="ai-key-heading">
        <h2 className="text-xl font-semibold" id="ai-key-heading">AI APIキー</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          文章生成・リサーチはAnthropic、OpenAI、Googleから選べます。画像生成に使えるのはOpenAIとGoogleです。
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {AI_PROVIDERS.map(({ label, provider }) => {
            const keyState = keys[provider];
            return (
              <article className="rounded-xl border p-4" key={provider}>
                <h3 className="font-semibold">{label}</h3>
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
                    placeholder="秘密値を入力"
                    type="password"
                    value={aiSecrets[provider]}
                  />
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    className="min-h-10"
                    disabled={isPending || aiSecrets[provider].length < 16}
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
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="x-guide-heading">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">?</span>
          <h2 className="text-xl font-semibold" id="x-guide-heading">X Developer Appの取得・設定手順</h2>
        </div>
        <ol className="mt-5 space-y-5 text-sm leading-6">
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">1.</span>
            <div>
              <p className="font-medium">Developer ConsoleでAppを作成</p>
              <a className="mt-1 inline-flex min-h-10 items-center gap-1 text-sky-700 underline underline-offset-4" href="https://console.x.com/" rel="noreferrer" target="_blank">
                X Developer Consoleを開く<ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </div>
          </li>
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">2.</span>
            <div>
              <p className="font-medium">OAuth 2.0 callback URLを完全一致で登録</p>
              <div className="mt-2 flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                <code className="break-all text-xs sm:text-sm">{callbackUrl}</code>
                <Button aria-label="callback URLをコピー" className="min-h-10" onClick={copyCallbackUrl} size="sm" type="button" variant="outline">
                  {copied ? <Check aria-hidden="true" className="size-4" /> : <Clipboard aria-hidden="true" className="size-4" />}
                  {copied ? "コピー済み" : "コピー"}
                </Button>
              </div>
            </div>
          </li>
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">3.</span>
            <div>
              <p className="font-medium">必要scopeを5つ許可</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"].map((scope) => (
                  <code className="rounded-md bg-muted px-2 py-1 text-xs" key={scope}>{scope}</code>
                ))}
              </div>
            </div>
          </li>
          <li className="grid gap-1 sm:grid-cols-[2rem_1fr]">
            <span className="font-bold">4.</span>
            <div>
              <p className="font-medium">credits残高・自動チャージ・spending limitを確認</p>
              <p className="mt-1 text-muted-foreground">X APIは従量課金です。予期しない停止や支出を防ぐため、利用開始前に予算を設定してください。</p>
              <a className="mt-1 inline-flex min-h-10 items-center gap-1 text-sky-700 underline underline-offset-4" href="https://docs.x.com/x-api/getting-started/pricing" rel="noreferrer" target="_blank">
                X公式の料金・予算設定を確認<ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </div>
          </li>
        </ol>
        <div className="mt-6 flex min-h-40 items-center justify-center rounded-xl border-2 border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Developer Console設定画面のスクリーンショット（差し替え準備中）
        </div>
      </section>
    </div>
  );
}
