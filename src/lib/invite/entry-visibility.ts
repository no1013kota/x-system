/**
 * 友達招待の導線（LP のカード・nav・アプリのナビ・ロック画面の案内文）を出すか（T-M8-445・運営者の指示 2026-09-05「一旦隠す」）。
 *
 * 正本は `FEATURE_INVITE_ENABLED`（`env-schema.ts`。未設定＝false＝非表示）。ここでは `process.env` を直接読む——
 * `@/lib/env` は `server-only` で、純粋な lib（`subscription-access.ts`）や単体テストからは組めないため。
 * 判定は `parseBooleanFlag` と同じ（リテラル "true" だけ真）。復活は Vercel に true を1つ足すだけで、コードは変えない。
 * `/app/invite` 本体・`/r/{code}`・報酬の確定と振込はこのフラグに関係なく動く（既存の報酬を守る）。
 */
export function inviteEntryVisible(): boolean {
  return (
    (process.env.FEATURE_INVITE_ENABLED ?? "").trim().toLowerCase() === "true"
  );
}
