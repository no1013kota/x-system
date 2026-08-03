/**
 * 1 Xアカウントの JST 日次投稿上限（env `X_DAILY_POST_LIMIT`・既定50）の判定（T-M8-26）。
 *
 * ## なぜ純関数として切り出すか
 *
 * 上限の判定はこれまで**投稿job（`jobs/post-publish.ts`）の中だけ**にあり、上限に達している
 * ことは**投稿しようとして初めて分かった**（要決定D-15・案A）。画面上部のバナーで事前に伝える
 * ため、判定を job と画面の両方から使える形にする。
 *
 * **同じ判定を2か所に書かない。** 「残りが何件か」を job と画面で別々に計算すると、片方だけ
 * 直したときに「バナーは出ないのに投稿は弾かれる」というもっとも分かりにくい状態になる。
 */

/** その日にまだ投稿できる件数。上限に達していれば0（マイナスにはしない）。 */
export function remainingDailyPosts(todaysPosts: number, dailyLimit: number): number {
  return Math.max(0, dailyLimit - todaysPosts);
}

/**
 * これから `plannedPosts` 件のスレッドを投稿できるか。
 *
 * **スレッド全体が収まるかで見る**（途中まで投稿して打ち切ると、読めないスレッドがXに残る）。
 */
export function canPostThreadToday(
  todaysPosts: number,
  dailyLimit: number,
  plannedPosts: number,
): boolean {
  return todaysPosts + plannedPosts <= dailyLimit;
}
