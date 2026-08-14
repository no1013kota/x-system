import { describe, expect, it } from "vitest";

import {
  countScriptNonces,
  deadUnderNonceCsp,
  describeVerdicts,
  NONCE_EXEMPT,
  scanPrerendered,
} from "./prerender-nonce";

/**
 * 判定そのものを固定する（T-M8-87）。
 *
 * ビルド成果物を走査する `scripts/check-csp-nonce.mjs` は、**直った後は対象0件になる**。
 * 対象が0件の検査は「壊れていても緑」と見分けが付かないため、判定の本体はここで
 * 実際に壊れていたHTMLの形（2026-08-14 の本番 `/signup`）を使って証明する
 * （development-and-testing.md §11 の「ソースを走査する検査」と同じ考え方）。
 */

/** 2026-08-14 の本番 `/signup` の形。scriptタグにnonceが1つも無い。 */
const PRERENDERED_SIGNUP = `<!DOCTYPE html><html lang="ja"><head>
<script src="/_next/static/chunks/main-app.js" async></script>
<script src="/_next/static/chunks/webpack.js" async></script>
</head><body><div>会員登録</div>
<script>self.__next_f.push([1,"..."])</script>
</body></html>`;

/** 動的レンダリングされた `/login` の形。すべてのscriptに同じnonceが付く。 */
const DYNAMIC_LOGIN = `<!DOCTYPE html><html lang="ja"><head>
<script src="/_next/static/chunks/main-app.js" async nonce="NTNkZjY1MWU"></script>
<script src="/_next/static/chunks/webpack.js" async nonce="NTNkZjY1MWU"></script>
</head><body><div>ログイン</div>
<script nonce="NTNkZjY1MWU">self.__next_f.push([1,"..."])</script>
</body></html>`;

describe("countScriptNonces", () => {
  it("プリレンダされたHTMLは script を数えられ、nonce付きは0本", () => {
    expect(countScriptNonces(PRERENDERED_SIGNUP)).toEqual({ scripts: 3, withNonce: 0 });
  });

  it("動的レンダリングされたHTMLは全数にnonceが付く", () => {
    expect(countScriptNonces(DYNAMIC_LOGIN)).toEqual({ scripts: 3, withNonce: 3 });
  });

  it("属性を持たないインラインscriptも数える", () => {
    expect(countScriptNonces("<script>a()</script>")).toEqual({ scripts: 1, withNonce: 0 });
  });

  it("自己終了形の書き方でも数える", () => {
    expect(countScriptNonces('<script src="/a.js"/>')).toEqual({ scripts: 1, withNonce: 0 });
  });

  it("タグ名が前方一致する別要素を拾わない", () => {
    // `<scripts>` のような架空の要素や、本文中の「script」という語で誤検知しないこと。
    expect(countScriptNonces("<scripts></scripts>script という語")).toEqual({
      scripts: 0,
      withNonce: 0,
    });
  });

  it("nonce に似た属性名を nonce と誤認しない", () => {
    // `data-nonce` は CSP の nonce ではない。これを数えると壊れたHTMLを見逃す。
    expect(countScriptNonces('<script src="/a.js" data-nonce="x"></script>')).toEqual({
      scripts: 1,
      withNonce: 0,
    });
  });

  it("scriptを持たないHTMLは0本（法務ページのような純粋な静的テキスト）", () => {
    expect(countScriptNonces("<html><body><h1>利用規約</h1></body></html>")).toEqual({
      scripts: 0,
      withNonce: 0,
    });
  });
});

describe("deadUnderNonceCsp", () => {
  it("nonceの無いscriptを持つページを挙げる", () => {
    expect(
      deadUnderNonceCsp([
        { route: "/signup", html: PRERENDERED_SIGNUP },
        { route: "/login", html: DYNAMIC_LOGIN },
      ]),
    ).toEqual([{ route: "/signup", scripts: 3, withNonce: 0 }]);
  });

  it("scriptを持たないHTMLは対象外（プリレンダされていても壊れない）", () => {
    expect(deadUnderNonceCsp([{ route: "/terms", html: "<html><body>規約</body></html>" }])).toEqual(
      [],
    );
  });

  it("一部だけnonceが欠けていても落とす（欠けた1本でハイドレートが壊れる）", () => {
    const mixed = `<script src="/a.js" nonce="n"></script><script src="/b.js"></script>`;
    expect(deadUnderNonceCsp([{ route: "/x", html: mixed }])).toEqual([
      { route: "/x", scripts: 2, withNonce: 1 },
    ]);
  });

  it("何も渡さなければ空（走査対象0件そのものは異常ではない）", () => {
    expect(deadUnderNonceCsp([])).toEqual([]);
  });
});

describe("scanPrerendered（例外の扱い）", () => {
  const globalError = { route: "/_global-error", html: PRERENDERED_SIGNUP };

  it("例外にしたルートは dead へ入れず exempt へ回す", () => {
    const r = scanPrerendered([globalError]);
    expect(r.dead).toEqual([]);
    expect(r.exempt.map((v) => v.route)).toEqual(["/_global-error"]);
    expect(r.staleExemptions).toEqual([]);
  });

  it("例外でないルートは dead に残る", () => {
    const r = scanPrerendered([globalError, { route: "/signup", html: PRERENDERED_SIGNUP }]);
    expect(r.dead.map((v) => v.route)).toEqual(["/signup"]);
  });

  it("ビルドに無い例外を消し忘れとして挙げる（例外が穴になるのを防ぐ）", () => {
    // 例外だけを持つ設定で、そのルートが1つもプリレンダされなくなった場合。
    expect(scanPrerendered([]).staleExemptions).toEqual(Object.keys(NONCE_EXEMPT));
  });

  it("例外には必ず理由が書かれている", () => {
    for (const [route, reason] of Object.entries(NONCE_EXEMPT)) {
      expect(reason.length, `${route} の理由が短すぎる`).toBeGreaterThan(30);
    }
  });

  it("例外は1件だけ（増えていたら設計を見直す合図）", () => {
    // 増やすこと自体は禁止しないが、黙って増えないようにここで数を固定する。
    expect(Object.keys(NONCE_EXEMPT)).toEqual(["/_global-error"]);
  });
});

describe("describeVerdicts", () => {
  it("原因と直し方まで書く（ログを読ませない）", () => {
    const text = describeVerdicts([{ route: "/signup", scripts: 16, withNonce: 0 }]);
    expect(text).toContain("/signup");
    expect(text).toContain("16");
    expect(text).toContain("force-dynamic");
    expect(text).toContain("strict-dynamic");
  });

  it("問題が無ければそう言う", () => {
    expect(describeVerdicts([])).toContain("ありません");
  });
});
