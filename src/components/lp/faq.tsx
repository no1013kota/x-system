import { cn } from "@/lib/utils";

/**
 * LP 07 よくある質問（design_handoff_space_ai_lp §文言）。ネイティブ `<details>` で開閉し、
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
    "APIキーとは何ですか？",
    "Xや生成AIのサービスを利用するための「鍵」となる文字列です。通常プラン・mdプランではご自身でご用意いただき、月額とは別に各提供元の利用料がかかります。プレミアムプランでは運営が用意するため不要です。お預かりしたキーは暗号化して保存し、画面上は末尾4桁のみ表示します。いつでも削除できます。",
  ],
  [
    "勝手に投稿されませんか？",
    "されません。既定は「下書きまで」モードで、自動投稿には画面での明示的な同意が別途必要です。Xと連携しただけでは始まりません。設定から停止すれば、実行待ちの自動投稿もキャンセルされます。",
  ],
  [
    "解約はいつでもできますか？",
    "はい。設定内のカスタマーポータルからいつでも手続きでき、期間末での解約となります（日割り返金はありません）。",
  ],
  [
    "スマホで使えますか？",
    "Webアプリのため、スマホのブラウザからご利用いただけます。専用のスマホアプリはありません。",
  ],
  ["X以外のSNSにも対応していますか？", "現在はX（旧Twitter）のみの対応です。"],
  [
    "投稿の生成にはどのくらい時間がかかりますか？",
    "通常60〜90秒です。生成された内容は、投稿前にご自身でご確認ください。",
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
