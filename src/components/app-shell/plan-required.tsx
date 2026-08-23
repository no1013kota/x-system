import { LockedState } from "@/components/app-shell/page-state";
import { pageTitleClassName } from "@/components/ui/card";
import type { AppLockReason } from "@/lib/auth/subscription-access";

/**
 * 契約が有効でないときに機能画面の代わりに出す画面（T-M8-269→T-M8-273・
 * 運営者の指示 2026-08-23）。
 *
 * **リダイレクトではなくその場に出す。** どこへ来たのかが分かるまま理由を言い、直し方への
 * 導線を置く（黙って別の画面へ飛ばすと、押した導線が効かなかったのか自分の操作が悪かったのか
 * 分からない・原則2）。
 *
 * **理由ごとに直し方が違う**ので文言と行き先を分ける。プランが無い人へ「お支払い情報を更新」と
 * 言っても直せないし、支払いが滞っているだけの人へ「プランを登録」と言うと二重契約を促す。
 */
const LOCK_COPY: Record<
  AppLockReason,
  { actionHref: string; actionLabel: string; suffix: string; title: string }
> = {
  plan_required: {
    actionHref: "/plans",
    actionLabel: "プランを登録する",
    suffix:
      "ご利用にはプランの登録が必要です。先にプランを登録してください（友達招待はプランの登録がなくてもご利用いただけます）。",
    title: "先にプランを登録してください",
  },
  payment_required: {
    actionHref: "/app/settings?tab=billing",
    actionLabel: "お支払い情報を更新する",
    suffix:
      "お支払いを確認できなかったため、一時的にご利用を停止しています。お支払い情報を更新すると、すぐに再開できます（データは保持しています。友達招待は引き続きご利用いただけます）。",
    title: "お支払い情報を更新してください",
  },
};

export function AppLockedPage({
  description,
  reason,
  title,
}: {
  /** その画面で何ができるかを1文で（登録・更新する理由になる）。 */
  description: string;
  reason: AppLockReason;
  /** 画面の見出し（ロック中もどこに居るかが分かるよう、通常時と同じ文言にする）。 */
  title: string;
}) {
  const copy = LOCK_COPY[reason];
  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-[26px] lg:px-8">
      <header>
        <h1 className={pageTitleClassName}>{title}</h1>
      </header>
      <div className="mt-7">
        <LockedState
          actionHref={copy.actionHref}
          actionLabel={copy.actionLabel}
          description={`${description}${copy.suffix}`}
          title={copy.title}
        />
      </div>
    </main>
  );
}

/** 設定タブなど、ページ枠を持たない場所で使うロック本体（見出しと器は呼び出し側）。 */
export function AppLockedNotice({
  description,
  reason,
}: {
  description: string;
  reason: AppLockReason;
}) {
  const copy = LOCK_COPY[reason];
  return (
    <LockedState
      actionHref={copy.actionHref}
      actionLabel={copy.actionLabel}
      description={`${description}${copy.suffix}`}
      title={copy.title}
    />
  );
}
