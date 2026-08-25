/**
 * 招待プログラムのDB引数型。`Queryable`（pg.Pool）と `StripeEventDatabase`
 * （webhookのclaim transaction）の**両方から呼べる**最小共通形にする（T-M8-174）。
 */
export interface AffiliateDb {
  query<T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}
