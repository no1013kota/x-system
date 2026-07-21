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
