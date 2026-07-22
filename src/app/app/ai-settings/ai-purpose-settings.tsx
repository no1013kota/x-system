"use client";

import { Bot, ImageIcon, KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateAiPurposeConfig } from "@/app/actions/ai-purpose-config";
import { Button } from "@/components/ui/button";
import type { AiKeyProvider } from "@/lib/api-keys";
import type { ImageAiProvider } from "@/lib/ai-purpose-config";
import {
  buildAiPurposeProviderOptions,
  configuredPurpose,
} from "@/lib/ai-purpose-view";
import type { PlanId } from "@/lib/plans";

const PROVIDER_LABELS: Record<AiKeyProvider, string> = {
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
  openai: "OpenAI",
};

interface AiPurposeSettingsProps {
  initialConfig: unknown;
  operatorImageProviders: ImageAiProvider[];
  plan: PlanId;
  validUserProviders: AiKeyProvider[];
}

interface Notice {
  message: string;
  tone: "error" | "success";
}

export function AiPurposeSettings({
  initialConfig,
  operatorImageProviders,
  plan,
  validUserProviders,
}: AiPurposeSettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const options = buildAiPurposeProviderOptions({
    operatorImageProviders,
    plan,
    validUserProviders,
  });
  const [textProvider, setTextProvider] = useState<AiKeyProvider | "">(() =>
    (configuredPurpose(initialConfig, "text", options.text) as AiKeyProvider | null) ?? "",
  );
  const [imageProvider, setImageProvider] = useState<ImageAiProvider | "">(() =>
    (configuredPurpose(initialConfig, "image", options.image) as ImageAiProvider | null) ?? "",
  );
  const [notice, setNotice] = useState<Notice | null>(null);

  function save() {
    setNotice(null);
    startTransition(async () => {
      const result = await updateAiPurposeConfig(
        plan === "premium"
          ? { image: imageProvider || null }
          : {
              image: imageProvider || null,
              text: textProvider || null,
            },
      );
      if (result.status === "error") {
        setNotice({ message: result.message, tone: "error" });
        return;
      }
      setNotice({ message: result.message, tone: "success" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
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

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="text-purpose-heading">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-violet-100 p-2.5 text-violet-800">
            <Bot aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold" id="text-purpose-heading">文章生成・リサーチ</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              投稿文の生成とWebリサーチには同じproviderを使用します。
            </p>
          </div>
        </div>

        {plan === "premium" ? (
          <div className="mt-5 rounded-xl border bg-muted/35 p-4">
            <p className="text-xs font-medium text-muted-foreground">利用するAI</p>
            <p className="mt-1 font-semibold">運営Claude（変更不可）</p>
            <p className="mt-2 text-xs text-muted-foreground">
              PremiumではSpace AIの運営環境で文章生成とリサーチを実行します。
            </p>
          </div>
        ) : options.text.length > 0 ? (
          <label className="mt-5 block max-w-xl space-y-2 text-sm font-medium">
            文章provider
            <select
              className="h-11 w-full rounded-lg border bg-background px-3"
              disabled={isPending}
              onChange={(event) => setTextProvider(event.target.value as AiKeyProvider | "")}
              value={textProvider}
            >
              <option value="">未設定</option>
              {options.text.map((provider) => (
                <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
              ))}
            </select>
          </label>
        ) : (
          <MissingProviderMessage purpose="文章生成・リサーチ" />
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="image-purpose-heading">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-sky-100 p-2.5 text-sky-800">
            <ImageIcon aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold" id="image-purpose-heading">画像生成</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              OpenAIまたはGoogleのうち、利用可能なproviderだけを選択できます。
            </p>
          </div>
        </div>

        {options.image.length > 0 ? (
          <label className="mt-5 block max-w-xl space-y-2 text-sm font-medium">
            画像provider
            <select
              className="h-11 w-full rounded-lg border bg-background px-3"
              disabled={isPending}
              onChange={(event) => setImageProvider(event.target.value as ImageAiProvider | "")}
              value={imageProvider}
            >
              <option value="">画像生成を使用しない</option>
              {options.image.map((provider) => (
                <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-medium">画像生成は現在利用できません</p>
            <p className="mt-1 leading-6">
              {plan === "premium"
                ? "運営環境にOpenAIまたはGoogleの画像生成キーが設定されるまで、画像生成はOFFになります。"
                : "validなOpenAIまたはGoogleのAPIキーを登録すると選択できるようになります。"}
            </p>
            {plan !== "premium" ? <ApiKeySettingsLink /> : null}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button className="min-h-11" disabled={isPending} onClick={save} type="button">
          {isPending ? "保存中…" : "AI用途設定を保存"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {plan === "premium"
            ? "画像providerには運営環境で利用可能なものだけを表示します。"
            : "ここで選べるのは疎通確認済みのproviderだけです。"}
        </p>
      </div>
    </div>
  );
}

function ApiKeySettingsLink() {
  return (
    <Link className="mt-3 inline-flex min-h-10 items-center gap-2 font-medium text-sky-800 underline underline-offset-4" href="/app/settings?tab=api-keys">
      <KeyRound aria-hidden="true" className="size-4" />APIキー設定へ
    </Link>
  );
}

function MissingProviderMessage({ purpose }: { purpose: string }) {
  return (
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-medium">{purpose}に使えるproviderがありません</p>
      <p className="mt-1 leading-6">AI APIキーを登録し、疎通確認を完了してください。</p>
      <ApiKeySettingsLink />
    </div>
  );
}
