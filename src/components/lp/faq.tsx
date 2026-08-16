import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";

/**
 * LP 07 よくある質問（design_handoff_lp §文言）。ネイティブ `<details>` で開閉し、
 * JS状態を持たない。「＋」は開くと45度回転して「×」に見える（色だけに頼らない開閉表現）。
 */

/**
 * 回答は本文セクションと重複する部分を落として短くしてある（T-M8-76）。
 * トライアルの条件は申込前確認事項が正の置き場所。
 * ただし**生成物を投稿前に利用者が確認する**旨は、生成品質を運営が保証しない立場の
 * 表明なので短縮しない（利用規約第7条と対応）。
 *
 * 「04 安全性」セクションの削除（T-M8-77）で行き場を失った次の2つは、ここが唯一の置き場所に
 * なったので回答へ戻した。短縮しないこと:
 * - APIキーの暗号化・末尾4桁のみ表示・削除可（BYOKで鍵を預ける利用者の主要な不安）
 * - 自動投稿の停止で実行待ちもキャンセルされること
 */
const FAQ_ITEMS: [question: string, answer: string][] = [
  [
    "「APIキー」とは何ですか？むずかしくありませんか？",
    `XやAIのサービスを、${APP_NAME}があなたの代わりに動かすための「鍵」にあたる文字列です。通常プラン・mdプランでは、Xと生成AIのそれぞれで鍵を発行して登録していただきます（画面の手順どおりに進められます）。この場合、月額とは別に各提供元の利用料がかかります。プレミアムプランでは運営が用意するので、この作業も追加の費用もありません。お預かりした鍵は暗号化して保存し、画面には末尾4桁だけを表示します。いつでも削除できます。`,
  ],
  [
    "自分の知らないうちに投稿されませんか？",
    "されません。はじめは「下書きまで作る」設定になっています。自動で投稿するには、何を・いつ投稿するか、どう止められるかを説明した画面で、あなたが同意する必要があります。Xとつないだだけでは始まりません。設定から止めれば、実行を待っている投稿もキャンセルされます。",
  ],
  [
    "解約はいつでもできますか？",
    "はい。設定内のお支払い管理画面からいつでも手続きでき、お支払い済みの期間の終わりで解約になります（日割りの返金はありません）。",
  ],
  [
    "スマホだけで使えますか？",
    "使えます。Webアプリなので、スマホのブラウザからご利用いただけます。専用のスマホアプリはありません。",
  ],
  ["X以外のSNSにも使えますか？", "いいえ。現在はX（旧Twitter）のみの対応です。"],
  [
    "投稿ができるまで、どのくらい待ちますか？",
    "1件あたり通常60〜90秒です。できあがった内容は、投稿する前にご自身でご確認ください。",
  ],
];

export function FaqList() {
  return (
    <div>
      {FAQ_ITEMS.map(([question, answer], index) => (
        <details
          className={cn(
            "group border-t border-hairline",
            index === FAQ_ITEMS.length - 1 && "border-b",
          )}
          key={question}
        >
          <summary className="flex cursor-pointer list-none items-baseline gap-3 px-1 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span className="flex-1">{question}</span>
            <span
              aria-hidden="true"
              className="inline-block flex-none font-medium text-brand transition-transform duration-[250ms] group-open:rotate-45 motion-reduce:transition-none"
            >
              ＋
            </span>
          </summary>
          <p className="px-1 pb-4 text-body text-ink-2">{answer}</p>
        </details>
      ))}
    </div>
  );
}
