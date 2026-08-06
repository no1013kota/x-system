"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateAiPurposeConfig } from "@/app/actions/ai-purpose-config";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { AiKeyProvider } from "@/lib/api-keys";
import type { ImageAiProvider } from "@/lib/ai-purpose-config";
import {
  buildAiPurposeProviderOptions,
  configuredPurpose,
} from "@/lib/ai-purpose-view";
import type { PlanId } from "@/lib/plans";
import { CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";

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
  const toast = useToast();

  function save() {
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
        toast.show({ tone: "error", title: "保存できませんでした", description: result.message });
        return;
      }
      toast.show({ tone: "success", title: "AI用途設定を更新しました" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">

      <section className="rounded-card border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="text-purpose-heading">
        <div className="flex items-start gap-3">
          <span className="rounded-card bg-violet-100 p-2.5 text-violet-800">
            <Icon name="smart_toy" size={20} />
          </span>
          <div>
            <CardTitle id="text-purpose-heading">文章生成・リサーチ</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              投稿文の生成とWebリサーチには同じAIを使います。
            </p>
          </div>
        </div>

        {plan === "premium" ? (
          <div className="mt-5 rounded-card border bg-muted/35 p-4">
            <p className="text-xs font-medium text-muted-foreground">利用するAI</p>
            <p className="mt-1 font-semibold">運営Claude（変更不可）</p>
            <p className="mt-2 text-xs text-muted-foreground">
              プレミアムプランではSpace AIの運営環境で文章生成とリサーチを実行します。
            </p>
          </div>
        ) : options.text.length > 0 ? (
          <label className="mt-5 block max-w-xl space-y-2 text-sm font-medium">
            文章生成・リサーチに使うAI
            <select
              className="h-11 w-full rounded-lg border bg-background px-3"
              disabled={isPending}
              onChange={(event) => setTextProvider(event.target.value as AiKeyProvider | "")}
              value={textProvider}
            >
              {/* 動かない理由の説明は下のNoticeが担う。選択肢内で繰り返さない（T-M8-66）。 */}
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

      <section className="rounded-card border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="image-purpose-heading">
        <div className="flex items-start gap-3">
          <span className="rounded-card bg-info-bg p-2.5 text-info-fg">
            <Icon name="image" size={20} />
          </span>
          <div>
            <CardTitle id="image-purpose-heading">画像生成</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              OpenAIまたはGoogleのうち、利用できるAIだけを選べます。
            </p>
          </div>
        </div>

        {options.image.length > 0 ? (
          <label className="mt-5 block max-w-xl space-y-2 text-sm font-medium">
            画像生成に使うAI
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
          <Notice className="mt-5" tone="warn">
            <p className="font-medium">画像生成は現在利用できません</p>
            <p className="mt-1 leading-6">
              {plan === "premium"
                ? "運営環境にOpenAIまたはGoogleの画像生成キーが設定されるまで、画像生成はOFFになります。"
                : "OpenAIまたはGoogleのAPIキーを登録し、接続確認に成功すると選べるようになります。"}
            </p>
            {plan !== "premium" ? <ApiKeySettingsLink /> : null}
          </Notice>
        )}
      </section>

      {plan !== "premium" && !textProvider ? (
        // 文章AIが未割り当てだと生成の前提を満たさない（execution-prereqs）。保存前に警告する。
        <Notice tone="warn" role="status">
          文章生成に使うAIが未設定のため、投稿の生成・自動運用は実行できません。AIを選んで保存してください。
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button className="min-h-11" disabled={isPending} onClick={save} type="button">
          {isPending ? "保存中…" : "AI用途設定を保存"}
        </Button>
        {/* 選べる条件の注記は各セクションの説明・MissingProviderMessageと重複していたため置かない（T-M8-66）。 */}
      </div>
    </div>
  );
}

function ApiKeySettingsLink() {
  return (
    <Link className="mt-3 inline-flex min-h-10 items-center gap-2 font-medium text-info-fg underline underline-offset-4" href="/app/settings?tab=api-keys">
      <Icon name="key" size={16} />APIキー設定へ
    </Link>
  );
}

function MissingProviderMessage({ purpose }: { purpose: string }) {
  return (
    <Notice className="mt-5" tone="warn">
      <p className="font-medium">{purpose}に使えるAIがまだありません</p>
      <p className="mt-1 leading-6">AI APIキーを登録し、疎通確認を完了してください。</p>
      <ApiKeySettingsLink />
    </Notice>
  );
}
