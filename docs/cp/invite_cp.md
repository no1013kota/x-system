# 招待プログラム 実装仕様書

## 1. 概要

App内に招待プログラム専用ページを1ページ作成する。

```text
/app/invite
```

ユーザーはこのページだけで、

* 招待リンクの共有
* 招待実績確認
* 現在の報酬率確認
* 次ランクまでの進捗確認
* 発生報酬確認
* 振込予定確認
* 銀行口座登録・変更

まで完結できるようにする。

---

# 2. UI / UX

## ページ構成

### ① Hero / Invite Card

ページ最上部。

```text
友達を招待して報酬を受け取る

あなたの招待リンク
example.com/r/abc123

[リンクをコピー]  [Xでシェア]
```

右側または下部に現在のランクを表示。

```text
現在の報酬率

35%

あと3人の有料ユーザー招待で
報酬率 40% にアップ

████████░░  8 / 11人
```

「招待すればするほど報酬率が上がる」ことを最も強く見せる。

---

## ② KPI Cards

4枚程度に絞る。

```text
有料招待
8人

現在の報酬率
35%

確定前報酬
¥4,482

受取可能
¥12,400
```

クリック数などは主要KPIから外し、詳細情報として下部に表示する。

---

## ③ 次回振込カード

金銭周りを明確に表示する。

```text
次回のお振込み

振込対象額
¥12,400

振込手数料
- ¥980

振込予定額
¥11,420

支払期限
2026年9月30日まで
```

銀行口座未登録の場合：

```text
報酬を受け取るには
銀行口座を登録してください。

[銀行口座を登録]
```

を強調表示する。

---

## ④ 招待ランク

横並びまたはStepper形式。

```text
30%
1〜5人

35%
6〜10人
現在

40%
11〜25人

45%
26〜50人

50%
51人〜
```

現在ランクをAccent Colorで強調する。

---

## ⑤ 招待ユーザー

```text
招待ユーザー
```

| ユーザー           | ステータス | 課金開始 |   累計報酬 |
| -------------- | ----- | ---- | -----: |
| y***@gmail.com | 有料    | 8/10 | ¥2,988 |
| t***@gmail.com | Trial | -    |     ¥0 |
| a***@gmail.com | 解約済み  | 7/01 | ¥1,494 |

ステータス：

```text
Free
Trial
有料
解約済み
```

個人情報はマスクする。

---

## ⑥ 報酬履歴

```text
報酬履歴
```

| 日付   | 内容         | 状態   |      金額 |
| ---- | ---------- | ---- | ------: |
| 8/20 | Proプラン紹介報酬 | 確定待ち | +¥1,494 |
| 8/01 | Proプラン紹介報酬 | 受取可能 | +¥1,494 |
| 7/25 | 返金調整       | 調整   |   -¥600 |

---

## UI方針

デザインは既存AppのDesign Systemを最優先する。

以下を守ること。

* 情報量を詰め込みすぎない
* 最重要情報は「報酬率」「受取可能額」「次回振込」
* Cardベースのシンプルなレイアウト
* Desktop / Mobile完全対応
* 金額は視認性を高くする
* StatusはBadge表示
* Empty Stateを丁寧に実装
* Loading Skeletonを実装
* コピー完了時はToastを表示
* Rank Up直前のProgressを視覚的に強調
* 銀行口座番号は末尾4桁以外表示しない

---

# 3. 招待報酬率

**累計有料招待ユーザー数**によって報酬率を決定する。

| 有料招待人数 | 報酬率 |
| -----: | --: |
|   1〜5人 | 30% |
|  6〜10人 | 35% |
| 11〜25人 | 40% |
| 26〜50人 | 45% |
|  51人以上 | 50% |

Signup数ではなく、

```text
Paid Referral Count
```

を利用する。

Config管理すること。

```ts
const INVITE_TIERS = [
  { minPaidUsers: 1, rateBps: 3000 },
  { minPaidUsers: 5, rateBps: 3500 },
  { minPaidUsers: 10, rateBps: 4000 },
  { minPaidUsers: 25, rateBps: 4500 },
  { minPaidUsers: 50, rateBps: 5000 },
];
```

Commission発生時点のRateをSnapshot保存する。

---

# 4. 招待リンク

ユーザーごとに一意のURLを発行。

```text
https://example.com/r/abc123
```

フロー：

```text
招待リンククリック
↓
30日間Cookie
↓
新規登録
↓
招待者へ紐付け
↓
有料化
↓
報酬開始
```

ルール：

* Last Click Attribution
* 1ユーザーにつき招待者は1人
* Signup後は変更不可
* 自己招待禁止

---

# 5. 報酬期間

報酬期間は、

```text
初回有料課金から最大6か月
```

とする。

例えば：

```text
初回課金
2026/8/15

↓

最大報酬期間
2027/2/14まで
```

ただし紹介ユーザーが途中解約した場合、

```text
解約時点で報酬期間終了

> **実装の補足（T-M8-236）**: 「解約で終了」は**初回課金後**の話。一度も課金していない
> （`commission_started_at` が null）解約では終了しない——Trial中の離脱で報酬機会が永久に消えるのを避ける。
> また**解約日より前の支払い**は、解約イベントが先に届いても報酬になる（Stripeは配送順を保証せず最大3日リトライする）。
```

とする。

例：

```text
8月 有料化
9月 継続
10月 解約

↓

8月・9月の対象売上のみ報酬対象
```

一度解約した紹介ユーザーが後から再契約しても、

```text
Affiliate Commissionは再開しない
```

仕様とする。

---

# 6. 報酬発生

Stripeの支払成功をSource of Truthとする。

```text
invoice.paid
↓
招待ユーザー確認
↓
報酬対象期間確認
↓
現在のAffiliate Rate確認
↓
Commission作成
```

例えば：

```text
月額料金
¥4,980

報酬率
35%

報酬
¥1,743
```

実際に支払われた金額に対して計算する。

Trial中は報酬なし。

Refundされた場合は該当報酬を取消・減額する。

---

# 7. 解約処理

Stripe側で紹介ユーザーのSubscription終了を検知した場合、

```text
affiliate_attribution.commission_ends_at
```

をSubscription終了日時へ変更する。

さらに：

```text
commission_terminated_reason = "subscription_cancelled"
```

を保存する。

以後、その紹介ユーザーについてCommissionを生成しない。

---

# 8. 報酬確定

課金直後：

```text
pending
```

返金等の確認期間経過後：

```text
payable
```

Refund：

```text
reversed
```

Commission Status：

```text
pending
payable
paid
reversed
held
```

---

# 9. 支払サイクル

報酬は、

```text
月末締め
翌月末までに支払い
```

とする。

例：

```text
8月1日〜8月31日に
受取可能となった報酬

↓

8月31日締め

↓

9月30日までに銀行振込
```

月次Payout Batchを作成する。

---

# 10. 振込手数料

**1回の振込につき980円**の振込手数料をユーザー負担とする。

例：

```text
受取可能報酬
¥12,400

振込手数料
- ¥980

実際の振込額
¥11,420
```

Payout DBには必ず分離して保存する。

```text
gross_amount = 12400
fee_amount = 980
net_amount = 11420
```

手数料をCommission自体から直接減額しない。

Commission：

```text
¥12,400
```

Payout：

```text
Gross     ¥12,400
Fee         -¥980
Net       ¥11,420
```

として会計記録を分離する。

---

# 11. 最低振込額

最低支払対象額：

```text
¥5,000
```

判定は手数料控除前の受取可能報酬で行う。

```text
Payable Balance >= ¥5,000
```

の場合のみ振込対象。

¥5,000未満の場合は翌月へ繰越。

---

# 12. 銀行口座

Dashboard内から：

```text
[銀行口座を登録]
```

を実行できるようにする。

表示：

```text
報酬受取口座

三井住友銀行
渋谷支店
普通 ****1234

[変更]
```

銀行口座の機密情報は可能な限り外部Payout Providerで管理する。

> **実装（2026-08-21〜。要決定D-33）**: Payout Provider は未契約のため、**口座番号はAES-256-GCM
> （APIキーと同じ鍵運用）で暗号化して自社DBに保持する**（`provider='internal'`）。振込は運営者が
> 手作業で行うため全桁が必要で、画面に出すのは**末尾4桁だけ**。全桁は
> `npm run affiliate:payouts -- --show` でのみ復号する。Provider契約時に置き換える。

自社DBでは最低限：

```text
provider
external_account_id
bank_name
branch_name
bank_account_last4
account_holder_name
status
```

のみ保持する。

---

# 13. 必要DB

```text
affiliate_accounts
```

```text
id
user_id
code
status
created_at
```

---

```text
affiliate_attributions
```

```text
id
affiliate_account_id
referred_user_id UNIQUE

attributed_at

commission_started_at
commission_ends_at

commission_terminated_reason

created_at
updated_at
```

---

```text
affiliate_commissions
```

```text
id
affiliate_account_id
referred_user_id

stripe_invoice_id UNIQUE

eligible_amount
commission_rate_bps
commission_amount

status
available_at

created_at
```

---

```text
affiliate_payout_accounts
```

```text
id
affiliate_account_id

provider
external_account_id

bank_name
branch_name
bank_account_last4
account_holder_name

status

created_at
updated_at
```

---

```text
affiliate_payouts
```

```text
id
affiliate_account_id

period_start
period_end

gross_amount
fee_amount
net_amount

status

payment_due_at
paid_at

external_reference

created_at
updated_at
```

---

# 14. Payout作成

月末締め処理：

```text
その月にpayableになったCommissionを取得

↓

Affiliateごとに集計

↓

¥5,000以上か確認

↓

銀行口座登録確認

↓

Payout作成
```

計算：

```ts
const PAYOUT_FEE = 980;

grossAmount = payableCommissionTotal;
feeAmount = PAYOUT_FEE;
netAmount = grossAmount - feeAmount;
```

---

# 15. Dashboard表示例

最終的な画面イメージ：

```text
┌──────────────────────────────────────┐
│ 友達を招待して報酬を受け取る              │
│                                      │
│ example.com/r/abc123                 │
│ [コピー] [Xでシェア]                    │
│                                      │
│ 現在 35%   ████████░░   あと2人 → 40% │
└──────────────────────────────────────┘

┌────────┐ ┌────────┐ ┌────────┐
│有料招待 │ │確定前報酬│ │受取可能  │
│  8人   │ │ ¥4,482 │ │¥12,400 │
└────────┘ └────────┘ └────────┘

┌──────────────────────────────────────┐
│ 次回のお振込み                          │
│                                      │
│ 報酬            ¥12,400               │
│ 振込手数料        -¥980                │
│ ─────────────────                    │
│ 振込予定         ¥11,420               │
│                                      │
│ 9月30日までにお振込み                    │
│                                      │
│ 振込先：三井住友銀行 ****1234            │
│                              [変更]  │
└──────────────────────────────────────┘

招待ランク
30% ── 35% ── 40% ── 45% ── 50%
          ↑
        現在

招待ユーザー
──────────────────────────────────────
y***@gmail.com   有料       ¥2,988
t***@gmail.com   Trial      ¥0
a***@gmail.com   解約済み    ¥1,494

報酬履歴
──────────────────────────────────────
8/20  紹介報酬       確定待ち    +¥1,494
8/01  紹介報酬       受取可能    +¥1,494
7/25  返金調整       調整        -¥600
```

---

# 16. Claudeへの実装指示

既存Repositoryを確認してから実装すること。

既存の：

```text
Design System
Dashboard Layout
Authentication
Database / ORM
Stripe Billing
API structure
```

を必ず優先する。

実装対象：

```text
1. DB Migration

2. /app/invite

3. 高品質なResponsive UI

4. 招待URL / Attribution

5. Paid ReferralによるTier判定

6. 最大6か月Commission

7. 解約時Commission永久終了

8. Stripe invoice.paid連携

9. Refund処理

10. 銀行口座登録

11. 月末締めPayout

12. ¥980振込手数料

13. 翌月末支払期限

14. Automated Tests
```

重要：

```text
・Dashboardは1ページに集約

・報酬率は累計Paid Referral数で決定

・報酬期間は初回課金から最大6か月

・紹介ユーザーの解約で報酬期間終了

・解約後の再契約では報酬を再開しない

・月末締め翌月末までに支払う

・振込1回につき¥980を控除

・Commissionと振込手数料は会計上分離

・Moneyはinteger

・Stripe WebhookはIdempotent

・銀行口座情報は安全に扱う
```
