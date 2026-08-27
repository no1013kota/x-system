import { isSubscriptionPeriodStale, subscriptionAccessFor } from "@/lib/auth/subscription-access";
import { AppError } from "@/lib/observability/errors";
import { isOperatorManagedPlan, type PlanId } from "@/lib/plans";

/**
 * 生成・投稿・スケジュール・学習の各操作が共用する実行前提の検証（要件06 §3.1/§3.2・要件05 §2.2, PRD §4）。
 * 純粋関数。プラン（BYOK/運営キー系）別に前提を判定し、不足時はコード・不足項目一覧・設定画面パスを返す。
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
  persona: "アカウント設定",
};

const ITEM_PATH: Record<PrereqItem, string> = {
  subscription: "/app/settings?tab=billing",
  x_api_key: "/app/settings?tab=api-keys",
  x_account: "/app/settings?tab=x-accounts",
  text_ai_key: "/app/settings?tab=api-keys",
  image_ai_key: "/app/settings?tab=api-keys",
  persona: "/app/settings?tab=account",
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
  /**
   * 設定「AIモデル設定」で文章生成のproviderが割り当て済みか。キーがvalidでも未割り当てだと
   * `textAiKeyValid` は false になるため、初期設定ガイドで不足理由を出し分けるのに使う。
   */
  textProviderAssigned?: boolean;
  /** 文章生成に使えるAIキーが1つでもvalidか（未割り当ての誘導先を決めるのに使う）。 */
  hasValidTextCapableKey?: boolean;
  /** この操作が画像生成を伴うか。 */
  imageRequested: boolean;
  /** BYOKの画像providerキーがvalidか。 */
  imageAiKeyValid: boolean;
  /** 選択中Xアカウントの base_md_version（>=1でアカウント設定充足）。 */
  baseMdVersion: number;
  /**
   * 契約期間の期限（T-M8-235）。`trialing`/`active` のまま期限＋猶予を過ぎていたら
   * **契約の反映が届いていない**とみなして実行を止める。渡さなければ従来どおり status だけで判定する。
   */
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
}

/**
 * 契約が実行を許すか（T-M8-235）。status に加えて**期限切れでないこと**まで見る。
 * webhook が届かないあいだ status が `trialing`/`active` のまま残る事故を、日付側で止める。
 */
function subscriptionAllowsExecution(input: ExecutionPrereqInput): boolean {
  if (!subscriptionAccessFor(input.subscriptionStatus)?.canExecute) return false;
  return !isSubscriptionPeriodStale(input.subscriptionStatus, {
    currentPeriodEnd: input.currentPeriodEnd,
    trialEndsAt: input.trialEndsAt,
  });
}

export interface ExecutionPrereqError {
  code: PrereqCode;
  missing: PrereqItem[];
  settingsPath: string;
}

/**
 * 不足している前提を優先順（契約→Xキー→X連携→文章AIキー→画像AIキー→アカウント設定）で判定する。
 * 充足なら null。primaryは先頭の不足項目、`missing`は全不足項目、`settingsPath`はprimaryの導線。
 */
export function checkExecutionPrerequisites(
  input: ExecutionPrereqInput,
): ExecutionPrereqError | null {
  const operatorManaged = isOperatorManagedPlan(input.plan);
  const missing: PrereqItem[] = [];

  if (!subscriptionAllowsExecution(input)) {
    missing.push("subscription");
  }
  // BYOKのみ: X App資格情報が登録・形式検証済み（valid/unchecked）であること。
  if (!operatorManaged && input.xApiKeyStatus !== "valid" && input.xApiKeyStatus !== "unchecked") {
    missing.push("x_api_key");
  }
  if (!input.hasActiveXAccount) {
    missing.push("x_account");
  }
  if (!operatorManaged && !input.textAiKeyValid) {
    missing.push("text_ai_key");
  }
  if (!operatorManaged && input.imageRequested && !input.imageAiKeyValid) {
    missing.push("image_ai_key");
  }
  /*
    **アカウント設定が未保存でも生成はできる**（T-M8-337・運営者の指示 2026-08-27）。

    以前はここで止めていたが、アカウント.mdは「誰として書くか」を鮮明にする**補助**であって、
    無ければ投稿を作れないものではない（パターンのプロンプトと入力だけでも生成できる）。
    登録直後に「まず設定を全部埋めてから」と足止めする方が、使い始めの障害が大きい。
    未保存のときは `<base_md>` を渡さず、AIはパターンと入力だけで書く（`gen-context.ts`）。

    **初期設定ガイドからは消さない**——設定した方が良いことに変わりはないので、
    ホームのチェックリスト（`SETUP_ITEMS_*`）には残して案内し続ける。
  */

  if (missing.length === 0) return null;
  const primary = missing[0];
  return { code: ITEM_CODE[primary], missing, settingsPath: ITEM_PATH[primary] };
}

/**
 * 投稿実行（publishDraft / post_publish）の前提。契約→Xキー(BYOK)→X連携のみ検証する。
 * 文章/画像AIキー・アカウント設定は投稿には不要のため含めない（要件06 §7・要件05 §5）。
 */
export function checkPostingPrerequisites(
  input: ExecutionPrereqInput,
): ExecutionPrereqError | null {
  const operatorManaged = isOperatorManagedPlan(input.plan);
  const missing: PrereqItem[] = [];
  if (!subscriptionAllowsExecution(input)) {
    missing.push("subscription");
  }
  if (!operatorManaged && input.xApiKeyStatus !== "valid" && input.xApiKeyStatus !== "unchecked") {
    missing.push("x_api_key");
  }
  if (!input.hasActiveXAccount) {
    missing.push("x_account");
  }
  if (missing.length === 0) return null;
  const primary = missing[0];
  return { code: ITEM_CODE[primary], missing, settingsPath: ITEM_PATH[primary] };
}

/**
 * 前提の不足を判定する（**プロフィールが読めなかった場合も含めて**・R27）。
 *
 * `gatherPrereqInputs` は対象が見つからないと `null` を返す。以前はその場合の代替値
 * `{ code: "not_found", missing: [], settingsPath: "/app" }` を**呼び出し側4箇所が
 * それぞれ書いていた**（生成job・投稿job・学習ソース・本文生成worker）。
 * 「読めなかった」の扱いを変えるときに1つ忘れると、経路によって別のエラーが出る。
 *
 * `input` が `null` なら不足そのものを判定できないので `not_found` を返す。
 */
export function resolveExecutionPrereqError(
  input: ExecutionPrereqInput | null,
  check: (input: ExecutionPrereqInput) => ExecutionPrereqError | null = checkExecutionPrerequisites,
): ResolvedPrereqError | null {
  if (!input) return { code: "not_found", missing: [], settingsPath: "/app" };
  return check(input);
}

/**
 * 「前提の不足」に「そもそも読めなかった（`not_found`）」を足した形。
 * `not_found` は前提項目の不足ではないので `PrereqCode` には含めない。
 */
export interface ResolvedPrereqError {
  code: PrereqCode | "not_found";
  missing: PrereqItem[];
  settingsPath: string;
}

/** 判定結果を Action/job が投げる形（code・missing・settingsPath 入り）へ詰め替える。 */
export function prereqErrorToAppError(error: ResolvedPrereqError): AppError {
  return new AppError(error.code, {
    details: { missing: error.missing, settingsPath: error.settingsPath },
  });
}

/** Actionから呼ぶ。不足があれば code/missing/settingsPath 入りの AppError を投げる。 */
export function assertExecutionPrerequisites(input: ExecutionPrereqInput): void {
  const result = checkExecutionPrerequisites(input);
  if (result) throw prereqErrorToAppError(result);
}

/**
 * `gatherPrereqInputs` の結果（`null` を含む）を受け、不足があれば投げる。
 * 判定関数を差し替えられるので、実行前提（生成）と投稿前提の両方に使える。
 */
export function assertPrereqsFromInput(
  input: ExecutionPrereqInput | null,
  check?: (input: ExecutionPrereqInput) => ExecutionPrereqError | null,
): void {
  const error = resolveExecutionPrereqError(input, check);
  if (error) throw prereqErrorToAppError(error);
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
  /** 何をする手順かの1行説明（順序依存や所要時間の目安を含む）。 */
  description: string;
}

/** 各手順の1行説明。何をするのか・前後関係が分かるようにする（要件06 §3.1）。 */
const ITEM_DESCRIPTION: Record<PrereqItem, string> = {
  subscription: "プランのお申し込み状況を確認します。",
  x_api_key: "X Developer ConsoleでClient IDを取得して登録します。",
  x_account: "投稿するXアカウントを認可します（X APIキーの登録後に行えます）。",
  text_ai_key: "文章生成に使うAIのAPIキーを登録し、疎通確認まで行います。",
  image_ai_key: "画像生成に使うAIのAPIキーを登録します。",
  persona: "誰に何を発信するかを保存すると、AIの土台が作られます。",
};

/** 文章AIキーは valid でも「AIモデル設定」で割り当てないと充足しないため、不足理由で表示を出し分ける。 */
const TEXT_PROVIDER_UNASSIGNED = {
  label: "文章AIの割り当て",
  path: "/app/settings?tab=purposes",
  description:
    "登録済みのAI APIキーのうち、どれで文章生成・リサーチを行うかを選びます。",
} as const;

/**
 * ホーム初期設定ガイド（SC-05, 要件06 §3.1）のチェックリストを組み立てる。充足判定は
 * `checkExecutionPrerequisites` を再利用し二重実装しない。運営キー系（premium/expert）はキー項目（X APIキー・文章AIキー）を除外。
 */
export function buildSetupChecklist(
  input: ExecutionPrereqInput,
): SetupChecklistItem[] {
  const missing = new Set(
    checkExecutionPrerequisites({ ...input, imageRequested: false })?.missing ?? [],
  );
  const items = isOperatorManagedPlan(input.plan) ? SETUP_ITEMS_PREMIUM : SETUP_ITEMS_BYOK;
  return items.map((item) => {
    const satisfied = !missing.has(item);
    // キーはvalidなのに未充足＝AI用途で文章providerが未割り当て。APIキー画面へ戻しても
    // 「確認済み」と表示されるだけで進めないため、割り当て画面へ誘導する。
    if (
      item === "text_ai_key" &&
      !satisfied &&
      input.textProviderAssigned === false &&
      input.hasValidTextCapableKey === true
    ) {
      return {
        item,
        label: TEXT_PROVIDER_UNASSIGNED.label,
        satisfied,
        settingsPath: TEXT_PROVIDER_UNASSIGNED.path,
        description: TEXT_PROVIDER_UNASSIGNED.description,
      };
    }
    return {
      item,
      label: PREREQ_ITEM_LABELS[item],
      satisfied,
      settingsPath: ITEM_PATH[item],
      description: ITEM_DESCRIPTION[item],
    };
  });
}
