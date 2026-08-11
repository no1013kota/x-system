import { readFileSync } from "node:fs";

/**
 * 運営コマンド（`npm run doctor` / `smoke:live` / `check:turnstile`）の共通部品（R32）。
 *
 * 引数の読み取り・鍵の探し方・既定URLが3つの script に同じ内容で書かれていた。
 * 鍵の読み取り規則を直すとき `doctor` だけ直して `smoke:live` が古い規則のまま、
 * という食い違いが起こりうる（どちらも「デプロイ先を覗く」同じ用途で同じ鍵を読む）。
 *
 * plain JS のまま置く（Node から直接読むため、TS も `@/` エイリアスも使わない）。
 */

/** `--name value` 形式の引数を読む。 */
export function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * 指定した名前の値を **環境変数 → `.env.local` → `.env`** の順で探す（値は出力しない）。
 *
 * 環境変数が最優先。CI や一時的な上書きが `.env` に負けると、意図した先とは
 * 違う環境を叩いてしまう。
 */
export function envValue(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    try {
      const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(file, "utf8"));
      if (m?.[1]) return m[1].trim();
    } catch {
      // ファイルが無いのは正常。次の候補へ。
    }
  }
  return undefined;
}

/** 対象のベースURL。`--base` 未指定ならローカル。末尾のスラッシュは落とす。 */
export function baseUrl() {
  return (argOf("base") ?? "http://127.0.0.1:3000").replace(/\/$/, "");
}
