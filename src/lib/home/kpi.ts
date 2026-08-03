/**
 * ホームのKPI 4カード（T-M8-05・デザイン §画面一覧 1.ホーム）。
 *
 * 「フォロワー数／今週の投稿／未確認の下書き／次回の自動実行」を表示する。
 * ここは**DBを知らない純関数**にして、集計の意味（何を「今週」とみなすか等）を
 * テストで固定できるようにする。取得は `kpi-server.ts`。
 */

/** 1つのKPI。値が無いことと0であることを区別する（`null` = まだ記録が無い）。 */
export interface KpiValue {
  /** 主となる数値。記録が無ければ `null`。 */
  value: number | null;
  /** 単位（「件」など）。数値の直後に小さく添える。 */
  unit?: string;
  /** 前回比などの補足。無ければ表示しない。 */
  delta?: { text: string; tone: "up" | "down" | "flat" };
  /** 数値の下に出す説明。 */
  note?: string;
}

export interface HomeKpis {
  followers: KpiValue;
  postsThisWeek: KpiValue;
  pendingDrafts: KpiValue;
  nextRun: { label: string | null; note: string | null };
}

/**
 * フォロワー数と増減。
 *
 * `points` は日付昇順の日次snapshot。**欠損日は点が無い**ので「7日前」ではなく
 * 「与えられた範囲の最初と最後」で差を取る（点が1つしか無ければ増減は出さない）。
 */
export function followerKpi(points: { date: string; count: number }[]): KpiValue {
  if (points.length === 0) {
    return { value: null, note: "毎日自動で記録されます" };
  }
  const latest = points[points.length - 1].count;
  if (points.length === 1) return { value: latest };
  const diff = latest - points[0].count;
  return {
    value: latest,
    delta: {
      text: `${diff > 0 ? "+" : ""}${diff.toLocaleString()} 今週`,
      tone: diff > 0 ? "up" : diff < 0 ? "down" : "flat",
    },
  };
}

/** JSTでの「今週」の開始（月曜0:00）をUTCのISO文字列で返す。 */
export function startOfWeekJstIso(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 3_600_000);
  // getUTCDay: 0=日。月曜起点にするため日曜を6日前として扱う。
  const back = (jst.getUTCDay() + 6) % 7;
  jst.setUTCDate(jst.getUTCDate() - back);
  jst.setUTCHours(0, 0, 0, 0);
  return new Date(jst.getTime() - 9 * 3_600_000).toISOString();
}

/** 今週の投稿数。自動投稿の内訳を添える。 */
export function postsThisWeekKpi(input: { total: number; auto: number }): KpiValue {
  return {
    value: input.total,
    unit: "件",
    note: input.total === 0 ? "まだ投稿がありません" : `うち自動 ${input.auto}件`,
  };
}

/** 未確認の下書き。 */
export function pendingDraftsKpi(count: number): KpiValue {
  return {
    value: count,
    unit: "件",
    note: count === 0 ? "確認待ちはありません" : "確認をお待ちしています",
  };
}
