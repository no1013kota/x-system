import { PLANS } from "@/lib/plans";

/**
 * /new 専用の FAQ 8問（T-M8-419）。既存の `FaqList`（12問）は再利用しない——
 * 「今後YouTubeやTikTokも」など docs に根拠のない将来約束を含むため。
 * 折りたたまない（開閉式にしない。LPで最も読まれるべき内容を隠さない）。
 * 開示語「下書きまで」「同意」「はじめて（初回）」「カード登録」を必ず残す。「退会」とは書かない。
 * 分析は「分析を開始」を押したときだけ（1日1回・表示専用）——「自動で分析」と書かない（PRD K-2）。
 * 画像生成の提供元はアプリ画面と同じ表示名「OpenAI／Gemini」（「ChatGPT」と書かない）。
 */
const FAQ_ITEMS: [question: string, answer: string][] = [
  [
    "本当に全部自動ですか？",
    "集める・作る・投稿・記録は自動で回ります。分析は「分析を開始」を押したときにAIが行います（1日1回・表示専用）。既定は「下書きまで」で、確認するのはあなたです。自動投稿は内容と停止方法を読んで同意した後に始まり、いつでも即時に止められます。",
  ],
  [
    "始めるのに何が必要ですか？",
    `XアカウントとメールアドレスがあればX連携まで進めます。${PLANS.standard.displayName}はさらに、X Developer App の情報と生成AI（Claude／OpenAI／Gemini のいずれか）のAPIキーをご自身で用意します。${PLANS.premium.displayName}・${PLANS.expert.displayName}は当方がキーを用意するので、カード登録とX連携だけで始められます。`,
  ],
  [
    "1件どのくらいで作れますか？",
    "通常60〜90秒です（リサーチ込み）。画面を離れても生成は続き、できた下書きは投稿前に編集できます。",
  ],
  [
    "画像は作れますか？",
    `OpenAI／Geminiで、スレッドの各ポストに1枚ずつ生成できます。自分の画像に差し替えることもできます。${PLANS.standard.displayName}はOpenAI／Geminiのキー登録時に使えます。`,
  ],
  [
    "スマホや、X以外のSNSでも使えますか？",
    "対応SNSはX（旧Twitter）のみです。PC・スマホのブラウザから使えます（専用アプリはありません）。",
  ],
  [
    "無料期間はありますか？",
    "はじめてのお申し込みに限り7日間無料です。開始にはカード登録が必要で、期間中に解約すれば料金はかかりません。終了後は選んだプランで自動課金となります。",
  ],
  [
    "解約はどうすればいいですか？",
    "設定のお支払い管理からいつでも手続きできます。有料期間中の解約は期間末まで使え、日割り返金はありません。",
  ],
  // 旧「安心して任せるために」3カードの要点をここへ集約（3周目・個人開発のサービスとして冗長だったため）。
  [
    "APIキーやXの連携情報は安全ですか？",
    "APIキーとXのトークンは暗号化して保存します。Xへの書き込みは投稿だけで、自動いいね・自動フォロー・自動リプライは行いません（凍結リスクを避けるため）。",
  ],
  [
    `${PLANS.standard.displayName}の実費はどのくらいですか？`,
    `月額とは別に、X APIと生成AI APIの利用料がご自身の契約で発生します（従量課金）。当方の実測では1投稿あたり数円〜数十円程度で、使うモデルにより変動します。${PLANS.premium.displayName}・${PLANS.expert.displayName}は追加費用なしです。`,
  ],
];

export function NewFaqList() {
  return (
    <dl>
      {FAQ_ITEMS.map(([question, answer]) => (
        <div className="border-t border-hairline py-6" key={question}>
          <dt className="text-[length:clamp(17px,calc(13px_+_0.7vw),21px)] font-medium tracking-[-0.01em] [font-feature-settings:'palt'] [word-break:auto-phrase]">
            {question}
          </dt>
          <dd className="mt-2 text-sm leading-[1.8] text-ink-2">{answer}</dd>
        </div>
      ))}
    </dl>
  );
}
