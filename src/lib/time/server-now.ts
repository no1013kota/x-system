import "server-only";

/**
 * サーバーが画面を描いた時刻（ミリ秒）。**経過時間や「◯秒以上たった」の表示に使う基準**。
 *
 * クライアントコンポーネントで `useState(() => Date.now())` を初期値にすると、
 * **サーバーが描いた時刻と、ブラウザがJSで追いついた（hydration）時刻の2回**評価される。
 * その間に秒が変わると表示が食い違い、React は木を捨てて描き直す（Hydration mismatch）。
 * 2026-08-16、投稿作成の「経過 0:06 / 0:07」がこれで、`release:check` のE2Eに
 * まれに警告が出ていた（T-M8-113）。回線が遅いほど起きやすい。
 *
 * サーバーが測った時刻をpropsで渡せば両者が必ず一致し、初回描画から正しい値が出る。
 * 以後の更新は各コンポーネントのポーリングやタイマーが行う。
 *
 * `async` なのは意図的で、**サーバーコンポーネントの描画中に `Date.now()` を直接呼ぶと
 * lint（純粋でない関数の呼び出し）で止まる**ため。`await serverNowMs()` の形で使う。
 */
export async function serverNowMs(): Promise<number> {
  return Date.now();
}
