import type { Metadata } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";
import { CURRENT_TERMS_VERSION, consentVersionLabel } from "@/lib/legal";
import { LEGAL_ENTITY } from "@/lib/legal-entity";
import { PLANS } from "@/lib/plans";
import { LegalArticle, LegalDocument } from "@/components/legal-document";

export const metadata: Metadata = { title: `利用規約 | ${APP_NAME}` };

// nonceベースCSP（T-M6-17）のため動的レンダリング（静的prerenderはnonce付与不可）。
export const dynamic = "force-dynamic";

/**
 * 利用規約（本番運用版・T-M8-72）。
 *
 * 以前は6見出しの草案で、退会・準拠法・管轄・責任の範囲・BYOKの費用負担・利用上限・変更手続きが
 * 抜けていた。**実装と食い違う記載を置かない**ことを最優先に書いている:
 * - 「再同意を求めます」は `requireExecutionAccess` の配線（T-M8-73）が裏付け
 * - 「トライアルは初回のみ」は `checkout.ts` の `trialUsedAt === null` 条件が裏付け
 * - 退会は自分では行えず問い合わせ窓口経由であること（実装にセルフ削除が無い事実）を明記
 * 金額・上限は `PLANS` から描画する（画面へ数字を書き写さない）。
 */
export default function TermsPage() {
  const premium = PLANS.premium.usageLimits;
  return (
    <LegalDocument
      title="利用規約"
      versionLabel={consentVersionLabel(CURRENT_TERMS_VERSION)}
    >
      <p>
        本利用規約（以下「本規約」）は、{LEGAL_ENTITY.name}（以下「当方」）が提供する
        {APP_NAME}（以下「本サービス」）の利用条件を定めるものです。本サービスをご利用の方
        （以下「利用者」）は、本規約に同意したうえでご利用ください。
      </p>

      <LegalArticle n={1} title="本サービスの内容">
        <p>
          本サービスは、X（旧Twitter）向けの投稿の作成・投稿・実績確認を支援するWebアプリケーションです。
          具体的には、利用者が登録した発信方針（以下「発信定義書」）に基づく投稿文と画像の生成、
          指定した日時での投稿または下書きの作成、投稿実績の集計と改善提案の表示を行います。
        </p>
        <p>
          本サービスはXの運営会社とは関係のない独立したサービスです。生成される文章・画像は
          AIによる出力であり、内容の正確性・適法性・有用性を当方が保証するものではありません。
        </p>
      </LegalArticle>

      <LegalArticle n={2} title="アカウント登録">
        <p>
          利用者は、メールアドレスとパスワードを登録し、確認メールによる本人確認を完了することで
          アカウントを作成できます。登録情報は正確かつ最新の内容を維持してください。
        </p>
        <p>
          パスワードおよびアカウントの管理は利用者の責任で行ってください。アカウントを通じて
          行われた操作は、当該利用者による操作とみなします。
        </p>
      </LegalArticle>

      <LegalArticle n={3} title="利用者ご自身でご用意いただくもの・費用のご負担">
        <p>
          {PLANS.standard.displayName}および{PLANS.md.displayName}
          をご利用の場合、X APIおよび生成AIのAPIキーは利用者ご自身でご用意いただきます。
          この場合、<strong>本サービスの月額料金とは別に、X社および各AI事業者から利用者へ
          直接、従量課金による利用料が請求されます</strong>。その金額と支払条件は各事業者の
          定めによるものであり、当方は関与しません。
        </p>
        <p>
          {PLANS.premium.displayName}
          をご利用の場合、これらのAPIキーは当方が用意し、API利用料の追加負担はありません。
          ただし本条第3項の月間利用枠が適用されます。
        </p>
        <p>
          {PLANS.premium.displayName}の月間利用枠は、通常投稿{premium?.normalPosts}件、
          URL付き投稿{premium?.urlPosts}件、文章生成{premium?.generations}回、画像生成
          {premium?.images}枚です。利用枠は外部APIの原価や運用状況に応じて改定する場合があります。
          利用者に不利益となる変更を行う場合は、第14条の手続きにより事前に周知します。
        </p>
        <p>
          プランに応じて連携できるXアカウント数の上限（{PLANS.standard.displayName}は
          {PLANS.standard.xAccountLimit}件、{PLANS.md.displayName}および
          {PLANS.premium.displayName}は{PLANS.premium.xAccountLimit}件）が適用されます。
          また、アカウントの安全のため、プランを問わず1つのXアカウントにつき1日あたりの投稿数に
          上限を設けています。
        </p>
      </LegalArticle>

      <LegalArticle n={4} title="料金・無料トライアル・自動更新">
        <p>
          各プランの月額料金は税込表示で、
          {PLANS.standard.displayName} {PLANS.standard.monthlyPriceJpy.toLocaleString()}円、
          {PLANS.md.displayName} {PLANS.md.monthlyPriceJpy.toLocaleString()}円、
          {PLANS.premium.displayName} {PLANS.premium.monthlyPriceJpy.toLocaleString()}円です。
          お申し込みにはクレジットカードの登録が必要です。
        </p>
        <p>
          <strong>無料トライアルは、はじめてお申し込みいただく場合に限り7日間</strong>
          ご利用いただけます。無料期間中に解約された場合、料金は発生しません。無料期間が終了すると、
          選択されたプランの料金が発生し、以後は毎月の更新日に自動更新されます。
          過去に無料トライアルをご利用済みの場合、再度のお申し込みでは無料期間は付与されず、
          お申し込み時から課金が開始されます。
        </p>
        <p>
          料金を改定する場合は、第14条の手続きにより事前に周知します。改定に同意されない場合は、
          改定の効力発生日までに解約することができます。
        </p>
      </LegalArticle>

      <LegalArticle n={5} title="解約・返金">
        <p>
          解約は、本サービスの設定画面からお支払い管理画面（Stripeカスタマーポータル）へ進み、
          いつでもお手続きいただけます。解約の効力は<strong>お支払い済み期間の終了日</strong>
          に生じ、それまでは本サービスをご利用いただけます。
        </p>
        <p>
          サービスの性質上、お支払い済みの料金は返金いたしません（期間途中で解約された場合の
          日割り返金も行いません）。ただし、法令により返金が必要な場合はこれに従います。
        </p>
      </LegalArticle>

      <LegalArticle n={6} title="退会とデータの取扱い">
        <p>
          アカウントの削除をご希望の場合は、第16条のお問い合わせ窓口へご連絡ください
          （現在、画面上でご自身で削除する機能は提供していません）。ご本人確認のうえ、
          アカウントおよび関連データを削除します。
        </p>
        <p>
          削除の完了後、下書き・投稿履歴・実績・発信定義書などのデータは復元できません。
          なお、Xへ既に投稿された内容は、Xのアカウント上に残ります（本サービスの退会によって
          Xの投稿が削除されることはありません）。
        </p>
      </LegalArticle>

      <LegalArticle n={7} title="生成物の取扱いと投稿の責任">
        <p>
          本サービスがAIにより生成した文章・画像について、当方は利用者による利用を制限しません。
          一方で、<strong>生成物の内容の確認と、Xへ投稿する判断および投稿後の責任は、
          すべて利用者に帰属します</strong>。生成物には誤りや不適切な表現が含まれる可能性があるため、
          投稿前に必ず内容をご確認ください。
        </p>
        <p>
          生成物が第三者の権利を侵害しないことを当方は保証しません。利用者は、自らの責任で
          適法性を確認したうえで利用してください。
        </p>
      </LegalArticle>

      <LegalArticle n={8} title="自動投稿">
        <p>
          自動投稿（利用者が指定した日時に、投稿前の確認を経ずにXへ投稿する機能）は、
          <strong>対象・実行条件・停止方法を説明した画面で、利用者が明示的に同意した
          Xアカウントについてのみ</strong>実行されます。Xアカウントの連携（OAuth認可）だけでは
          自動投稿は行われません。
        </p>
        <p>
          自動投稿は、設定画面からいつでも停止できます。停止した時点で、実行待ちの自動投稿も
          中止されます。
        </p>
        <p>
          複数の投稿を連続して投稿する途中で失敗した場合、本サービスは既に投稿された分を
          自動的に削除します。<strong>削除された投稿はX上で復元できません</strong>。
        </p>
      </LegalArticle>

      <LegalArticle n={9} title="学習ソースの登録">
        <p>
          利用者は、文体や構成の参考として、Xアカウントや投稿のURLを登録できます。登録された
          投稿の内容は、分析のためAI事業者へ送信されます（本サービスは投稿本文を保存せず、
          分析結果のみを保存します）。
        </p>
        <p>
          第三者の投稿を参考として登録する場合、利用者は、その利用がXの規約および著作権法その他の
          法令に反しないことを自らの責任で確認してください。他人の投稿をそのまま複製して
          投稿する目的で本機能を利用することはできません。
        </p>
      </LegalArticle>

      <LegalArticle n={10} title="Xの規約の遵守">
        <p>
          本サービスの利用にあたっては、X社が定める利用規約・自動化ルール・開発者向け規約を
          遵守してください。これらに違反した結果としてXアカウントが凍結・制限された場合、
          当方は責任を負いません。
        </p>
      </LegalArticle>

      <LegalArticle n={11} title="禁止事項">
        <p>利用者は、本サービスの利用にあたり次の行為を行ってはなりません。</p>
        <ul>
          <li>法令または公序良俗に反する行為</li>
          <li>Xの規約・自動化ルールに違反する行為</li>
          <li>第三者の著作権、商標権、プライバシー、名誉その他の権利を侵害する行為</li>
          <li>虚偽の情報、誤解を招く情報、差別的または誹謗中傷にあたる内容の投稿</li>
          <li>スパム行為、または本サービスを用いた過度な自動投稿</li>
          <li>本サービスへの不正アクセス、リバースエンジニアリング、脆弱性の悪用</li>
          <li>本サービスの運営を妨げる行為、または他の利用者に不利益を与える行為</li>
          <li>アカウントまたはAPIキーを第三者に貸与・譲渡・共有する行為</li>
        </ul>
      </LegalArticle>

      <LegalArticle n={12} title="サービスの中断・変更・終了">
        <p>
          当方は、保守作業、外部サービスの障害、Xまたは各AI事業者の仕様変更・提供停止その他の
          やむを得ない事由により、本サービスの全部または一部を一時的に中断または変更する場合があります。
          緊急の場合を除き、事前に周知します。
        </p>
        <p>
          本サービスを終了する場合は、原則として1か月以上前に周知します。終了までの間に
          お支払いいただいた料金のうち、提供できない期間に対応する部分は返金します。
        </p>
      </LegalArticle>

      <LegalArticle n={13} title="利用停止・契約の解除">
        <p>
          利用者が本規約に違反した場合、または料金のお支払いが確認できない場合、当方は本サービスの
          利用を停止し、または契約を解除することがあります。緊急を要する場合を除き、事前に
          是正の機会を設けます。
        </p>
      </LegalArticle>

      <LegalArticle n={14} title="本規約の変更">
        <p>
          当方は、法令の変更やサービス内容の変更に応じて本規約を変更することがあります。変更する場合は、
          変更後の内容と効力発生日を本サービス上またはメールにより周知します。
        </p>
        <p>
          利用者に重要な影響を与える変更の場合、<strong>効力発生後に生成・投稿・自動実行を行う前に、
          変更後の内容への同意を改めてお願いします</strong>。同意されない場合、これらの機能は
          ご利用いただけませんが、既存の下書き・投稿履歴の閲覧および解約手続きは可能です。
        </p>
      </LegalArticle>

      <LegalArticle n={15} title="免責と責任の範囲">
        <p>
          当方は、本サービスが利用者の特定の目的に適合すること、期待する効果（フォロワーの増加や
          売上の向上など）が得られること、および中断なく利用できることを保証しません。
        </p>
        <p>
          当方の故意または重大な過失による場合を除き、当方が利用者に対して負う損害賠償の責任は、
          <strong>損害発生時点からさかのぼって12か月の間に利用者が当方へお支払いになった
          本サービスの利用料金の総額</strong>を上限とし、通常生じうる直接の損害に限られます。
        </p>
        <p>
          本条の定めは、消費者契約法その他の法令により当方の責任を免れることができない場合には、
          その限度において適用されません。
        </p>
      </LegalArticle>

      <LegalArticle n={16} title="お問い合わせ・準拠法・管轄">
        <p>
          本規約および本サービスに関するお問い合わせは、{LEGAL_ENTITY.email} までご連絡ください。
          個人情報の取扱いについては
          <Link className="mx-1 font-medium underline underline-offset-4" href="/privacy">
            プライバシーポリシー
          </Link>
          をご確認ください。
        </p>
        <p>
          本規約は日本法に準拠します。本サービスに関して紛争が生じた場合、まず誠実な協議による
          解決を図ります。協議による解決に至らない場合、法令に定める裁判所を管轄裁判所とします。
        </p>
      </LegalArticle>

      <p className="pt-2">
        <Link className="font-medium underline underline-offset-4" href="/legal/commercial-transactions">
          特定商取引法に基づく表記
        </Link>
        もあわせてご確認ください。
      </p>
    </LegalDocument>
  );
}
