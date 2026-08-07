import type { Metadata } from "next";

import { APP_NAME } from "@/lib/app-config";
import { CURRENT_PRIVACY_VERSION, consentVersionLabel } from "@/lib/legal";
import {
  BROWSER_TRANSMISSIONS,
  COOKIES,
  LEGAL_ENTITY,
  PROCESSORS,
} from "@/lib/legal-entity";
import { PLANS } from "@/lib/plans";
import {
  LegalArticle,
  LegalDefinitions,
  LegalDocument,
  LegalTable,
} from "@/components/legal-document";

export const metadata: Metadata = {
  title: `プライバシーポリシー | ${APP_NAME}`,
};

// nonceベースCSP（T-M6-17）のため動的レンダリング（静的prerenderはnonce付与不可）。
export const dynamic = "force-dynamic";

/**
 * プライバシーポリシー（本番運用版・T-M8-72）。
 *
 * 以前は4見出し・各1文の草案で、取得項目・委託先の具体名・外国にある第三者への提供・Cookie・
 * 保持期間・開示等の請求手続がすべて欠けていた。ここでは**実装から確認できた事実だけ**を書く:
 * - 取得項目はDBスキーマ、Cookieは各cookie設定箇所、委託先は環境変数とアダプタ、
 *   ブラウザからの外部送信はCSPの許可先が根拠（`legal-entity.ts` に集約）
 * - 保持期間は `scheduler_tick` の cleanup 実装（40日／画像24時間／その余は削除まで保持）
 * - 生成AIへの送信は、運営キー（プレミアム）と利用者自身のキー（BYOK）で送信主体が変わるため書き分ける
 */
const COLLECTED = [
  {
    term: "アカウント情報",
    description:
      "メールアドレス、パスワード（当方では内容を復元できない形で会員認証基盤が保管します）、登録日時、利用規約とプライバシーポリシーへの同意日時と版。",
  },
  {
    term: "契約・課金情報",
    description:
      "ご契約のプラン、契約状態、次回更新日、無料トライアルの利用有無、決済事業者が発行する顧客ID。クレジットカード番号等は当方では取得・保管しません。",
  },
  {
    term: "連携したXアカウントの情報",
    description:
      "アカウントID、ユーザー名（@から始まる識別子）、表示名、プロフィール画像のURL、連携の権限範囲。連携に使うアクセストークンは暗号化して保管します。",
  },
  {
    term: "設定・発信定義書",
    description:
      "ペルソナ、発信テーマ、トーン＆マナー、NG設定、これらから生成される発信定義書とその変更履歴、通知設定、ニュースの表示条件。",
  },
  {
    term: "APIキー（ご自身でご用意いただく場合）",
    description:
      "X APIおよび生成AIのAPIキー。暗号化して保管し、画面上は末尾4桁のみ表示します。いつでも削除できます。",
  },
  {
    term: "投稿に関する情報",
    description:
      "投稿の下書きと本文、生成に用いた入力内容（参考URL・ご自身の考え・追加指示）、生成画像、投稿日時、投稿の成否と失敗理由、Xから取得した投稿実績（表示回数・いいね・リポスト・プロフィール表示）とフォロワー数。",
  },
  {
    term: "学習ソースの情報",
    description:
      "参考として登録されたXアカウントのユーザー名と投稿のURL、およびAIによる分析結果。参考投稿の本文自体は保存しません。",
  },
  {
    term: "利用状況・技術情報",
    description:
      "機能の実行履歴（生成・投稿・自動実行の記録）、外部APIの利用量、エラー発生時の技術情報、アクセス時の通信情報（IPアドレス、ブラウザの種類）。",
  },
];

const PURPOSES = [
  "本サービスの提供、機能の実行、および利用者の認証",
  "投稿文・画像の生成と、Xへの投稿の実行",
  "投稿実績の集計と改善提案の作成",
  "ご契約の管理、料金の請求、利用枠の管理",
  "通知メールおよびアプリ内通知の送信",
  "不具合の検知と原因調査、セキュリティの確保、不正利用の防止",
  "お問い合わせへの対応",
  "法令または行政機関の要請に基づく対応",
];

const RETENTION = [
  {
    term: "アカウント・設定・発信定義書",
    description:
      "アカウントを削除するまで保持します。削除のご依頼をいただいた場合は、ご本人確認のうえ削除します。",
  },
  {
    term: "下書き・投稿履歴・投稿実績",
    description:
      "アカウントを削除するまで保持します（過去の投稿実績を継続して確認できるようにするため）。",
  },
  {
    term: "ニュースと関連通知",
    description: "取得または作成から40日を経過したものを自動的に削除します。",
  },
  {
    term: "外部APIの利用量の明細",
    description: "40日を経過した明細を自動的に削除します（月次の集計値は保持します）。",
  },
  {
    term: "投稿に使われなかった生成画像",
    description: "生成から24時間を経過したものを自動的に削除します。",
  },
  {
    term: "APIキー・連携トークン",
    description:
      "利用者が削除するか、連携を解除するまで暗号化した状態で保持します。連携解除時はXへの権限の取り消しも行います。",
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="プライバシーポリシー"
      versionLabel={consentVersionLabel(CURRENT_PRIVACY_VERSION)}
    >
      <p>
        {LEGAL_ENTITY.name}（以下「当方」）は、{APP_NAME}
        （以下「本サービス」）における個人情報の取扱いについて、次のとおり定めます。
      </p>

      <LegalArticle n={1} title="事業者の情報">
        <LegalDefinitions
          items={[
            { term: "個人情報取扱事業者", description: LEGAL_ENTITY.name },
            { term: "所在地", description: LEGAL_ENTITY.address },
            { term: "個人情報の管理責任者", description: LEGAL_ENTITY.representative },
            { term: "お問い合わせ窓口", description: LEGAL_ENTITY.email },
          ]}
        />
      </LegalArticle>

      <LegalArticle n={2} title="取得する情報">
        <p>本サービスでは、次の情報を取得します。</p>
        <LegalDefinitions items={COLLECTED} />
        <p>
          本サービスは18歳未満の方の利用を想定していません。また、思想信条や病歴などの
          要配慮個人情報を取得することはありません。
        </p>
      </LegalArticle>

      <LegalArticle n={3} title="利用目的">
        <p>取得した情報は、次の目的で利用します。</p>
        <ul>
          {PURPOSES.map((purpose) => (
            <li key={purpose}>{purpose}</li>
          ))}
        </ul>
        <p>
          <strong>
            投稿内容や発信定義書をAIの学習用データとして当方が利用することはありません。
          </strong>
          機能の提供のためにAI事業者へ送信する場合の扱いは第5条に定めます。
        </p>
      </LegalArticle>

      <LegalArticle n={4} title="第三者への提供">
        <p>
          当方は、法令に基づく場合、および利用者の同意がある場合を除き、個人情報を第三者へ
          提供しません。本サービスは、行動ターゲティング広告およびアクセス解析ツールを
          利用していません。
        </p>
        <p>
          Xへの投稿は、利用者の指示または利用者が同意した自動投稿の設定に基づいて実行されます。
          投稿された内容はXの公開範囲の設定に従って公開され、その後の取扱いはX社の
          プライバシーポリシーに従います。
        </p>
      </LegalArticle>

      <LegalArticle n={5} title="業務の委託と外部サービスの利用">
        <p>
          本サービスの提供のため、次の事業者へ業務を委託し、必要な範囲で情報を取り扱わせています。
          いずれも当方との契約または各事業者の利用規約に基づき、目的外の利用を行わないことを
          前提としています。
        </p>
        <LegalTable
          headers={["委託先", "所在国", "利用目的", "取り扱う情報"]}
          rows={PROCESSORS.map((p) => [
            `${p.provider}（${p.service}）`,
            p.country,
            p.use,
            p.data,
          ])}
        />
        <p>
          {PLANS.premium.displayName}では、生成AIへの送信は当方が用意したAPIキーにより行われます。
          {PLANS.standard.displayName}および{PLANS.md.displayName}
          では、<strong>利用者ご自身が登録したAPIキーにより、利用者と各AI事業者との契約に基づいて
          送信されます</strong>。この場合、送信された情報の取扱いは各AI事業者と利用者の間の
          規約によります。
        </p>
        <p>
          AI事業者へ送信する際は、会話の履歴を事業者側に保存させない設定（該当する提供者の場合）
          を用いています。また、不具合検知サービスへ送信する情報からは、APIキー・トークン・
          プロンプト・投稿前の入力内容を送信前に除去しています。
        </p>
      </LegalArticle>

      <LegalArticle n={6} title="外国にある第三者への提供">
        <p>
          第5条の委託先はいずれも日本国外（米国）に所在する事業者であり、個人データが日本国外で
          取り扱われる場合があります。利用者は、会員登録時に本ポリシーを確認することにより、
          これらの事業者への提供に同意するものとします。
        </p>
        <p>
          移転先の国名は第5条の表に記載しています。当該国における個人情報の保護に関する制度、および
          各事業者が講じている保護措置については、各事業者が公表するプライバシーポリシーおよび
          セキュリティに関する情報をご確認いただけます。これらの情報について詳細をお求めの場合は、
          第9条の窓口へご連絡ください。個別の事業者ごとに、当方が把握している範囲の情報を
          ご提供します。
        </p>
      </LegalArticle>

      <LegalArticle n={7} title="Cookieと外部送信">
        <p>
          本サービスは、ログイン状態の保持や手続きの安全確保のためCookieを使用します。広告目的の
          Cookieは使用していません。
        </p>
        <LegalTable
          headers={["Cookie", "用途", "保存期間"]}
          rows={COOKIES.map((c) => [c.name, c.use, c.lifetime])}
        />
        <p>
          また、次の場合に、利用者のブラウザから外部の事業者へ直接情報が送信されます。
        </p>
        <LegalTable
          headers={["送信先", "送信されるとき", "送信される情報"]}
          rows={BROWSER_TRANSMISSIONS.map((t) => [t.to, t.when, t.data])}
        />
        <p>
          Cookieはブラウザの設定で削除・拒否できますが、認証用のCookieを拒否した場合は
          ログインできません。
        </p>
      </LegalArticle>

      <LegalArticle n={8} title="保存期間と安全管理">
        <p>取得した情報は、次の期間保持したうえで削除します。</p>
        <LegalDefinitions items={RETENTION} />
        <p>
          安全管理のため、通信の暗号化、アクセス権限の管理、データベースの行単位のアクセス制御を
          行っています。APIキーとXの連携トークンは、暗号化した状態で保管し、画面上は末尾4桁のみを
          表示します。
        </p>
      </LegalArticle>

      <LegalArticle n={9} title="開示・訂正・削除等のご請求">
        <p>
          利用者は、当方が保有する自身の個人データについて、利用目的の通知、開示、内容の訂正・追加・
          削除、利用の停止・消去、第三者提供の停止を請求できます。
        </p>
        <p>
          ご請求は {LEGAL_ENTITY.email} 宛に、登録済みのメールアドレスからご連絡ください。
          ご本人であることを確認したうえで、原則として2週間以内に回答します。
          手数料はいただきません。なお、法令により応じられない場合は、その理由をお伝えします。
        </p>
        <p>
          設定画面からご自身で変更できる項目（発信設定、通知設定、APIキー、Xアカウントの連携）は、
          お手続きをお待ちいただかずにいつでも変更・削除いただけます。
        </p>
      </LegalArticle>

      <LegalArticle n={10} title="苦情の申出先">
        <p>
          個人情報の取扱いに関するご意見・苦情は {LEGAL_ENTITY.email} で受け付けます。
          このほか、個人情報保護委員会へ申し出ることもできます。
        </p>
      </LegalArticle>

      <LegalArticle n={11} title="本ポリシーの変更">
        <p>
          法令の変更や本サービスの内容の変更に応じて、本ポリシーを変更することがあります。変更する場合は、
          変更後の内容と効力発生日を本サービス上またはメールにより周知します。利用者に重要な影響を
          与える変更の場合は、生成・投稿・自動実行を行う前に、変更後の内容の確認をお願いします。
        </p>
      </LegalArticle>
    </LegalDocument>
  );
}
