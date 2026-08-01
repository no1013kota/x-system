/**
 * 検証対象のXアカウントの指定（T-M7-49）。
 *
 * `runSmoke` は「本番で他人のアカウントを使わない」ため対象を必ず呼び出し側に明示させる。
 * ただし内部のUUIDを要求していたため、**運営者が自分のアカウントを指定できなかった**
 * （2026-08-01、`--account` にXのユーザー名 `ai_newinfo` が渡された）。UUIDを探すには
 * データベースを直接見るしかなく、`CLAUDE.md` 原則2（開発知識なしで辿れる）に反する。
 *
 * そこで **UUID でも `@handle` でも指定できる**ようにする。自動選択はしない（明示の原則は保つ）。
 */

/** UUID の形か（v4に限らずUUID一般）。 */
export function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

/** 指定子を正規化する（前後の空白と先頭の `@` を落とす）。 */
export function normalizeAccountSelector(value: string): string {
  return value.trim().replace(/^@+/, "");
}

export type ResolvedAccount =
  | { ok: true; id: string; handle: string }
  | { ok: false; message: string };

interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * 指定子から `x_accounts.id` を解決する。
 *
 * **見つからないときは候補を出す**（運営者が次に何を打てばよいか分かるように）。
 * 同じhandleが複数ある場合は選ばずに止める（誤ったアカウントで生成すると枠と費用を消費する）。
 */
export async function resolveXAccountId(
  selector: string,
  deps: { db: Queryable },
): Promise<ResolvedAccount> {
  const value = normalizeAccountSelector(selector);
  if (!value) return { ok: false, message: "Xアカウントの指定が空です。" };

  const { rows } = looksLikeUuid(value)
    ? await deps.db.query("select id, handle from x_accounts where id = $1", [value])
    : await deps.db.query("select id, handle from x_accounts where lower(handle) = lower($1)", [
        value,
      ]);

  if (rows.length === 1) {
    return { ok: true, id: String(rows[0].id), handle: String(rows[0].handle) };
  }

  if (rows.length > 1) {
    return {
      ok: false,
      message: `「${value}」に一致するアカウントが ${rows.length} 件あります。UUIDで指定してください（${rows
        .map((r) => String(r.id))
        .join(" / ")}）。`,
    };
  }

  const { rows: all } = await deps.db.query("select handle from x_accounts order by created_at");
  if (all.length === 0) {
    return {
      ok: false,
      message:
        "連携されたXアカウントがありません。設定画面から「Xアカウントを追加」で連携してください。",
    };
  }
  return {
    ok: false,
    message: `「${value}」に一致するXアカウントがありません。連携済みは ${all
      .map((r) => `@${String(r.handle)}`)
      .join(" / ")} です。`,
  };
}
