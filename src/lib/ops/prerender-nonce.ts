/**
 * 「nonce付きCSPの下で動かないHTML」の判定（T-M8-87）。
 *
 * `security-headers.ts` の `script-src` は `'nonce-…' 'strict-dynamic'`。`'strict-dynamic'` は
 * ホスト指定（`'self'`）を**無視させる**ため、nonceが一致しないscriptは1本も実行されない。
 * nonceはリクエストごとに作るので、**ビルド時にHTMLへ焼き付けられない**。
 * つまり静的プリレンダされたHTMLは、scriptを持っていれば必ず全滅する。
 *
 * この形は既存の検査では見えなかった:
 * - `security-headers.test.ts` はヘッダの文字列だけを見る（HTML側にnonceが載ったかは見ない）
 * - E2Eは `next dev` で動く。dev modeはプリレンダしないので**原理的に再現しない**
 * - typecheck・lint・build はどれも成功する。HTTPも200を返し、本文も表示される
 *
 * 2026-08-14、本番（exosai.net）の `/signup` と `/reset-password` がこの状態だった。
 * scriptタグ16本すべてがCSPで拒否され、会員登録とパスワード再設定ができなかった。
 *
 * 判定だけをここに置き、ビルド成果物の読み出しは `scripts/check-csp-nonce.mjs` が行う
 * （`ops/check.ts` と同じ方針＝importを持たないので .mjs から直接読める）。
 */

/** ビルドが出力した1ページ分のHTML。 */
export interface PrerenderedPage {
  /** 表示用のルート名（`/signup` など）。 */
  route: string;
  html: string;
}

/** 1ページの判定結果。 */
export interface PageVerdict {
  route: string;
  /** HTML内の script 開始タグの総数。 */
  scripts: number;
  /** そのうち nonce 属性を持つ数。 */
  withNonce: number;
}

/**
 * script開始タグを数え、nonce属性を持つものを数える。
 *
 * 属性を持たない `<script>`（インライン）も対象。`<scripts>` のような別要素を拾わないよう
 * タグ名の直後が属性区切りか `>` であることを要求する。
 */
export function countScriptNonces(html: string): { scripts: number; withNonce: number } {
  const tags = html.match(/<script(?=[\s/>])[^>]*>/gi) ?? [];
  let withNonce = 0;
  for (const tag of tags) {
    if (/\snonce\s*=/i.test(tag)) withNonce += 1;
  }
  return { scripts: tags.length, withNonce };
}

/**
 * nonce付きCSPの下で動かないページを返す。
 *
 * scriptを1本も持たないHTML（純粋な静的テキスト）は問題ないので除く。
 * **1本でもnonceの無いscriptがあれば落とす**——`'strict-dynamic'` の下ではそのscriptは
 * 実行されず、ハイドレーションに必要な一部が欠ければ画面は壊れる。
 */
export function deadUnderNonceCsp(pages: readonly PrerenderedPage[]): PageVerdict[] {
  return pages
    .map(({ route, html }) => ({ route, ...countScriptNonces(html) }))
    .filter((v) => v.scripts > 0 && v.withNonce < v.scripts);
}

/**
 * scriptが動かなくても構わないページ。**キーはルート、値は理由**。
 *
 * ここへ足すのは「JSが1本も動かない状態でも利用者が目的を達せる」ページだけ。
 * 迷ったら足さずに動的レンダリングへ変えること（例外は穴になる）。
 */
export const NONCE_EXEMPT: Readonly<Record<string, string>> = {
  "/_global-error":
    "Next.js 既定の500画面。root layout ごと差し替わるため force-dynamic の対象外で常に静的。" +
    "本文は「500: This page couldn't load」の静的テキストだけで、JSを必要としない",
};

export interface ScanResult {
  /** 直すべきもの（例外を除く）。 */
  dead: PageVerdict[];
  /** 理由付きで許したもの。 */
  exempt: PageVerdict[];
  /**
   * ビルドに存在しない例外。
   *
   * 例外が実態とずれたまま残ると、**次に同じルート名で別のものが出てきたとき黙って通す**。
   * 消し忘れも検査対象にする（`env-secret-usage.test.ts` の「1件以上ある」ガードと同じ考え方）。
   */
  staleExemptions: string[];
}

/** プリレンダされたHTML一式を判定する。 */
export function scanPrerendered(pages: readonly PrerenderedPage[]): ScanResult {
  const all = deadUnderNonceCsp(pages);
  const routes = new Set(pages.map((p) => p.route));
  return {
    dead: all.filter((v) => !(v.route in NONCE_EXEMPT)),
    exempt: all.filter((v) => v.route in NONCE_EXEMPT),
    staleExemptions: Object.keys(NONCE_EXEMPT).filter((r) => !routes.has(r)),
  };
}

/** 運営者向けの説明（原因と直し方を1つの文で伝える）。 */
export function describeVerdicts(verdicts: readonly PageVerdict[]): string {
  if (verdicts.length === 0) return "静的プリレンダされたHTMLはありません。";
  const lines = verdicts.map(
    (v) => `  ❌ ${v.route}: scriptタグ ${v.scripts} 本のうち nonce付きは ${v.withNonce} 本`,
  );
  return [
    `nonce付きCSPの下で動かないページが ${verdicts.length} 件あります。`,
    ...lines,
    "",
    "これらは静的プリレンダされているため、リクエストごとのnonceをHTMLへ入れられません。",
    "`'strict-dynamic'` が `'self'` を無効化するので、scriptは1本も実行されません",
    "（HTTPは200を返し本文も表示されるため、ブラウザで操作しないと気付けません）。",
    "→ 該当ページを動的レンダリングにしてください。既定は `src/app/layout.tsx` の",
    "   `export const dynamic = \"force-dynamic\"` です。これを外したか、下位の segment で",
    "   上書きした可能性があります。",
  ].join("\n");
}
