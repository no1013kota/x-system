/**
 * X OAuth で要求する scope（T-M8-58）。
 *
 * **純粋な定数モジュール**として分離している。正本だった `oauth.ts` は `node:crypto` を
 * import しており client component から読めないため、設定画面の手順ガイドが同じ5種を
 * **配列リテラルで直書き**していた。scopeを変えると、callback は不足を
 * `insufficient_scope` で拒否する一方、ガイドは古いリストを出し続ける——その食い違いを
 * どのテストも検出できなかった。両方がここを import する。
 */
export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "media.write",
  "offline.access",
] as const;
