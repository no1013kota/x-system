# ADR-0005: nonceベースCSPの実装方針（strict-dynamic・動的レンダリング・許可リスト）

- Status: Accepted
- Date: 2026-07-25

## Context

要件01 §8 は「CSPはnonceベースとし、`frame-ancestors 'none'`・`object-src 'none'` を含める。HSTS・`X-Content-Type-Options: nosniff`・厳格なReferrer-Policyをproductionで付与する」と定める（T-M6-17）。Next.js（App Router, v16）でnonceベースCSPを成立させるには、実アプリが使う外部リソース（Cloudflare Turnstile、X アバター/Supabase Storage 画像、Sentry）とNext.jsの静的レンダリングとの整合が必要になる。特にNext.jsの静的prerenderページはビルド時にHTMLを固定するため、per-requestのnonceをscriptに付与できず、strict CSP下で自身のscriptが実行阻害される問題がある。

## Decision

proxy（`updateSupabaseSession`）でリクエストごとにnonceを発行し、`src/lib/security-headers.ts` が組み立てたCSPを request/response 双方のヘッダへ付与する。

- `script-src 'self' 'nonce-{nonce}' 'strict-dynamic'`（productionは `'unsafe-eval'` 無し、devのみ許可）。`'unsafe-inline'` を含めず、nonceなしinline scriptを実行させない。Next.js は request の CSP から nonce を読み自身の script と `next/script`（Turnstile）へ付与する。
- `style-src 'self' 'unsafe-inline'`：React の `style={{}}` 属性と Next/Tailwind のため許容（styleはscript実行を伴わず露出リスクが低い）。
- `img-src 'self' data: blob: https:`：X アバター（pbs.twimg.com）・Supabase Storage の下書き画像・ニュース画像など任意ホストの画像表示のため https: を許容。
- `connect-src`/`frame-src` に Turnstile（challenges.cloudflare.com）を、`connect-src` に DSN設定時の Sentry Ingest を加える。
- `frame-ancestors 'none'`・`object-src 'none'`・`base-uri 'self'`・`form-action 'self'`。production のみ `upgrade-insecure-requests`。
- **アプリ全体を動的レンダリングにする**（`src/app/layout.tsx` の `export const dynamic = "force-dynamic"`）。静的prerenderだとnonce付与ができないため。→ 2026-08-14 改訂。当初は対象を「公開コンテンツページ（LP `/`・法務3ページ）」と数え上げていたが、その数え上げが不完全だった（後述の「改訂」）。
- HSTS・`nosniff`・Referrer-Policy(`strict-origin-when-cross-origin`) を全応答へ付与（HSTS と upgrade-insecure-requests は `NODE_ENV=production` のみ）。cookie属性（HttpOnly・SameSite=Lax・Secure(prod)）は各cookie setter が既に保証する。

## Consequences

- nonceなしinline/外部scriptは実行されず、XSS耐性が高い。Turnstile・外部画像・Sentryは動作する。
- 公開コンテンツページが静的キャッシュ対象から外れ、per-requestのSSRになる（内容が単純なため負荷影響は軽微）。
- `style-src 'unsafe-inline'` と `img-src https:` はstrictではないが、scriptに比べ露出リスクが小さいという判断による許容。将来、inline style をクラス化し `img` ホストを絞ればさらに強化できる。

## 改訂（2026-08-14・T-M8-87）

**何が起きたか。** 本番（exosai.net）で `/signup` と `/reset-password` が機能していなかった。scriptタグ16本すべてがCSPで拒否され、会員登録もパスワード再設定もできない状態だった。HTTPは200を返し本文も表示されるため、単体1,300件超・E2E・CI がすべて緑のまま18日間気付かれなかった。

**原因は判断ではなく対象の数え上げ。** 上の Decision は原因（静的prerenderにnonceを付けられない）と対策（`force-dynamic`）を正しく書いていたが、**適用先を「LP＋法務3ページ」と手で列挙していた**。認証画面はこの列挙から漏れた。列挙が実装と一致しているかを確認する仕組みも無かった。

**改訂の内容。**

- `force-dynamic` は個々のページに書かず、**`src/app/layout.tsx` に1箇所だけ置く**。ページを新しく足しても既定で動的になり、列挙する対象が存在しなくなる（CLAUDE.md 原則3＝手順を人間の記憶に依存させない）。ページ側の4つの宣言は削除した。
- 破られていないことを **`npm run check:csp-nonce`** が確認する（`release:check` の `build` 直後に実行）。ビルド成果物 `.next/server/app/**/*.html` を走査し、nonceの無いscriptを持つHTMLがあれば落とす。判定は `src/lib/ops/prerender-nonce.ts`（純粋関数・実際に壊れていたHTMLをfixtureにした単体テスト付き）。
- 例外は `NONCE_EXEMPT` に理由付きで1件だけ置く（`/_global-error`＝Next.js既定の500画面。root layoutごと差し替わるため `force-dynamic` の対象外で常に静的。本文は静的テキストのみでJSを必要としない）。**例外がビルドの実態と合わなくなったらそれ自体で落ちる**。

**なぜE2Eでは守れないか。** E2Eは `npm run dev` で動く。dev modeは静的prerenderをしないため、この不具合は**原理的に再現しない**。ビルド成果物を読む検査以外に手段が無い。

**副作用。** 静的キャッシュ対象がゼロになった。失うものは実質無かった——32ルートのうち静的だったのは `/signup`・`/reset-password`・`/_not-found` の3つだけで、LPも法務ページも既に動的だった。

## Alternatives

- 静的ページを維持し `'unsafe-inline'`(script) を許可：CSPのXSS耐性を失うため不採用。
- hashベースCSP：Next.jsの動的なscript集合とは相性が悪く、ビルドごとのhash管理costが高いため不採用。
- 静的ページを維持しnonceを諦める：strict CSP下で当該ページのscriptが阻害され、コンソールにCSP違反が出続けるため不採用。
