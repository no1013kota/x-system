import "server-only";

import { getPool } from "@/lib/db/pool";

/**
 * そのメールアドレスの利用者が存在するか（T-M8-295・運営者の指示 2026-08-25）。
 *
 * ログインに失敗したとき「パスワードが違う」のか「そもそも登録が無い」のかを言い分けるために使う。
 * Supabase の `signInWithPassword` は**どちらも同じ `invalid_credentials`** を返すため、
 * 認証応答だけでは区別できない。
 *
 * **正は `auth.users`**。`profiles` は行が欠けていることがあり（欠損時に修復する経路が
 * `signIn` にある）、そちらで判定すると**登録済みの人へ「新規登録してください」と案内**して
 * しまう——押した先で「既に登録されています」と言われる行き止まりになる。
 *
 * メールは Supabase 側で小文字化されて保存されるため、比較も小文字で行う。
 *
 * 補足（アカウントの存在を明かすことについて）: 新規登録は既に「このメールアドレスは登録済み」を
 * 明かしている（T-M8-149）ので、ログインだけ隠しても存在は分かる。ログイン画面は Turnstile の
 * 通過が必須なので総当たりの列挙は難しく、**「登録が無いと分からず何度も試す」ほうが実害が
 * 大きい**と判断した。パスワード再設定は従来どおり有無を明かさない（メールを送る経路なので、
 * 存在の確認と同時に第三者へメールを送りつける手段になり得る）。
 */
export async function isRegisteredEmail(email: string): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    `select exists (select 1 from auth.users where lower(email) = lower($1)) as exists`,
    [email],
  );
  return rows[0]?.exists ?? false;
}

/**
 * **設定変更前に登録された未確認アカウントを、ログイン時に確認済みへ揃える**
 * （T-M8-377・運営者の指示 2026-08-30）。
 *
 * 新規登録はメール確認なしで完了する設定（mailer_autoconfirm）なので、確認を要求される
 * 経路は本来存在しない。ところが設定変更より前に登録された利用者は未確認のまま残っており、
 * Supabase がログインを `email_not_confirmed` で拒否して**6桁コード画面へ回されていた**。
 * 登録時に求めない確認をログインでだけ求めるのは一貫しないので、ログイン試行の前に
 * その場で確認済みへ更新する。
 *
 * セキュリティ上の整理: 確認を付けてもセッションは発行されない（パスワードが正しいときだけ
 * Supabase が発行する）。また「確認なしで使える」こと自体は新規登録が既に許しているので、
 * この更新で新しくできるようになることは無い。`confirmed_at` は生成列のため
 * `email_confirmed_at` だけを埋める（E2Eのfixtureと同じ形）。
 */
export async function confirmLegacyUnconfirmedEmail(email: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update auth.users set email_confirmed_at = now()
      where lower(email) = lower($1) and email_confirmed_at is null`,
    [email],
  );
  return (rowCount ?? 0) > 0;
}
