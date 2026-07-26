# x-system（Space AI）開発ガイド

X自動投稿Webアプリ「Space AI」の開発リポジトリ。仕様の正本は`docs/`配下の3領域（PRD／要件定義・詳細／プロンプト設計）。

## 最重要ルール：ドキュメントとコードの同期

`docs/` 配下は常に実装の現状と一致していなければならない（Single Source of Truth）。

1. 仕様に影響する変更（機能追加・挙動変更・DBスキーマ変更・API変更・画面変更・プロンプト変更）を実装したら、**同じ作業単位の中で**該当ドキュメントを更新する。ドキュメント更新までがタスクの完了条件。
2. どのドキュメントを更新すべきかは`docs/README.md`のドキュメントマップに従う。各領域は相互参照しているため波及も確認する。
3. 要件そのものが変わる場合はPRDを更新し、変更履歴に追記する。実装詳細はPRDではなく要件定義書・プロンプト設計書に書く。
4. コミット前に `/doc-sync` を実行して同期漏れを検出する。
5. ドキュメントに書かれていない仕様判断を実装したら必ず正本へ書き戻す。各領域でカバーされない技術判断は`docs/decisions/`にADRとして記録する。

## ディレクトリ構成

| パス | 内容 |
|---|---|
| `docs/` | 仕様の正本3領域＋ADR。構成と更新ルールは`docs/README.md` |
| `tasks/BACKLOG.md` | 開発バックログ（M0〜M6・エージェントループの作業キュー） |
| `.claude/skills/` | 開発用スキル（doc-sync / dev-loop / refactor / ui-polish / playwright-cli / verify-integration / verify-e2e） |
| `.mcp.json` | Claude Code向けMCP設定（shadcn/ui / Next.js DevTools） |
| アプリ本体 | Next.js（App Router）。M0でリポジトリ直下にスカフォールドする |

## 仕様の読み方（実装時に必ず該当セクションを参照）

- **何を作るか** → `docs/PRD.md`（機能ID: A/L/N/P/S/K/M/O）
- **どう作るか（画面・DB・処理）** → `docs/要件定義書.md`から`docs/requirements/`を参照（SC-01〜11、DB17テーブル、定時トリガー4本）
- **AIの動かし方** → `docs/プロンプト設計書.md`（実行ID: GEN/NEWS/LRN/MD-MERGE/SUGGEST、プロンプト全文、検証）
- versionはファイル名ではなく文書内ヘッダを正とする（運用ルールは`docs/README.md`）

## 開発の進め方（エージェントループ）

- タスクは`tasks/BACKLOG.md`で管理する。ステータス運用ルールは同ファイル冒頭に記載。
- `/dev-loop` で「次のタスク選択 → 実装 → 検証 → ドキュメント同期 → コミット」を1サイクル実行する。
- 連続で自動開発する場合は `/loop /dev-loop`。
- `/dev-loop` は変更影響に応じ、DB・API・job等では `/verify-integration`、主要ユーザーフローでは `/verify-e2e` を実行する。新規実装か既存更新かでは分けない。
- ユーザー向け画面・コンポーネントの作成／更新は `/ui-polish` を使用し、Next.js DevToolsとPlaywrightによる実ブラウザ検証まで同じ作業単位で行う。
- 1タスク = 1コミット。コミットメッセージにタスクIDを含める（例: `feat(T-M1-01): メール認証を実装`）。
- ユーザー判断が必要な事項は勝手に決めず、`tasks/BACKLOG.md` の「要決定」セクションに追記して先へ進む（可能なら暫定案を添える）。

## Definition of Done（全タスク共通）

- [ ] 実装が完了し、テストが通る
- [ ] UI変更では `/ui-polish` の画面幅・主要状態・アクセシビリティ・ランタイム検証が完了している
- [ ] `/doc-sync` 実行済み（該当ドキュメントを更新した、または影響なしを理由付きで確認した）
- [ ] `tasks/BACKLOG.md` のステータスと実装メモを更新した
- [ ] タスクIDを含むメッセージでコミットした

## 技術スタック

`docs/requirements/01_system_architecture.md`と`04_jobs_and_automation.md`で定義：Next.js App Router／Tailwind CSS + shadcn/ui／Vercel Pro／Supabase Free（初期）／launchd（初期定時トリガー、後にVercel Cron）／DBキュー／Stripe／Cloudflare Turnstile／AES-256-GCM／Sentry。
変更する場合は該当要件詳細を更新し、判断の経緯を`docs/decisions/`にADRとして記録する。

## 規約

- ドキュメント・コミットメッセージ・ユーザーへの応答は日本語。コードの識別子・コード内コメントは英語。
- 秘密情報（APIキー・トークン・暗号鍵等）は `.env`（gitignore済み）のみに置く。コード・ドキュメント・コミットに実キーを書かない。
- 外部API（X API・Claude/OpenAI/Gemini・Stripe）の仕様は変更が頻繁。ドキュメント内にも「実装時に要確認」注記があるため、該当箇所の実装時は必ず公式ドキュメントで最新仕様を確認する。
