/**
 * SQL expression for the current usage/billing month (YYYY-MM) in JST. Single
 * source for the month boundary shared by usage counters, publishing, and
 * reconciliation — changing it in one place keeps every monthly aggregation
 * aligned.
 */
export const CURRENT_MONTH_JST_SQL =
  "to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM')";
