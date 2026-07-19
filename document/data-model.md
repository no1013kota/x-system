# データモデル

- ステータス: Draft（初期案。実装時にマイグレーションと同期して確定させる）
- 最終更新日: 2026-07-19

PRDから導出したエンティティ候補。フィールドは代表的なもののみ記載し、詳細は実装時（各マイルストーン）に確定・追記する。

## エンティティ一覧

| エンティティ | 概要 | 主な属性（候補） | PRD参照 |
|---|---|---|---|
| User | サービス利用者 | email, password_hash, email_verified, plan | A-1, A-2 |
| Subscription | Stripeサブスク状態 | stripe_customer_id, stripe_subscription_id, plan, status, trial_end | O-1, §6 |
| XAccount | 連携Xアカウント（ユーザーに複数、上限はプラン制御） | user_id, x_user_id, handle, oauth_token(暗号化), oauth_refresh_token(暗号化) | A-3, A-6 |
| ApiKey | ユーザー登録APIキー（BYOK） | user_id, kind(x/claude/openai/gemini), encrypted_key, last4, usage(文章/リサーチ/画像のモデル割当) | A-4, A-5 |
| BaseMd | ベースmdファイル（Xアカウントごとに1つ） | x_account_id, content, updated_at | §1.3, §8.3 |
| BaseMdRevision | ベースmdの編集履歴（ロールバック用） | base_md_id, content, source(学習/手動編集/承認知見), created_at | M-1, K-3 |
| LearningSource | 学習ソース | x_account_id, kind(参考アカウント/参考投稿/自分の過去投稿), url, analyzed_at | L-1〜L-3 |
| AccountSettings | ペルソナ・テーマ・トンマナ・NG設定 | x_account_id, persona, themes[], tone, ng_words[], ng_topics[] | L-4〜L-7 |
| NewsItem | 運営側取得ニュース（全ユーザー共通） | category(AI/Web3/投資), summary, url, impact(高/中/低), fetched_at | N-1, N-2 |
| Post | 投稿・下書き（スレッド構造を保持） | x_account_id, pattern(P-1〜P-6), status(draft/scheduled/posted/failed), thread_items[], image_url, source(手動/スロット/ニュース), posted_at, idempotency_key | P-1〜P-7, S-5, S-6 |
| ScheduleSlot | 自動運用スロット | x_account_id, pattern, weekday, time, mode(下書きまで/自動投稿), instruction, image_enabled | S-1〜S-4 |
| PostMetrics | 投稿別実績 | post_id, impressions, likes, reposts, profile_clicks, fetched_at | K-1 |
| FollowerSnapshot | フォロワー数の日次記録 | x_account_id, date, count | K-4 |
| ImprovementSuggestion | 分析による改善提案（承認制） | x_account_id, content, evidence, status(提案/承認/却下), applied_revision_id | K-2, K-3 |
| PromptTemplate | 投稿パターン別・画像生成プロンプト（md/プレミアムで編集可） | x_account_id, kind(P-1〜P-7), content, is_customized | M-2, M-3 |
| UsageCounter | プレミアムプランの月間利用量 | user_id, month, posts_count, generations_count, images_count | O-4 |
| Notification | アプリ内通知 | user_id, kind(ニュース/下書き/投稿完了/エラー), body, read_at | O-2, N-3 |
| NotificationSetting | 通知ON/OFF設定 | user_id, kind, email_enabled, in_app_enabled | O-2 |

## リレーション概要

- User 1—n XAccount（上限: 通常1 / md 3 / プレミアム3）
- User 1—1 Subscription、User 1—n ApiKey、User 1—1 UsageCounter（月ごと）
- XAccount 1—1 BaseMd（1—n BaseMdRevision）、1—n LearningSource / ScheduleSlot / Post / FollowerSnapshot
- Post 1—1 PostMetrics
- 設定・ベースmd・下書き・分析はすべてXアカウント単位で分離する（A-6）

## 設計メモ

- 暗号化が必要なカラム: ApiKey.encrypted_key, XAccount.oauth_token / oauth_refresh_token（PRD §7）
- Post.idempotency_key で二重投稿を防止（PRD §7）
- NewsItem はユーザーに紐づかない（運営側共通データ、PRD §8.3）
