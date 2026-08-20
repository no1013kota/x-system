/**
 * providerの失敗を**運営者が直せる型**へ落とす（T-M8-163）。
 *
 * 2026-08-20、本番の `doctor` は「取得に失敗したテーマ: ai（http_400）」としか出さず、
 * 次の一手は「Claudeに失敗記録を見せてと伝えてください」だった。実際の原因は
 * `news_fetch_outcomes.provider_raw_error` に入っていた
 * **「Your credit balance is too low to access the Anthropic API」＝クレジット切れ**で、
 * 運営者が5分で直せるものだった。**`http_400` からは何も分からず自力で辿れない**
 * （CLAUDE.md 原則2「原因が開発知識なしで辿れる／ログを読ませない」に反する）。
 *
 * **この関数の戻り値に応答本文を含めない。** 入力の生文字列は判定にだけ使い、外へ出すのは
 * ここで定義した固定の型と定型文だけにする（要件01 §8。doctorはHTTPでも返るため）。
 */

export type ProviderFailureKind =
  | "credit_exhausted"
  | "rate_limited"
  | "invalid_key"
  | "model_not_found"
  | "context_too_long"
  | "provider_outage"
  | "unknown";

/**
 * 判定の並びは**上から順に試す**。クレジット切れとレート制限はどちらも429/400で来ることがあり、
 * 文言でしか区別できない。曖昧なものを先に置くと取り違える。
 */
const PATTERNS: { kind: ProviderFailureKind; match: RegExp }[] = [
  // Anthropic: "Your credit balance is too low to access the Anthropic API."
  // OpenAI: "You exceeded your current quota, please check your plan and billing details."
  {
    kind: "credit_exhausted",
    match: /credit balance is too low|exceeded your current quota|insufficient_quota|billing_hard_limit/i,
  },
  { kind: "rate_limited", match: /rate.?limit|too many requests|429/i },
  {
    kind: "invalid_key",
    match: /invalid.{0,20}api.?key|incorrect api key|authentication_error|unauthorized|permission_denied|401|403/i,
  },
  { kind: "model_not_found", match: /model.{0,30}(not found|does not exist|not_found)|invalid model/i },
  {
    kind: "context_too_long",
    match: /context.{0,20}(length|window)|maximum.{0,20}tokens|too many tokens|prompt is too long/i,
  },
  { kind: "provider_outage", match: /overloaded|service unavailable|internal server error|502|503|504/i },
];

/** 運営者向けの説明と、そのとき取る操作。**開発知識を要する言い方をしない。** */
export const PROVIDER_FAILURE_GUIDE: Record<
  ProviderFailureKind,
  { label: string; nextAction: string }
> = {
  credit_exhausted: {
    label: "AIの利用残高が不足しています",
    nextAction:
      "AI提供元の管理画面（Anthropic は Plans & Billing、OpenAI は Billing）でクレジットを購入してください。自動チャージを有効にすると再発を防げます",
  },
  rate_limited: {
    label: "AIの呼び出し制限に当たっています",
    nextAction:
      "しばらく待つと自動で回復します。頻発する場合はAI提供元の管理画面で利用上限（Rate limits）の引き上げを申請してください",
  },
  invalid_key: {
    label: "AIのAPIキーが無効か、権限がありません",
    nextAction:
      "AI提供元でキーを再発行し、Vercel の環境変数（ANTHROPIC_API_KEY 等）へ入れて再デプロイしてください",
  },
  model_not_found: {
    label: "指定しているAIモデル名が使えません",
    nextAction:
      "モデルが廃止・改名された可能性があります。Claudeに「使えるモデル名を確認して直して」と伝えてください",
  },
  context_too_long: {
    label: "AIへ渡す内容が長すぎます",
    nextAction:
      "アカウント.mdやプロンプトが長すぎる可能性があります。Claudeに「渡している内容が長すぎるので短くして」と伝えてください",
  },
  provider_outage: {
    label: "AI提供元が一時的に応答できていません",
    nextAction:
      "提供元の障害の可能性が高く、時間をおくと回復します。続く場合は提供元のステータスページを確認してください",
  },
  unknown: {
    label: "AIの呼び出しが失敗しました（原因は記録にあります）",
    nextAction:
      "Claudeに「ニュース取得の失敗記録を見せて」と伝えてください（AIが何を返して落ちたかが記録されています）",
  },
};

/**
 * 記録された失敗から型を求める。
 *
 * @param errorCode `providerFailureCode` が付けた短いコード（`http_400` 等）。**単体では原因が分からない**。
 * @param rawError providerの応答本文。**判定にだけ使い、戻り値へは含めない**。
 */
export function classifyProviderFailure(
  errorCode: string | null | undefined,
  rawError: string | null | undefined,
): ProviderFailureKind {
  const haystack = `${errorCode ?? ""} ${rawError ?? ""}`;
  if (!haystack.trim()) return "unknown";
  for (const { kind, match } of PATTERNS) {
    if (match.test(haystack)) return kind;
  }
  return "unknown";
}

/** 型から運営者向けの説明を引く。 */
export function providerFailureGuide(kind: ProviderFailureKind) {
  return PROVIDER_FAILURE_GUIDE[kind];
}
