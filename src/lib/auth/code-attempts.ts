/**
 * 確認コードの連続失敗を抑える（T-M8-124）。
 *
 * ## 何を守るか
 *
 * 6桁＝100万通り。総当たりの本体はSupabaseのIPごとのレート制限
 * （`rate_limit_verify` = 5分30回）が止める。ここが受け持つのは**1つのアドレスに対する
 * 執念深い試行**で、IPを変えて回されると上の制限をすり抜けるため、宛先ごとにも数える。
 *
 * ## 利用者のストレスにしない
 *
 * - **打ち間違いの数回では何も起きない。** 上限は10回で、残り回数は3回を切ってから初めて出す
 *   （最初から「残り10回」と出すと、間違えていないのに急かされる）
 * - 上限に達しても**行き止まりにしない**。コードを再送すれば数え直す（再送はTurnstileつき）
 * - 画像認証や待ち時間は入れない。**正しく入力できる人が損をしない**ことを優先する
 *
 * ## なぜメモリなのか
 *
 * この上限は「同じ画面で連打されること」を止めるためのもので、**厳密さより軽さを採る**。
 * DBに持つと登録前の利用者ぶんの行が増え、掃除も要る。プロセスが入れ替わると数えは
 * 消えるが、そのときもSupabase側のIP制限は効き続けるので守りは残る。
 */

/** 1つのアドレスに許す連続失敗の回数。 */
export const MAX_CODE_ATTEMPTS = 10;
/** 残りをこの数以下になってから知らせる（それまでは黙っている）。 */
export const ATTEMPTS_WARN_AT = 3;
/** 数えを保持する時間。コードの有効期間（1時間）に合わせる。 */
/**
 * 失敗回数を数える窓。**Supabase側のコード有効期間（`mailer_otp_exp`）と揃える**（T-M8-144）。
 * ずれると「コードは生きているのに数えは切れている」（逆も）という説明できない状態になる。
 * 一致は `auth-settings-sync.test.ts` が機械的に見る。
 */
export const CODE_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
const WINDOW_MS = CODE_ATTEMPT_WINDOW_MS;

interface Entry {
  failures: number;
  firstAt: number;
}

const attempts = new Map<string, Entry>();

/** 期限切れの数えを落とす（Mapが増え続けないように、読むたびに掃除する）。 */
function prune(now: number): void {
  for (const [key, entry] of attempts) {
    if (now - entry.firstAt > WINDOW_MS) attempts.delete(key);
  }
}

function keyFor(email: string): string {
  return email.trim().toLowerCase();
}

export interface AttemptState {
  /** これ以上試せない。 */
  blocked: boolean;
  /** 残り回数（`blocked` のときは0）。 */
  remaining: number;
}

/** いまの状態を見る（数えは増やさない）。 */
export function codeAttemptState(email: string, now: number = Date.now()): AttemptState {
  prune(now);
  const entry = attempts.get(keyFor(email));
  const failures = entry ? entry.failures : 0;
  const remaining = Math.max(0, MAX_CODE_ATTEMPTS - failures);
  return { blocked: remaining === 0, remaining };
}

/** 失敗を1つ数える。 */
export function recordCodeFailure(email: string, now: number = Date.now()): AttemptState {
  prune(now);
  const key = keyFor(email);
  const entry = attempts.get(key);
  if (entry) entry.failures += 1;
  else attempts.set(key, { failures: 1, firstAt: now });
  return codeAttemptState(email, now);
}

/**
 * 数えを消す。**成功したときと、コードを再送したとき**に呼ぶ。
 * 再送で消すのは、上限に達した利用者を行き止まりにしないため（原則1）。
 */
export function clearCodeAttempts(email: string): void {
  attempts.delete(keyFor(email));
}

/** テスト用。プロセスをまたがない前提の実装なので、明示的に空にできるようにする。 */
export function resetCodeAttemptsForTest(): void {
  attempts.clear();
}
