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
- 公開コンテンツページ（LP `/`・法務3ページ）は静的prerenderだとnonce付与ができないため `export const dynamic = "force-dynamic"` で動的レンダリングにする。
- HSTS・`nosniff`・Referrer-Policy(`strict-origin-when-cross-origin`) を全応答へ付与（HSTS と upgrade-insecure-requests は `NODE_ENV=production` のみ）。cookie属性（HttpOnly・SameSite=Lax・Secure(prod)）は各cookie setter が既に保証する。

## Consequences

- nonceなしinline/外部scriptは実行されず、XSS耐性が高い。Turnstile・外部画像・Sentryは動作する。
- 公開コンテンツページが静的キャッシュ対象から外れ、per-requestのSSRになる（内容が単純なため負荷影響は軽微）。
- `style-src 'unsafe-inline'` と `img-src https:` はstrictではないが、scriptに比べ露出リスクが小さいという判断による許容。将来、inline style をクラス化し `img` ホストを絞ればさらに強化できる。

## Alternatives

- 静的ページを維持し `'unsafe-inline'`(script) を許可：CSPのXSS耐性を失うため不採用。
- hashベースCSP：Next.jsの動的なscript集合とは相性が悪く、ビルドごとのhash管理costが高いため不採用。
- 静的ページを維持しnonceを諦める：strict CSP下で当該ページのscriptが阻害され、コンソールにCSP違反が出続けるため不採用。
