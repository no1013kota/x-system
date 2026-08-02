/**
 * 共有テーブルを使うテストのための「他と交わらない時間窓」（T-M7-54）。
 *
 * ## 何を解いているか
 *
 * `news_items` のように**利用者に紐づかない共有テーブル**は、利用者IDでテストを隔離できない。
 * ローカルDBを共有したまま vitest がファイルを並列実行するため、時間窓で論理的に隔離する。
 *
 * 2026-08-02、過去の窓では**どこを選んでも壊れる**ことが分かった。
 *
 * - **現在に近い過去**: ローカルDBに実在するニュース（seed・開発中の実取得）と混ざる。
 *   実際に「Aへはaiのニュースだけが届く」が `・OpenAIのGPT-5.6が…` を拾って落ち、
 *   ダイジェストの件数検証も `expected 4 to be 2` になった。
 * - **遠い過去**: 並列実行中の `schedule-cleanup`（`scheduler_tick` が呼ぶ）が
 *   **保持期間40日超の行を削除する**ため、検証の直前にデータが消える。
 *   2000〜2024年の窓を使っていたテストが `matchedUsers = 0` で落ちた。
 *
 * ## なぜ未来なのか
 *
 * 未来の窓なら両方を同時に避けられる。
 *
 * - cleanup は**古い行しか消さない**ので、未来の行は絶対に消えない。
 * - 実データは未来の時刻を持たない（実取得は取得時刻を書き、`news-research` は未来日時の
 *   `published_at` を落とす）。したがって**その窓には自分の行しか存在しない**。
 *
 * `news_items` を `now()` 基準で読むのは診断（直近48時間の件数）だけで、テストは自分の行を
 * 後片付けするため、未来の行が残って表示を汚すことはない。
 */

/** 窓を置く未来の範囲（時間）。十分に散らして並列ファイル間の衝突を避ける。 */
const MIN_HOURS_AHEAD = 24 * 30;
const MAX_HOURS_AHEAD = 24 * 365;

/**
 * テスト専用の、他と交わらない hour-aligned な窓の開始時刻を返す。
 *
 * **この窓には呼び出し側が入れた行しか存在しない**ことを前提にしてよい。
 */
export function uniqueTestHourWindow(now: Date = new Date()): Date {
  const span = MAX_HOURS_AHEAD - MIN_HOURS_AHEAD;
  const hoursAhead = MIN_HOURS_AHEAD + Math.floor(Math.random() * span);
  const d = new Date(now.getTime() + hoursAhead * 3_600_000);
  d.setUTCMinutes(0, 0, 0);
  return d;
}
