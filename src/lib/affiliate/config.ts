/**
 * 招待プログラムの定数と純粋関数（T-M8-174。正本: docs/cp/invite_cp.md）。
 *
 * 報酬率は**累計有料招待ユーザー数**（Paid Referral Count）で決まり、
 * Commission作成時点の率をsnapshotして保存する（後からランクが上がっても過去分は変えない）。
 */

export interface InviteTier {
  minPaidUsers: number;
  rateBps: number;
}

/** ランク表（invite_cp.md §3）。minPaidUsers の昇順を保つこと。 */
export const INVITE_TIERS: readonly InviteTier[] = [
  // 2026-08-22 運営者の指示で全ランク+10pt（20〜40% → 30〜50%）。過去分はsnapshot済みのため不変。
  /*
    2026-08-25 運営者の指示で**区切りを 1〜5 / 6〜10 / 11〜25 / 26〜50 / 51〜 へ変更**。
    以前は 1〜4 / 5〜9 / 10〜24 / 25〜49 / 50〜 で、表の見出し（5人・10人…）と
    実際に上がる人数（5人目・10人目…）が1人ずれていた。
    `minPaidUsers` は**その率になる最初の人数**なので、区切りの下端をそのまま入れる。
    率は作成時にsnapshotされるので、**過去の報酬は書き換わらない**（変更時点で報酬0件）。
  */
  { minPaidUsers: 1, rateBps: 3000 },
  { minPaidUsers: 6, rateBps: 3500 },
  { minPaidUsers: 11, rateBps: 4000 },
  { minPaidUsers: 26, rateBps: 4500 },
  { minPaidUsers: 51, rateBps: 5000 },
];

/** 振込1回あたりの手数料（利用者負担・Commissionからは引かず会計分離）。 */
export const PAYOUT_FEE_JPY = 980;
/** 最低振込額（手数料控除前の受取可能報酬で判定。未満は翌月へ繰越）。 */
export const MIN_PAYOUT_JPY = 5000;
/** 報酬期間: 初回有料課金から最大6ヶ月（解約で前倒し終了・再契約でも再開しない）。 */
export const COMMISSION_MONTHS = 6;
/** 返金等の確認期間。経過後に pending → payable。 */
export const COMMISSION_CONFIRMATION_DAYS = 30;
/** 招待リンクのCookie。Last Click（後から踏んだリンクで上書き）。 */
export const ATTRIBUTION_COOKIE_NAME = "exos_ref";
export const ATTRIBUTION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** 現在の報酬率（bps）。有料招待0人はランク1（30%）を「これから適用される率」として返す。 */
export function rateBpsForPaidCount(paidCount: number): number {
  let rate = INVITE_TIERS[0].rateBps;
  for (const tier of INVITE_TIERS) {
    if (paidCount >= tier.minPaidUsers) rate = tier.rateBps;
  }
  return rate;
}

export interface TierProgress {
  currentRateBps: number;
  /** 次のランク。最上位なら null。 */
  next: InviteTier | null;
  /** 次のランクまであと何人（最上位なら 0）。 */
  remainingToNext: number;
}

export function tierProgress(paidCount: number): TierProgress {
  const currentRateBps = rateBpsForPaidCount(paidCount);
  // 「次のランク」は率が今より上がる段（0人のとき第1段=同率20%を次と言わない）。
  const next = INVITE_TIERS.find((tier) => tier.rateBps > currentRateBps) ?? null;
  return {
    currentRateBps,
    next,
    remainingToNext: next ? next.minPaidUsers - paidCount : 0,
  };
}

/**
 * **次の紹介1人に適用される率**（要決定D-41・運営者の判断 2026-08-25「案B」）。
 *
 * 報酬の率は「その紹介を**含めた**累計有料招待人数」で決まる（`recordCommissionForInvoice`）。
 * つまり有料招待が4人の人の次の紹介は5人目なので、画面に出ている現在の率（30%）ではなく
 * **1段上（35%）**が適用される。ここを現在の率だけで説明すると、
 * 「増えるはずが増えていない」と読まれる。
 */
export function nextReferralRateBps(paidCount: number): number {
  return rateBpsForPaidCount(paidCount + 1);
}

/** 実際に支払われた金額に対する報酬額（切り捨て・integer円）。 */
export function commissionAmount(eligibleAmount: number, rateBps: number): number {
  return Math.floor((eligibleAmount * rateBps) / 10000);
}

/** 「25%」のような表示用。bpsは常に100の倍数だが、そうでなくても小数1桁で丸める。 */
export function formatRateBps(rateBps: number): string {
  const pct = rateBps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

/** メールアドレスのマスク（invite_cp.md §2: y***@gmail.com）。個人情報を画面へ出さない。 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
