import { LockedState } from "@/components/app-shell/page-state";
import { pageTitleClassName } from "@/components/ui/card";

/**
 * プラン未登録（未契約・解約済み）のときに機能画面の代わりに出す画面（T-M8-269・
 * 運営者の指示 2026-08-23）。
 *
 * **リダイレクトではなくその場に出す。** どこへ来たのかが分かるまま「先にプランを登録して
 * ください」と理由を言い、登録への導線を置く（黙って別の画面へ飛ばすと、押した導線が
 * 効かなかったのか自分の操作が悪かったのか分からない・原則2）。
 *
 * 器は各画面と同じ（`main` の幅・余白）にして、ロック中だけレイアウトが変わって見えないようにする。
 */
export function PlanRequiredPage({
  description,
  title,
}: {
  /** その画面で何ができるようになるかを1文で（プラン登録の理由になる）。 */
  description: string;
  /** 画面の見出し（ロック中もどこに居るかが分かるよう、通常時と同じ文言にする）。 */
  title: string;
}) {
  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-[26px] lg:px-8">
      <header>
        <h1 className={pageTitleClassName}>{title}</h1>
      </header>
      <div className="mt-7">
        <LockedState
          actionHref="/plans"
          actionLabel="プランを登録する"
          description={`${description}ご利用にはプランの登録が必要です。先にプランを登録してください（友達招待はプランの登録がなくてもご利用いただけます）。`}
          title="先にプランを登録してください"
        />
      </div>
    </main>
  );
}
