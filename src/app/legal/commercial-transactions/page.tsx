import type { Metadata } from "next";

import { APP_NAME } from "@/lib/app-config";
import { LEGAL_ENTITY } from "@/lib/legal-entity";
import { PLANS } from "@/lib/plans";
import { LegalDefinitions, LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = {
  title: `特定商取引法に基づく表記 | ${APP_NAME}`,
};

// 動的レンダリングの指定は `app/layout.tsx` へ移した（T-M8-87）。

/**
 * 特定商取引法11条（通信販売の広告表示）に基づく表記（本番運用版・T-M8-72）。
 *
 * 追加した項目（草案では欠けていた法定事項）:
 * - **商品代金以外に必要な費用**: BYOKプランでは利用者がX APIと生成AI APIの従量課金を
 *   直接負担する。法11条の「その他負担すべき金銭」に当たるため必須。
 * - **販売条件（数量の制限）**: 連携できるXアカウント数とプレミアムの月間利用枠。
 * - **申込みの有効期限**、**返品特約**（デジタルサービスのため返品不可である旨の明示）。
 * 金額・上限は `PLANS` から描画する（画面へ数字を書き写さない）。
 */
export default function CommercialTransactionsPage() {
  const premium = PLANS.premium.usageLimits;
  const priceLine = [PLANS.standard, PLANS.md, PLANS.premium]
    .map((plan) => `${plan.displayName} ${plan.monthlyPriceJpy.toLocaleString()}円`)
    .join("／");

  const items = [
    { term: "屋号", description: LEGAL_ENTITY.tradeName },
    // 個人事業者は屋号だけでは足りず、氏名の表示が要る（法11条「販売業者の氏名（名称）」）。
    { term: "販売事業者", description: LEGAL_ENTITY.name },
    { term: "運営責任者", description: LEGAL_ENTITY.representative },
    { term: "所在地", description: LEGAL_ENTITY.address },
    { term: "お問い合わせ先", description: `${LEGAL_ENTITY.email}（メールで受け付けます）` },
    { term: "電話番号", description: LEGAL_ENTITY.phoneDisclosure },
    {
      term: "販売価格",
      description: `${priceLine}（いずれも税込の月額料金です）`,
    },
    {
      term: "商品代金以外に必要な費用",
      description:
        `${PLANS.standard.displayName}および${PLANS.md.displayName}をご利用の場合、X APIおよび生成AIのAPIキーはお客様ご自身でご用意いただくため、` +
        `月額料金とは別に、X社および各AI事業者からお客様へ直接、従量課金による利用料が請求されます（金額はご利用量により変動し、当方は関与しません）。` +
        `${PLANS.premium.displayName}では、これらのAPI利用料の追加負担はありません。インターネット接続に必要な通信料はお客様のご負担となります。`,
    },
    {
      term: "支払方法",
      description: "クレジットカード決済（Stripeの決済画面をご利用いただきます）",
    },
    {
      term: "支払時期",
      description:
        "無料トライアルをご利用の場合は7日間の無料期間の終了時に初回のお支払いが発生し、以後は毎月の更新日に決済します。無料トライアルの対象外の場合は、お申し込み時から課金が開始されます。",
    },
    {
      term: "無料トライアル",
      description:
        "はじめてお申し込みいただく場合に限り7日間。開始にはクレジットカードの登録が必要です。無料期間中に解約された場合、料金は発生しません。",
    },
    { term: "自動更新", description: "無料期間の終了後、選択されたプランを月単位で自動更新します。" },
    {
      term: "サービスの提供時期",
      description:
        "お申し込みの完了後、ご契約の反映を確認でき次第、直ちにご利用いただけます（通常は数十秒以内です）。",
    },
    {
      term: "販売条件（ご利用の制限）",
      description:
        `連携できるXアカウント数は、${PLANS.standard.displayName}は${PLANS.standard.xAccountLimit}件、${PLANS.md.displayName}および${PLANS.premium.displayName}は${PLANS.premium.xAccountLimit}件です。` +
        (premium
          ? `${PLANS.premium.displayName}には月間の利用枠（通常投稿クレジット${premium.normalPosts}・URL付き投稿クレジット${premium.urlPosts}・AIクレジット${premium.aiCredits}〔AIの実行はモデルと内容に応じた量を消費〕）があります。`
          : "") +
        "また、アカウントの安全のため、プランを問わず1つのXアカウントにつき1日あたりの投稿数に上限を設けています。",
    },
    {
      term: "お申し込みの有効期限",
      description:
        "決済画面での手続きを完了されるまでの間、有効期限はありません。決済画面は一定時間を経過すると無効になりますので、その場合は再度お申し込みください。",
    },
    {
      term: "解約の方法",
      description:
        "本サービスの設定画面からお支払い管理画面へ進み、いつでもお手続きいただけます。解約の効力はお支払い済み期間の終了日に生じ、それまではご利用いただけます。",
    },
    {
      term: "返品・キャンセルについて（返品特約）",
      description:
        "デジタルサービスの提供という性質上、お支払い済みの料金の返金および期間途中で解約された場合の日割り返金は行いません。法令により返金が必要な場合はこれに従います。なお、本サービスは通信販売にあたり、クーリング・オフ制度の適用はありません。",
    },
    {
      term: "動作環境",
      description:
        "最新版のモダンブラウザ（Google Chrome・Safari・Microsoft Edge等）とインターネット接続が必要です。JavaScriptとCookieを有効にしてご利用ください。",
    },
  ];

  return (
    <LegalDocument title="特定商取引法に基づく表記" updatedLabel="最終更新: 2026年8月8日">
      <p>
        特定商取引法第11条（通信販売についての広告）に基づき、次のとおり表示します。
      </p>
      <LegalDefinitions items={items} />
    </LegalDocument>
  );
}
