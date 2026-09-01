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
  DEFAULT_IMAGE_MODELS,
  IMAGE_MODEL_OPTIONS,
  TEXT_DEFAULT_ESTIMATE_CREDITS,
  TEXT_MODEL_OPTIONS,
  imageEstimateCredits,
  isCatalogImageModel,
  isCatalogTextModel,
} from "@/lib/ai/model-catalog";
import {
  buildAiPurposeProviderOptions,
  configuredPurpose,
  defaultImageProvider,
} from "@/lib/ai-purpose-view";
import { concealsUsageLimits, isOperatorManagedPlan, type PlanId } from "@/lib/plans";
import { CardTitle, cardClassName } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/notice";
import { yen } from "@/lib/format";

/**
 * AIモデル設定（旧・設定＞AIモデル設定。T-M8-401・運営者の指示 2026-09-01でプロンプト画面へ移設）。
 *
 * - 見出しは「文章生成」（旧「文章生成・リサーチ」）。利用者が指定できるのは文章生成のAIと
 *   モデルだけなので、そのとおりに呼ぶ（Webリサーチは同じAIで裏側が行う）。
 * - **画像生成にも既定を出す**。何も保存していなくても OpenAI／GPT Image 1.5（バランス）が
 *   選ばれた形で表示し、「おまかせ」には既定モデル名と目安を明示する。既定の正本は
 *   `DEFAULT_IMAGE_MODELS`（コード）で、画面はそれを写すだけ（数字を2か所に置かない）。
 */

const PROVIDER_LABELS: Record<AiKeyProvider, string> = {
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
  openai: "OpenAI",
};

/** 画像の既定モデル（provider別）の表示名と目安。カタログに無ければ null。 */
function imageDefaultModel(provider: ImageAiProvider): { label: string; estimateCredits: number } | null {
  const id = DEFAULT_IMAGE_MODELS[provider];
  const option = IMAGE_MODEL_OPTIONS[provider].find((m) => m.id === id);
  return option ? { label: option.label, estimateCredits: imageEstimateCredits(provider, id) } : null;
}

interface AiModelSettingsProps {
  initialConfig: unknown;
  operatorImageProviders: ImageAiProvider[];
  plan: PlanId | null;
  validUserProviders: AiKeyProvider[];
}

export function AiModelSettings({
  initialConfig,
  operatorImageProviders,
  plan,
  validUserProviders,
}: AiModelSettingsProps) {
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
  /*
    **画像は既定を選んだ形で出す**（T-M8-401）。保存済みの選択があればそれ、無ければ
    `defaultImageProvider`（OpenAI優先＝premiumの実行時フォールバックと同じ順）。
    BYOKは保存するまで実際には効かないので、その間は下の Notice で「まだ保存されていません」と言う。
  */
  const savedImageProvider = configuredPurpose(initialConfig, "image", options.image) as
    | ImageAiProvider
    | null;
  const imageDefault = defaultImageProvider(options.image);
  const [imageProvider, setImageProvider] = useState<ImageAiProvider | "">(
    () => savedImageProvider ?? imageDefault ?? "",
  );
  // 選択モデル（T-M8-107）。空=おまかせ（既定モデル）。保存値がカタログ外なら空扱い。
  const cfg = (initialConfig ?? {}) as Record<string, unknown>;
  const [textModel, setTextModel] = useState<string>(() => {
    const saved = typeof cfg.text_model === "string" ? cfg.text_model : "";
    const provider = isOperatorManagedPlan(plan) ? "anthropic" : (configuredPurpose(initialConfig, "text", options.text) as AiKeyProvider | null);
    return provider && saved && isCatalogTextModel(provider, saved) ? saved : "";
  });
  const [imageModel, setImageModel] = useState<string>(() => {
    const saved = typeof cfg.image_model === "string" ? cfg.image_model : "";
    return savedImageProvider && saved && isCatalogImageModel(savedImageProvider, saved) ? saved : "";
  });
  const toast = useToast();
  // premiumの文章providerは運営固定（anthropic）。モデル選択の対象provider。
  const effectiveTextProvider: AiKeyProvider | "" = isOperatorManagedPlan(plan) ? "anthropic" : textProvider;
  const imageDefaultInfo = imageProvider ? imageDefaultModel(imageProvider) : null;
  /** 画像のAIが未保存のまま既定を出しているか（BYOKは保存するまで効かない）。 */
  const imageUnsavedDefault = !isOperatorManagedPlan(plan) && !savedImageProvider && imageProvider !== "";

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
            <CardTitle id="text-purpose-heading">文章生成</CardTitle>
            <p className="mt-1 text-caption leading-6 text-ink-3">
              投稿文を書くAIとモデルです。
            </p>
          </div>
        </div>

        {isOperatorManagedPlan(plan) ? (
          <>
            {/* 灰色枠には入れず、画像生成セクションと同じ並び（ラベル＋欄）にする（運営者の指示 2026-08-22）。 */}
            <div className="mt-5 block max-w-xl space-y-2 text-body font-medium">
              <p>利用するAI</p>
              <p className="flex h-11 w-full items-center rounded-lg border bg-page px-3 font-normal text-ink">
                運営Claude（APIキー不要）
              </p>
            </div>
            <ModelSelect
              defaultEstimate={TEXT_DEFAULT_ESTIMATE_CREDITS}
              disabled={isPending}
              label="文章生成に使うモデル"
              onChange={setTextModel}
              options={TEXT_MODEL_OPTIONS.anthropic}
              plan={plan}
              value={textModel}
            />
          </>
        ) : options.text.length > 0 ? (
          <label className="mt-5 block max-w-xl space-y-2 text-body font-medium">
            文章生成に使うAI
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
          <MissingProviderMessage purpose="文章生成" />
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
              {imageDefault && imageDefaultModel(imageDefault)
                ? `何も変えなければ ${PROVIDER_LABELS[imageDefault]} / ${imageDefaultModel(imageDefault)?.label} を使います。`
                : null}
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
              {/*
                premium は「使用しない」を出さない（T-M8-401）——実行時は運営キーのOpenAIへ
                フォールバックするので、選んでも効かない選択肢になる。画像を付けるかは
                投稿作成の「画像生成」で毎回決める。BYOKは未設定＝画像生成できない、なので残す。
              */}
              {isOperatorManagedPlan(plan) ? null : <option value="">画像生成を使用しない</option>}
              {options.image.map((provider) => (
                <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
              ))}
            </select>
          </label>
        ) : null}
        {options.image.length > 0 && imageProvider ? (
          <ModelSelect
            defaultEstimate={imageDefaultInfo?.estimateCredits ?? imageEstimateCredits(imageProvider, null)}
            defaultLabel={imageDefaultInfo?.label}
            disabled={isPending}
            label="画像生成に使うモデル"
            onChange={setImageModel}
            options={IMAGE_MODEL_OPTIONS[imageProvider]}
            plan={plan}
            value={imageModel}
          />
        ) : null}
        {imageUnsavedDefault ? (
          <Notice className="mt-4" role="status" tone="info">
            画像生成のAIはまだ保存されていません。このまま「AIモデル設定を保存」を押すと、
            {PROVIDER_LABELS[imageProvider as ImageAiProvider]}
            {imageDefaultInfo ? `（${imageDefaultInfo.label}）` : ""}で画像を作れるようになります。
          </Notice>
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
 * モデル選択（T-M8-107/110）。空=おまかせ（既定モデル）。
 * 消費目安は「1回あたり」で出す（per MTok表記は分かりにくいため廃止・2026-08-16 運営者の指示）:
 * premium=「約Nクレジット/回」、BYOK=「約N円/回」（自分のAPI課金の目安。1クレジット=1円相当で同値）。
 * 実費消費のため確定値ではなく目安（成功時に実費で精算・T-M8-109）。
 * **利用枠を出さないプラン（expert）には消費目安ごと出さない**（T-M8-168。「無制限」の画面に
 * クレジット単位の消費を見せると内部で計量していることを悟らせる）。
 * `defaultLabel` を渡すと「おまかせ」に既定モデル名を添える（画像・T-M8-401。文章の既定は
 * 環境変数で決まりコードに名前が無いので「運営の既定モデル」のまま）。
 */
function ModelSelect({
  disabled,
  label,
  onChange,
  options,
  plan,
  defaultEstimate,
  defaultLabel,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: readonly { id: string; label: string; estimateCredits: number }[];
  plan: PlanId | null;
  /** 「おまかせ」の消費目安（既定モデル想定）。 */
  defaultEstimate: number;
  /** 「おまかせ」で使われる既定モデルの表示名（分かるときだけ）。 */
  defaultLabel?: string;
  value: string;
}) {
  const unit = isOperatorManagedPlan(plan) ? "クレジット/回" : "円/回";
  const showEstimate = !concealsUsageLimits(plan);
  const defaultName = defaultLabel ?? "運営の既定モデル";
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
            ? `おまかせ（${defaultName}・約${yen(defaultEstimate)}${unit}）`
            : `おまかせ（${defaultName}）`}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
            {showEstimate ? ` — 約${yen(option.estimateCredits)}${unit}` : ""}
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
