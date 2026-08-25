---
name: verify-integration
description: DB・migration・RLS・Server Action・API Route・課金同期・ジョブなど複数境界をまたぐ変更をローカルで安全に統合検証する。これらの実装後、または統合／結合／DBテストを求められたときに使う。
---

# verify-integration：統合テスト

変更に関係する境界だけを選んで検証する。**単体テスト・E2E・外部liveの代わりにはしない。**

## 手順

1. **守る契約を先に列挙する** — DB制約／RLS／API契約／状態遷移／冪等性／同時実行。無関係な変更はしない。
2. **接続先の安全を確認する** — ローカル（`127.0.0.1`）のテストSupabaseであること。**Preview/本番DBで reset・drop・truncate・破壊的migrationをしない。** `supabase db reset` は破棄可能なローカルでクリーン適用確認が要るときだけ（未明示なら承認を得る）。
3. **前提を整える** — `supabase status` で起動確認（未起動だと `*.db.test.ts` は自動skipされる）。テストデータは一意ID。
4. **対象テストを選ぶ** — 下表。`rg` で対応する `*.db.test.ts` を探し、無ければ追加する。
5. **実行する** — 変更に近いテストから `npx vitest run <file>` → 関連する境界群 → 共通基盤・schema・認証・RLSを変えたら `REQUIRE_DB=1 npx vitest run` で退行確認。
6. **完全性を見る** — pass数だけでなく fail／skip／todo。**必須の `*.db.test.ts` が1件でもskipなら合格としない。**
7. **報告** — 環境／検証した契約／結果／skip／未検証事項。

## 変更種別 → 見る契約

| 変更 | 契約 |
|---|---|
| migration / RLS | schema・seed・RLS・別ユーザー拒否・制約・**ロール権限（GRANT）** |
| Server Action / API | 認証・入力検証・所有権・Origin・署名・DB反映 |
| job / Cron | lease・状態遷移・冪等・再試行・stale回収・deadline・同時実行 |
| 課金・利用量 | Webhook重複・イベント順序・契約状態・枠の原子的更新 |
| X・AI | モックで契約と記帳（liveはしない。ただし下の「実物」は別途必須） |

## 見落としやすい3点

- **ロール権限（GRANT）を明示的に検査する。** RLSポリシーはテーブルレベルGRANTがあって初めて評価される。`authenticated` の可否だけでなく **`service_role` 自身の権限**も見る。アプリの多くは直結pgなので権限を回避してしまい、**PostgREST（Supabase client）経由の経路だけが `42501 permission denied` で落ちる**。テーブル追加時は既定権限（`alter default privileges`）まで確認する。実例: service_roleのGRANT漏れでX連携が `internal_error` になった（`service-role-grants.db.test.ts`）。
- **注入した本番実装は無検証になりやすい。** 依存注入で純粋化した中核は単体で覆えるが、**route/actionが渡す実DBクエリ・外部呼び出し**は覆えない。純粋関数のテストが充実しているほど「テスト済み」に見える。route/action自体を実DBで叩くテストの有無を確認する（例: `api/x/oauth/start/route.db.test.ts` はセッションだけモックし、Supabaseクエリは実際に走らせる）。
- **外部APIとの噛み合いは実物でしか分からない。** モックしたテストは「送ったリクエストが受理されるか」「返ってきたものを扱えるか」を一切検証しない。AI provider adapter・プロンプト・出力schema・tool定義に触れたら **`npm run check:providers`（受理されるか）＋ `npm run smoke:live`（扱えるか）の両方**。

  受理されるだけでは足りない実例（すべて2026-07-28）:

  | 症状 | 検出できた層 |
  |---|---|
  | `allowed_callers` 欠落で400（T-M7-15） | check:providers |
  | schemaに `additionalProperties` が無く400（T-M7-21） | check:providers |
  | 200だが前置き文でJSON検証が落ちる（T-M7-20） | **smoke:liveだけ** |
  | 200だが字数上限で全件破棄され分野が常に0件（T-M7-24） | **smoke:liveだけ** |

  費用が出るため要決定D-10（案A）に従う（対象パス3種・1周上限$0.50・実測 約$0.30）。**実費を必ず報告する。**

## ルール

- テストを通す目的で RLS・認可・署名検証・冪等guard を弱めない。
- Preview/本番へ書き込まない。実課金・実投稿・実メールをしない。
- 「合格」は必要な統合テストが全実行され、failと必須skipが0のときだけ。環境不足なら**単体成功と統合未実施を分けて**報告する。
