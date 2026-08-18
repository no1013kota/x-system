# ADR運用

ADR（Architecture Decision Record）は、PRDや要件詳細へ直接書くと経緯が失われる重要な技術判断を記録する。

## 作成対象

- 技術スタック、外部service、認証方式、queue方式、暗号化方式の採用・変更
- 複数案から選び、将来の変更costが大きい判断
- 既存ADRを置き換える判断

画面文言、単純なschema追加、prompt調整は該当する正本文書だけを更新し、ADRを作らない。

## ファイル名

`NNNN-short-title.md`。番号は4桁連番、titleは英小文字kebab-caseとする。

## テンプレート

```markdown
# ADR-NNNN: 判断名

- Status: Proposed | Accepted | Superseded
- Date: YYYY-MM-DD
- Supersedes: ADR-NNNN（該当時）

## Context

判断が必要になった背景と制約。

## Decision

採用する案と適用範囲。

## Consequences

得られる利点、受け入れる欠点、移行・運用上の注意。

## Alternatives

比較した案と不採用理由。
```

Acceptedになった仕様は、同じ作業単位で要件詳細へ反映する。過去ADRは削除・上書きせず、置換時は新ADRから`Supersedes`で参照する。

## ADR一覧

| ADR | Status | 内容 |
|---|---|---|
| [ADR-0001](./0001-initial-infrastructure-plan.md) | Accepted（一部ADR-0002で置換） | 初期launchdからVercel Cronへの移行、Vercel Pro + Supabase Free、Supabase Proへの移行条件を定義 |
| [ADR-0002](./0002-job-dispatch-fanout.md) | Accepted | ジョブ実行を「1 job = 1 Function呼び出し」のdispatch fan-outへ変更。scheduler_tickを5分間隔化、Function上限200秒（H-1/H-2レビュー対応） |
| [ADR-0003](./0003-cron-window-claim.md) | Accepted | 定時トリガーの時間窓重複受付防止を、transaction modeプーラで保持できないセッションadvisory lockから`cron_runs` window claim（dedup marker）へ変更。完了状態は持たず実行保証（トリガー=at-most-once／ジョブ=at-least-once相当）を明記（review-m0-12-to-20対応） |
| [ADR-0004](./0004-image-processing-sharp.md) | Accepted | 画像正規化（デコード・形式/実寸/MIME/容量検証・JPG/PNG/WEBP・5MB以下への変換/圧縮）に`sharp`を採用。Next.js同梱のため追加binary取得不要、直接依存へ昇格（T-M3-14対応） |
| [ADR-0005](./0005-csp-nonce-strategy.md) | Accepted | nonceベースCSPをproxyで実装（script-srcはnonce＋strict-dynamic）。Turnstile・外部画像(https:)・Sentryを許可し、公開コンテンツページ（LP・法務）はnonce付与のためforce-dynamic化。HSTS/nosniff/Referrer-Policyをprod付与（T-M6-17対応） |
| [ADR-0006](./0006-ui-design-foundation.md) | Accepted | UIデザイン基盤。トークンを`globals.css`のCSS変数へ一元化しshadcn由来のトークンも新デザインへ向ける、フォントは`next/font/google`で自前配信（日本語は`subsets`を指定しない）、アイコンは可変フォント3.8MBを避け41個をインラインSVG化、器/チップ/空状態/パターン選択などを単一の正へ集約（M8対応） |
| [ADR-0007](./0007-type-scale-and-target-sizes.md) | Accepted | タイプスケールとタップ対象寸法の規約。本文系フォントは3段（caption 12/body 13/sm 14px）に統一しguardテストで固定、ink-3のコントラストをWCAG AAへ、ボタン高の基準（sm32/default36/lg40px・主要CTA44px）、入力欄のiOSズーム対策はグローバルCSS1本（T-M8-70/71） |
| [ADR-0008](./0008-user-defined-post-patterns.md) | Accepted | 投稿パターンを利用者定義にする。enum `post_pattern` からアカウント別マスタ `post_patterns` へ移し、既定6件もトリガで自動投入・削除可能にする。論理削除は持たず `before delete` で参照を外し履歴はsnapshotで自立させる、既定プロンプトは`null`で表す、`p5`の予約不可は`requires_quote_url`属性へ、テナント越え参照は複合FKで塞ぐ。U1〜U5の5単位で移行（T-M8-129） |
