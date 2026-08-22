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
  IMAGE_DEFAULT_ESTIMATE_CREDITS,
  IMAGE_MODEL_OPTIONS,
  TEXT_DEFAULT_ESTIMATE_CREDITS,
  TEXT_MODEL_OPTIONS,
  isCatalogImageModel,
  isCatalogTextModel,
} from "@/lib/ai/model-catalog";
import {
  buildAiPurposeProviderOptions,
  configuredPurpose,
} from "@/lib/ai-purpose-view";
import { concealsUsageLimits, isOperatorManagedPlan, type PlanId } from "@/lib/plans";
import { CardTitle, cardClassName } from "@/components/ui/card";
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
  plan: PlanId | null;
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
  // 選択モデル（T-M8-107）。空=おまかせ（運営の既定モデル）。保存値がカタログ外なら空扱い。
  const cfg = (initialConfig ?? {}) as Record<string, unknown>;
  const [textModel, setTextModel] = useState<string>(() => {
    const saved = typeof cfg.text_model === "string" ? cfg.text_model : "";
    const provider = isOperatorManagedPlan(plan) ? "anthropic" : (configuredPurpose(initialConfig, "text", options.text) as AiKeyProvider | null);
    return provider && saved && isCatalogTextModel(provider, saved) ? saved : "";
  });
  const [imageModel, setImageModel] = useState<string>(() => {
    const saved = typeof cfg.image_model === "string" ? cfg.image_model : "";
    const provider = configuredPurpose(initialConfig, "image", options.image) as ImageAiProvider | null;
    return provider && saved && isCatalogImageModel(provider, saved) ? saved : "";
  });
  const toast = useToast();
  // premiumの文章providerは運営固定（anthropic）。モデル選択の対象provider。
  const effectiveTextProvider: AiKeyProvider | "" = isOperatorManagedPlan(plan) ? "anthropic" : textProvider;

  function save() {
    startTransition(async () => {
      const result = await updateAiPurposeConfig(
        isOperatorManagedPlan(plan)
          ? {
              image: imageProvider || null,
              image_model: (imageProvider && imageModel) || null,
              // premiumの文章はprovider固定だがモデルは選べる（T-M8-107）。
              text: "anthropic",
              text_model: textModel || null,
            }
          : {
              image: imageProvider || null,
              image_model: (imageProvider && imageModel) || null,
              text: textProvider || null,
              text_model: (textProvider && textModel) || null,
            },
      );
      if (result.status === "error") {
        toast.show({ tone: "error", title: "保存できませんでした", description: result.message });
        return;
      }
      toast.show({ tone: "success", title: "AIモデル設定を更新しました" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">

      <section className={`${cardClassName} p-5 sm:p-6`} aria-labelledby="text-purpose-heading">
        <div className="flex items-start gap-3">
          <span className="rounded-card bg-violet-100 p-2.5 text-violet-800">
            <Icon name="smart_toy" size={20} />
          </span>
          <div>
            <CardTitle id="text-purpose-heading">文章生成・リサーチ</CardTitle>
            <p className="mt-1 text-caption leading-6 text-ink-3">
              投稿文の生成とWebリサーチには同じAIを使います。
            </p>
          </div>
        </div>

        {isOperatorManagedPlan(plan) ? (
          <div className="mt-5 rounded-card border border-hairline bg-page p-4">
            {/* 見出し=caption、値=body太字に統一（T-M8-207）。重複する説明文は削除。 */}
            <p className="text-caption text-ink-3">利用するAI</p>
            <p className="mt-1 text-body font-bold">運営Claude（APIキー不要・モデルは下で選べます）</p>
            <ModelSelect
              defaultEstimate={TEXT_DEFAULT_ESTIMATE_CREDITS}
              disabled={isPending}
              label="文章生成に使うモデル"
              onChange={setTextModel}
              options={TEXT_MODEL_OPTIONS.anthropic}
              plan={plan}
              value={textModel}
            />
          </div>
        ) : options.text.length > 0 ? (
          <label className="mt-5 block max-w-xl space-y-2 text-body font-medium">
            文章生成・リサーチに使うAI
            <select
              className="h-11 w-full rounded-lg border bg-background px-3"
              disabled={isPending}
              onChange={(event) => {
                setTextProvider(event.target.value as AiKeyProvider | "");
                setTextModel(""); // providerを変えたら旧providerのモデル選択を持ち越さない
              }}
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
        {!isOperatorManagedPlan(plan) && effectiveTextProvider ? (
          <ModelSelect
            defaultEstimate={TEXT_DEFAULT_ESTIMATE_CREDITS}
            disabled={isPending}
            label="文章生成に使うモデル"
            onChange={setTextModel}
            options={TEXT_MODEL_OPTIONS[effectiveTextProvider]}
            plan={plan}
            value={textModel}
          />
        ) : null}
      </section>

      <section className={`${cardClassName} p-5 sm:p-6`} aria-labelledby="image-purpose-heading">
        <div className="flex items-start gap-3">
          <span className="rounded-card bg-info-bg p-2.5 text-info-fg">
            <Icon name="image" size={20} />
          </span>
          <div>
            <CardTitle id="image-purpose-heading">画像生成</CardTitle>
            <p className="mt-1 text-caption leading-6 text-ink-3">
              OpenAIまたはGoogleのうち、利用できるAIだけを選べます。
            </p>
          </div>
        </div>

        {options.image.length > 0 ? (
          <label className="mt-5 block max-w-xl space-y-2 text-body font-medium">
            画像生成に使うAI
            <select
              className="h-11 w-full rounded-lg border bg-background px-3"
              disabled={isPending}
              onChange={(event) => {
                setImageProvider(event.target.value as ImageAiProvider | "");
                setImageModel("");
              }}
              value={imageProvider}
            >
              <option value="">画像生成を使用しない</option>
              {options.image.map((provider) => (
                <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
              ))}
            </select>
          </label>
        ) : null}
        {options.image.length > 0 && imageProvider ? (
          <ModelSelect
            defaultEstimate={IMAGE_DEFAULT_ESTIMATE_CREDITS}
            disabled={isPending}
            label="画像生成に使うモデル"
            onChange={setImageModel}
            options={IMAGE_MODEL_OPTIONS[imageProvider]}
            plan={plan}
            value={imageModel}
          />
        ) : null}
        {options.image.length === 0 ? (
          <Notice className="mt-5" tone="warn">
            <p className="font-medium">画像生成は現在利用できません</p>
            <p className="mt-1 leading-6">
              {isOperatorManagedPlan(plan)
                ? "運営環境にOpenAIまたはGoogleの画像生成キーが設定されるまで、画像生成はOFFになります。"
                : "OpenAIまたはGoogleのAPIキーを登録し、接続確認に成功すると選べるようになります。"}
            </p>
            {!isOperatorManagedPlan(plan) ? <ApiKeySettingsLink /> : null}
          </Notice>
        ) : null}
      </section>

      {!isOperatorManagedPlan(plan) && !textProvider ? (
        // 文章AIが未割り当てだと生成の前提を満たさない（execution-prereqs）。保存前に警告する。
        <Notice tone="warn" role="status">
          文章生成に使うAIが未設定のため、投稿の生成・自動運用は実行できません。AIを選んで保存してください。
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button className="min-h-11" disabled={isPending} onClick={save} type="button">
          {isPending ? "保存中…" : "AIモデル設定を保存"}
        </Button>
        {/* 選べる条件の注記は各セクションの説明・MissingProviderMessageと重複していたため置かない（T-M8-66）。 */}
      </div>
    </div>
  );
}

/**
 * モデル選択（T-M8-107/110）。空=おまかせ（運営の既定モデル）。
 * 消費目安は「1回あたり」で出す（per MTok表記は分かりにくいため廃止・2026-08-16 運営者の指示）:
 * premium=「約Nクレジット/回」、BYOK=「約N円/回」（自分のAPI課金の目安。1クレジット=1円相当で同値）。
 * 実費消費のため確定値ではなく目安（成功時に実費で精算・T-M8-109）。
 * **利用枠を出さないプラン（expert）には消費目安ごと出さない**（T-M8-168。「無制限」の画面に
 * クレジット単位の消費を見せると内部で計量していることを悟らせる）。
 */
function ModelSelect({
  disabled,
  label,
  onChange,
  options,
  plan,
  defaultEstimate,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: readonly { id: string; label: string; estimateCredits: number }[];
  plan: PlanId | null;
  /** 「おまかせ」の消費目安（運営の既定モデル想定）。 */
  defaultEstimate: number;
  value: string;
}) {
  const unit = isOperatorManagedPlan(plan) ? "クレジット/回" : "円/回";
  const showEstimate = !concealsUsageLimits(plan);
  return (
    <label className="mt-3 block max-w-xl space-y-2 text-body font-medium">
      {label}
      <select
        className="h-11 w-full rounded-lg border bg-background px-3"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">
          {showEstimate
            ? `おまかせ（運営の既定モデル・約${defaultEstimate}${unit}）`
            : "おまかせ（運営の既定モデル）"}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
            {showEstimate ? ` — 約${option.estimateCredits}${unit}` : ""}
          </option>
        ))}
      </select>
    </label>
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
