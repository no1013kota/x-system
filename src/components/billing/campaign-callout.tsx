import { Icon } from "@/components/ui/icon";
import { RELEASE_CAMPAIGN } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * 実施中のプロモーション帯（T-M8-171・運営者の指示 2026-08-21）。LPの料金セクションと
 * `/plans` で同じものを使う。申込前確認の定型文はここへ畳んだ——ただし**法令上の開示は残す**:
 * 「初回のみ」（有利誤認の回避）と「カード登録が必要」（無料の条件）はこの帯が唯一の置き場所。
 * 詳細な法定事項はフッタの特定商取引法ページ・利用規約が担う（運営者の決定）。
 */
export function CampaignCallout({
  className,
  trialAvailable = true,
}: {
  className?: string;
  /**
   * 無料トライアルは初回のみ。消化済みの利用者にはトライアル文を出さない（有利誤認の回避）。
   * **帯の文面からは「初回のみ」の語を外してある**（2026-08-26・運営者の最終レビュー）。
   * 初回限りであることの開示はFAQと特商法ページが担う。この props による出し分けは残す
   * ——消化済みの人に「7日間無料」と見せないための最後の砦。
   */
  trialAvailable?: boolean;
}) {
  if (!RELEASE_CAMPAIGN.active && !trialAvailable) return null;
  return (
    <div
      className={cn(
        "rounded-card border border-brand bg-brand-subtle px-5 py-4 text-center",
        className,
      )}
    >
      {RELEASE_CAMPAIGN.active ? (
        // 帯の主役なので大きく出す（T-M8-177・運営者の指示）。
        <p className="text-[22px] font-bold tracking-tight text-brand sm:text-[26px]">
          <Icon aria-hidden="true" className="mr-1.5 inline-block align-[-4px]" name="bolt" size={24} />
          いまだけ、リリース記念で全プラン半額
        </p>
      ) : null}
      {trialAvailable ? (
        <p className={cn("text-body text-ink-2", RELEASE_CAMPAIGN.active && "mt-1")}>
          {/* 半額が終わったあとは「さらに」で始めない（前段が無くなるため）。 */}
          {RELEASE_CAMPAIGN.active ? "さらに" : ""}
          <strong className="font-bold text-ink">7日間の無料トライアル</strong>を実施中
          （カード登録が必要です。期間中に解約すれば料金はかかりません）。
        </p>
      ) : null}
      {/* 「リリース記念として期間限定で…お知らせします」の補足行は削除（運営者の指示 2026-08-22）。 */}
    </div>
  );
}
