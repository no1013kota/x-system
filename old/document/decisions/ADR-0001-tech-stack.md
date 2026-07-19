# ADR-0001: 技術スタックの選定

- ステータス: **Proposed（ユーザー承認待ち）** ← 承認されたら Accepted に変更し、architecture.md に反映する
- 日付: 2026-07-19

## 背景

PRD v1.0は提供形態（Webアプリ）・決済（Stripe Checkout）・対応生成AI（Claude/OpenAI/Gemini）は確定しているが、実装技術は未定。選定基準:

1. **個人開発 + Claude Codeエージェント駆動**で開発速度が最大化されること（型安全・単一言語・情報量の多いエコシステム）
2. ジョブ基盤の要件（毎時のニュース取得、曜日×時刻のスロット実行、リトライ、冪等性）を少ない運用負担で満たせること
3. 投稿生成（リサーチ込み60〜90秒）の長時間処理に対応できること
4. MVPの低コスト運用（月額500円プランが成立する原価構造）

## 決定（提案）

| レイヤ | 採用technology | 理由 |
|---|---|---|
| フレームワーク | **Next.js（App Router）+ TypeScript** | フロント/API一体で個人開発向き。エコシステム最大 |
| DB / 認証 | **Supabase（PostgreSQL + Auth）** | メール認証・パスワードリセットが組み込み（A-1, A-2をほぼ実装不要に）。無料枠から開始可 |
| ORM | **Prisma** | スキーマファイルが仕様書として読みやすく、data-model.mdとの同期が容易 |
| ジョブ基盤 | **Inngest** | cron（ニュース毎時取得）・遅延実行（スロット）・自動リトライ・ステップ実行（60-90秒の生成処理を分割）が宣言的に書ける。無料枠あり。Vercelと相性が良い |
| ホスティング | **Vercel** | Next.js最適。無料枠から開始可 |
| 決済 | **Stripe**（Checkout + Customer Portal + Webhook） | PRDで確定済み（O-1） |
| 生成AI連携 | 各社公式SDK + 自前のプロバイダ抽象化レイヤ | Claude/OpenAI/Geminiのモデル切替・Web検索機能差・BYOK/運営キー切替を1レイヤに集約（§8.2） |
| メール送信 | **Resend** | 通知メール・確認メール。実装が最小 |
| APIキー暗号化 | AES-256-GCM（アプリレベル暗号化、鍵は環境変数） | PRD §7の暗号化保存要件。MVPでは KMS を使わず単純に |

## 検討した代替案

- **Rails / Laravel モノリス**: ジョブ基盤（Sidekiq等）は強いが、TypeScript単一言語の開発効率とVercelエコシステムを優先
- **BullMQ + Redis / pg-boss + 常駐ワーカー**: 自由度は高いが、常駐プロセスの運用・監視コストが個人開発には重い。Inngestで代替可能
- **Auth.js（NextAuth）**: メール認証・パスワード再設定を自前実装する必要があり、Supabase Authの方がMVP向き

## 影響

- 開発言語はTypeScriptに統一。スカフォールドは `create-next-app` ベース（M0）
- Inngestの実行モデル（イベント駆動・ステップ関数）を前提にスケジューラを設計する（architecture.md §3.5）
- Supabase / Vercel / Inngest / Resend / Stripe のアカウントが必要（M0でセットアップ）
- 為替・各サービスの料金改定リスクはあるが、MVP規模ではすべて無料〜低額枠に収まる見込み

## 備考

承認・修正はこのファイルのステータス更新をもって行う。変更する場合は本ADRを Superseded にして ADR-0002 を起こす。
