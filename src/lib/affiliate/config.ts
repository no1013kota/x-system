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
  /** 次のランクまであと何人（最上位なら 0。到達済みなら 0）。 */
  remainingToNext: number;
  /**
   * **ランクアップが成立する招待人数**（運営者の指示 2026-08-25）。5人・10人・25人・50人。
   *
   * `next.minPaidUsers` は「その率で報酬が出る最初の人数」（6人目・11人目…）なので、
   * 進捗の分母にそのまま使うと「0 / 6人」になり、**5人招待し終えた時点でランクが上がる**
   * という数え方と食い違って見える。分母は帯の終わり（＝完了に必要な人数）を使う。
   * 最上位なら 0。
   */
  nextAtCount: number;
}

/**
 * 報酬率の人数に数える契約状態（T-M8-351・運営者の指示 2026-08-28）。
 *
 * **Trial中の人も1人と数える**——招待した時点で「連れてきた」ことは変わらず、
 * 課金を待つ間だけ率が下がるのは招待する側から見て説明が付かない。
 * **Trial中に解約した人は数えない**（下の `CANCELLED_SUBSCRIPTION_STATUSES`）。
 * `incomplete` は申込の途中なので、まだ数えない（解約でもない）。
 */
export const COUNTED_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "paused"] as const;

/**
 * 「解約済み」として扱う契約状態（T-M8-345/351）。
 * **報酬期間の終了（`commission_terminated_reason`）だけでは足りない**——それは
 * 初回課金後にしか付かないので、Trial中に解約した人が「Trial」のまま残ってしまう。
 */
export const CANCELLED_SUBSCRIPTION_STATUSES = ["canceled", "unpaid", "incomplete_expired"] as const;

/** SQLの `in (...)` に使う（引用符つきのカンマ区切り）。 */
export function sqlStatusList(statuses: readonly string[]): string {
  return statuses.map((value) => `'${value}'`).join(", ");
}

/**
 * **報酬率の人数に数える招待**を選ぶSQL条件（T-M8-351）。
 *
 * 使う側は `affiliate_attributions a` と `profiles pr` を join してから、この条件を
 * `and` でつなぐ。**率を決める場所（`store.ts`）と画面に出す場所（`summary-server.ts`）で
 * 同じ条件を使う**——片方だけ直すと、画面の率と実際に付く率が食い違う（原則1）。
 *
 * 数える条件は3つ:
 * 1. 報酬期間が終わっていない（`commission_terminated_reason is null`）
 * 2. 契約が続いている（Trial中も含む。解約・未払い・期限切れは外す）
 * 3. **全額返金だけの利用者ではない**——報酬が全部取り消された人で率が上がったままになると、
 *    返金で戻ったお金の分だけ率が居座る（T-M8-236の意図を保つ）。
 *    報酬がまだ1件も無い人（Trial中）は、この条件では外れない。
 */
export const COUNTED_REFERRAL_SQL = `
  a.commission_terminated_reason is null
  and pr.subscription_status::text in (${sqlStatusList(COUNTED_SUBSCRIPTION_STATUSES)})
  and (
    not exists (
      select 1 from affiliate_commissions c0
       where c0.affiliate_account_id = a.affiliate_account_id
         and c0.referred_user_id = a.referred_user_id
    )
    or exists (
      select 1 from affiliate_commissions c1
       where c1.affiliate_account_id = a.affiliate_account_id
         and c1.referred_user_id = a.referred_user_id
         and c1.status <> 'reversed'
    )
  )`;

export function tierProgress(paidCount: number): TierProgress {
  const currentRateBps = rateBpsForPaidCount(paidCount);
  /*
    **「次のランク」は、次の紹介に適用される率のさらに上**（運営者の指示 2026-08-25）。
    「5人招待が完了した時点でランクアップ」という数え方なので、5人招待し終えた人の
    目標は35%ではなく**その次の40%（10人）**になる。5人で止まったままだと
    「あと0人で35%」や「5 / 5人」という、もう達成しているのに残っているような表示になる。

    次の紹介に適用される率（＝`nextReferralRateBps`）を基準に、そこから上がる段を探す。
    0人なら次の紹介は1人目で30%なので、次のランクは35%（5人招待し終えた時点）。
  */
  const appliedNextRateBps = nextReferralRateBps(paidCount);
  const next = INVITE_TIERS.find((tier) => tier.rateBps > appliedNextRateBps) ?? null;
  // 帯の終わり＝ランクアップが成立する人数（6人目から35%なら、5人招待し終えた時点）。
  const nextAtCount = next ? next.minPaidUsers - 1 : 0;
  return {
    currentRateBps,
    next,
    nextAtCount,
    remainingToNext: next ? Math.max(0, nextAtCount - paidCount) : 0,
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
