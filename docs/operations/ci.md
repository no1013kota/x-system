# 運用メモ: CI（GitHub Actions）

| 項目 | 内容 |
|---|---|
| バージョン | v1.5 |
| 更新日 | 2026-08-20 |
| 関連 | [開発とテストの進め方](./development-and-testing.md)／[リリース前チェックリスト](./release-checklist.md)／[デプロイ手順](./deployment.md)／[ローカル開発](./local-development.md)／[システム構成 §3 環境変数](../requirements/01_system_architecture.md) |

`.github/workflows/ci.yml`。リリース判定ゲート `npm run release:check` を push / PR ごとに機械的に実行する。ゲートが整っていても手元で実行し忘れれば意味が無いため、**実行そのものを強制すること**が目的。

---

## 1. いつ動くか

| トリガー | 対象 |
|---|---|
| push | `main`／`stg` |
| pull_request | 全ブランチ |
| workflow_dispatch | 手動実行 |

同一ブランチで新しい push があれば古い実行はキャンセルする（`concurrency`）。

## 2. 何を実行するか

| job | 内容 | 目的 |
|---|---|---|
| `static` | `npm ci` → `typecheck` → `lint` | 数十秒で返る検査を先に落とす（`verify` の完了を待たない） |
| `verify` | `supabase start` → `.env.local` 生成 → service_role 権限テスト → Playwright ブラウザ取得 → **`npm run release:check`** | 手元と同一のゲートを丸ごと実行 |

`verify` は `release:check` を分解せず**そのまま呼ぶ**。CI側に手順を書き写すと、`release:check` へステップを追加してもCIに反映されず穴が開くため。`static` の内容は `release:check` にも含まれるので、`static` を消しても検査範囲は狭まらない（速度のためだけに分けている）。

`supabase start` は migration と seed をクリーン適用するので、**migration自体の適用可否もCIで毎回検証される**。`service_role` の権限テスト（`src/lib/db/service-role-grants.db.test.ts`）だけは `release:check` より前に単独で実行する。ここが落ちると以降のDBテストが総崩れして原因が読みづらくなるため。

## 3. 秘密情報を置かない

GitHub Secrets は使わない。テストは外部API（Stripe / X / AI各社 / SMTP）をすべてモックし、実データは `supabase start` で立ち上げるローカルSupabaseだけを使うため、本物の鍵が要らない。

`.env.local` は `scripts/ci-env.mjs` が実行時に組み立てる。

| 値 | 出どころ |
|---|---|
| Supabase接続情報（URL・anon・service_role・DB） | `supabase status -o env`（ローカルスタックの値） |
| `APP_ENCRYPTION_KEY`／`CRON_SECRET` | 実行ごとに `randomBytes(32)` で生成（実行間で共有しない） |
| Turnstile | Cloudflare公開のテストキー（常に成功。秘密情報ではない） |
| Stripe / X / AI各社 / SMTP | 非空のダミー文字列（対応クライアントはテストでモックされる） |
| `SENTRY_DSN`／`NEXT_PUBLIC_SENTRY_DSN` | 出力しない（未設定＝no-op が正常系） |

キー一覧は `.env.example` を土台にするため、環境変数を追加したら `.env.example` に載せるだけでCIにも反映される。空値は出力しない（env検証は「キーがある＝設定済み」と見なすため、空文字は `optional` ではなく「短すぎる」で落ちる）。

`APP_ENV=development`／`X_POSTING_MODE=dry_run` で動くので、CIから実投稿・実課金・実メール送信は起こらない。

## 4. 限界（CIで防げないこと）

- **E2Eの範囲は `e2e/` のspecファイルが事実**（本数はここへ写さない）。ただし**外部サービスへ実際のセッションは作らない**（Stripeのcheckout/portalボタンは押さず、遷移先と表示だけを見る。ボタンの先の配線は `route.db.test.ts` がSDKモックで検証する）。またAI生成と実投稿はE2Eでは実行しない（費用と不確定性のため。生成のリクエスト形状は `npm run check:providers` が担当）。
- **外部APIとの実通信は検証しない。** provider側の仕様変更・リクエスト形状の誤りはCIでは検出できない（テストが全てモックするため）。この層は2つに分かれ、どちらも実キーと費用が必要なためCIへは入れられない。providerやモデルを変えたときは手で実行する。
  - `npm run check:providers` — **リクエストが受理されるか**（本番のファクトリとschemaで最小リクエストを投げる）
  - `npm run smoke:live` — **応答をアプリが扱えるか**（生成・画像・ニュースを1周し、下書き・画像・itemという成果物まで検証）。受理されても後段で落ちる型（前置き文でJSON検証が落ちる／字数上限で全件破棄）はこちらでしか捕まらない
- **Node のメジャーがVercelと異なる。** CIはローカル開発と同じ Node 26 で走る（手元のゲートと同一結果にするため）。Vercelは自身のLTS既定でビルドするので、Nodeバージョン依存のビルド差はCIでは検出できない。揃えるならVercelのNodeバージョン設定と `ci.yml` の `node-version` を同じ値にする。
- **preview / production の環境差は検証しない。** CIは `APP_ENV=development` で走るため、Vercel側の環境変数の欠落・誤りは[デプロイ後の検証](./deployment.md)で見る。

## 5. 落ちたときの読み方

| 症状 | 見るところ |
|---|---|
| `audit:check` が「registryへ到達できない」で失敗 | npm registry の一時障害。ゲートは fail-closed 設計なので緑にはならない。再実行する（`Re-run jobs`） |
| service_role 権限テストが失敗 | migration `20260726000002_grant_service_role.sql` が適用されていない／新規テーブルに権限が付いていない |
| E2Eが timeout | CIの2コアランナーでは各routeの初回コンパイルに数十秒かかる。`playwright.config.ts` は `process.env.CI` で待ち時間を広げている（test 150s／expect 30s／webServer 240s）。それでも足りない場合は待ち時間ではなく遅い原因を見る |
| E2Eが assertion で失敗 | `playwright-artifacts`（失敗時のみ7日保存）の trace・screenshot を取得する |

retry は 0 のまま（CIでも）。flaky を無条件 retry で隠すと、テストが「動いているつもり」になるため。
