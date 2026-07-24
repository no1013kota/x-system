import { subscriptionAccessFor } from "@/lib/auth/subscription-access";
import { AppError } from "@/lib/observability/errors";
import type { PlanId } from "@/lib/plans";

/**
 * 生成・投稿・スケジュール・学習の各操作が共用する実行前提の検証（要件06 §3.1/§3.2・要件05 §2.2, PRD §4）。
 * 純粋関数。プラン（BYOK/premium）別に前提を判定し、不足時はコード・不足項目一覧・設定画面パスを返す。
 * 画面遷移は制限しない（実行時検証のみ）。法務同意は `requireExecutionAccess` が別途担う。
 */

export type PrereqCode =
  | "subscription_required"
  | "api_key_required"
  | "x_account_required"
  | "persona_required";

export type PrereqItem =
  | "subscription"
  | "x_api_key"
  | "x_account"
  | "text_ai_key"
  | "image_ai_key"
  | "persona";

/** チェックリスト表示（初期設定ガイド・エラー表示）用の日本語ラベル。 */
export const PREREQ_ITEM_LABELS: Record<PrereqItem, string> = {
  subscription: "ご契約",
  x_api_key: "X APIキー",
  x_account: "X連携",
  text_ai_key: "文章AIキー",
  image_ai_key: "画像AIキー",
  persona: "発信設定",
};

const ITEM_PATH: Record<PrereqItem, string> = {
  subscription: "/app/settings?tab=billing",
  x_api_key: "/app/settings?tab=api-keys",
  x_account: "/app/settings?tab=x-accounts",
  text_ai_key: "/app/settings?tab=api-keys",
  image_ai_key: "/app/settings?tab=api-keys",
  persona: "/app/ai-settings",
};

const ITEM_CODE: Record<PrereqItem, PrereqCode> = {
  subscription: "subscription_required",
  x_api_key: "api_key_required",
  x_account: "x_account_required",
  text_ai_key: "api_key_required",
  image_ai_key: "api_key_required",
  persona: "persona_required",
};

export interface ExecutionPrereqInput {
  plan: PlanId;
  subscriptionStatus: string;
  /** BYOKのX App資格情報status（user_api_keys provider='x'）。未登録は null。 */
  xApiKeyStatus: string | null;
  hasActiveXAccount: boolean;
  /** BYOKの文章providerキーがvalidか。 */
  textAiKeyValid: boolean;
  /** この操作が画像生成を伴うか。 */
  imageRequested: boolean;
  /** BYOKの画像providerキーがvalidか。 */
  imageAiKeyValid: boolean;
  /** 選択中Xアカウントの base_md_version（>=1で発信設定充足）。 */
  baseMdVersion: number;
}

export interface ExecutionPrereqError {
  code: PrereqCode;
  missing: PrereqItem[];
  settingsPath: string;
}

/**
 * 不足している前提を優先順（契約→Xキー→X連携→文章AIキー→画像AIキー→発信設定）で判定する。
 * 充足なら null。primaryは先頭の不足項目、`missing`は全不足項目、`settingsPath`はprimaryの導線。
 */
export function checkExecutionPrerequisites(
  input: ExecutionPrereqInput,
): ExecutionPrereqError | null {
  const premium = input.plan === "premium";
  const missing: PrereqItem[] = [];

  if (!subscriptionAccessFor(input.subscriptionStatus)?.canExecute) {
    missing.push("subscription");
  }
  // BYOKのみ: X App資格情報が登録・形式検証済み（valid/unchecked）であること。
  if (!premium && input.xApiKeyStatus !== "valid" && input.xApiKeyStatus !== "unchecked") {
    missing.push("x_api_key");
  }
  if (!input.hasActiveXAccount) {
    missing.push("x_account");
  }
  if (!premium && !input.textAiKeyValid) {
    missing.push("text_ai_key");
  }
  if (!premium && input.imageRequested && !input.imageAiKeyValid) {
    missing.push("image_ai_key");
  }
  if (input.baseMdVersion < 1) {
    missing.push("persona");
  }

  if (missing.length === 0) return null;
  const primary = missing[0];
  return { code: ITEM_CODE[primary], missing, settingsPath: ITEM_PATH[primary] };
}

/**
 * 投稿実行（publishDraft / post_publish）の前提。契約→Xキー(BYOK)→X連携のみ検証する。
 * 文章/画像AIキー・発信設定は投稿には不要のため含めない（要件06 §7・要件05 §5）。
 */
export function checkPostingPrerequisites(
  input: ExecutionPrereqInput,
): ExecutionPrereqError | null {
  const premium = input.plan === "premium";
  const missing: PrereqItem[] = [];
  if (!subscriptionAccessFor(input.subscriptionStatus)?.canExecute) {
    missing.push("subscription");
  }
  if (!premium && input.xApiKeyStatus !== "valid" && input.xApiKeyStatus !== "unchecked") {
    missing.push("x_api_key");
  }
  if (!input.hasActiveXAccount) {
    missing.push("x_account");
  }
  if (missing.length === 0) return null;
  const primary = missing[0];
  return { code: ITEM_CODE[primary], missing, settingsPath: ITEM_PATH[primary] };
}

/** Actionから呼ぶ。不足があれば code/missing/settingsPath 入りの AppError を投げる。 */
export function assertExecutionPrerequisites(input: ExecutionPrereqInput): void {
  const result = checkExecutionPrerequisites(input);
  if (result) {
    throw new AppError(result.code, {
      details: { missing: result.missing, settingsPath: result.settingsPath },
    });
  }
}

// 初期設定ガイド（SC-05）のチェックリスト対象。契約はバナー、画像AIキーは任意のため含めない。
const SETUP_ITEMS_BYOK: PrereqItem[] = [
  "x_api_key",
  "x_account",
  "text_ai_key",
  "persona",
];
const SETUP_ITEMS_PREMIUM: PrereqItem[] = ["x_account", "persona"];

export interface SetupChecklistItem {
  item: PrereqItem;
  label: string;
  satisfied: boolean;
  settingsPath: string;
}

/**
 * ホーム初期設定ガイド（SC-05, 要件06 §3.1）のチェックリストを組み立てる。充足判定は
 * `checkExecutionPrerequisites` を再利用し二重実装しない。premiumはキー項目（X APIキー・文章AIキー）を除外。
 */
export function buildSetupChecklist(
  input: ExecutionPrereqInput,
): SetupChecklistItem[] {
  const missing = new Set(
    checkExecutionPrerequisites({ ...input, imageRequested: false })?.missing ?? [],
  );
  const items = input.plan === "premium" ? SETUP_ITEMS_PREMIUM : SETUP_ITEMS_BYOK;
  return items.map((item) => ({
    item,
    label: PREREQ_ITEM_LABELS[item],
    satisfied: !missing.has(item),
    settingsPath: ITEM_PATH[item],
  }));
}
