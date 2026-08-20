import { Icon } from "@/components/ui/icon";
import { RELEASE_CAMPAIGN } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * 実施中のプロモーション帯（T-M8-171・運営者の指示 2026-08-21）。LPの料金セクションと
 * `/plans` で同じものを使う。申込前確認の定型文はここへ畳んだ——ただし**法令上の開示は残す**:
 * 「初回のみ」（有利誤認の回避）と「カード登録が必要」（無料の条件）はこの帯が唯一の置き場所。
 * 詳細な法定事項はフッタの特定商取引法ページ・利用規約が担う（運営者の決定）。
 */
export function CampaignCallout({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-card border border-brand bg-brand-subtle px-5 py-4 text-center",
        className,
      )}
    >
      {RELEASE_CAMPAIGN.active ? (
        <p className="text-[15px] font-bold text-brand">
          <Icon aria-hidden="true" className="mr-1.5 inline-block align-[-3px]" name="bolt" size={16} />
          いまだけ、リリース記念で全プラン半額
        </p>
      ) : null}
      <p className={cn("text-body text-ink-2", RELEASE_CAMPAIGN.active && "mt-1")}>
        さらに<strong className="font-bold text-ink">初回のみ7日間の無料トライアル</strong>を実施中
        （開始にはカード登録が必要です。期間中に解約すれば料金はかかりません）。
      </p>
      {RELEASE_CAMPAIGN.active ? (
        <p className="mt-1 text-caption text-ink-3">{RELEASE_CAMPAIGN.note}</p>
      ) : null}
    </div>
  );
}
