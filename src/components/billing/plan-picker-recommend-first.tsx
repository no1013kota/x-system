import type { ReactNode } from "react";

import { CampaignCallout } from "@/components/billing/campaign-callout";
import { PlanPricingCards, RECOMMENDED_PLAN } from "@/components/billing/plan-pricing-cards";
import { yen } from "@/lib/format";
import { comparisonColumns } from "@/lib/plan-comparison";
import { PLANS, type PlanDefinition, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

import styles from "./plan-picker-recommend-first.module.css";

/**
 * 料金「推奨先行」の組み立て（T-M8-419 で /new 用に作成 → T-M8-424 で LP と `/plans` の共用部品へ・
 * 運営者の依頼 2026-09-04「ホームページの料金に /plans も合わせる」）。共通部品（CampaignCallout・
 * PlanPricingCards）の中身は変えず、上に「1日あたり」を主役にしたキャップ行を足し、推奨
 * （RECOMMENDED_PLAN）だけ brand 帯で「まずはこれ」と示す。錨を BYOK の月額から推奨へ移す。
 *
 * - CTA は置き場所ごとに違う（LP＝`/signup` への Link、`/plans`＝CheckoutButton）ので、
 *   `PlanPricingCards` と同じ形で呼び出し側が `cta` を差し込む。
 * - キャップはカードの上辺に**密着**させ、全幅で1枚に見せる（角丸・上辺の罫線・「おすすめ」バッジは
 *   CSS module で消す）。SPは縦積みで推奨カードを先頭（`order:-1`）にし、帯の直下に推奨が来るようにする
 *   （以前は帯の直下に一番安いプランが来て「まずはこれ＝¥1,480」に読めた）。
 * - 1日あたりは共通部品と同じ式（切り上げ＋「約」）。月額（税込）はカードだけが持つ（SPは
 *   `order:-1` で推奨カードが帯の直下に来るので、帯にも出すと同じ「¥3,980／月」が180px間隔で2回並んだ）。
 *   代わりに「月額（税込）÷30日の目安」を推奨の数字の直下に添え（行の代表として1回だけ）、何から
 *   換算したかを数字を繰り返さずに示す（初心者が「キャンペーン終了後」の取り消し線の額で換算し直さない
 *   ため）。カード側の「1日あたり」行はキャップが持つので CSS module で消す。
 * - 数字の大きさは推奨だけ 40px、両隣は 28px（同格に並べると左→右の読み順で最安の数字が最初に
 *   目に入り、見出し「迷ったらプレミアム」の錨が左へ引かれる）。「まずはこれ」は text-sm・白。
 * - SPは表示順（プレミアム→スタンダード→エキスパート）と DOM順・Tab順（スタンダード→…）が異なる。
 *   共通部品を触らずに DOM を並べ替える手段が無いので割り切る（`/plans` の CTA は決済導線なので、
 *   直すなら `PlanPricingCards` に表示順の引数を足して DOM ごと推奨を先頭にする。T-M8-424 メモ）。
 *   読み上げは帯の sr-only「プレミアムプラン（この帯の直下のカード）」で帯とカードの対応を補う。
 * - キャップの要約（`capSummary`）は全幅で出す——初心者が1日あたりの数字だけ見て安い方へ流れ、
 *   後で API 実費で詰まないよう「なぜ安いか」を数字の隣に置く。
 * - 法令開示は帯にもCTAの上にも置かない（運営者の指示 2026-09-04・D-56。見出し下の選び方の1文と
 *   「はじめての方は7日間無料（カード登録が必要）です。」は削除した）。カード登録・7日間無料・期間中解約無料は
 *   カード下の CampaignCallout が担い、`/plans` はトライアル消化済み・残りトライアル中の利用者へ「7日間無料」を
 *   出さないよう `trialAvailable` を帯へ渡す（有利誤認の回避・T-M8-174）。
 * - キャンペーン（半額）の文言はこの部品で一切持たない。バッジ・取り消し線・帯は共通部品が
 *   `RELEASE_CAMPAIGN.active` で出し分ける（消し忘れる場所を増やさない）。
 * - 共通部品の DOM（`plan-pricing-cards.tsx` の grid と `article[aria-labelledby=plan-card-<id>]`・
 *   4番目の p が「1日あたり」）に CSS module が依存する。`plan-picker-recommend-first.test.ts` が固定する。
 */

/** 見出しに使う推奨プラン（LP・`/plans` から参照。名前を直書きしない）。 */
export const RECOMMENDED = PLANS[RECOMMENDED_PLAN];

/** 1日あたりの概算。共通部品 `PlanPricingCards` と同じ式（切り上げ・景表法）。 */
export function perDayYen(plan: PlanDefinition): number {
  return Math.ceil(plan.monthlyPriceJpy / 30);
}

/**
 * キャップの1行要約。plans.ts の定義（usageLimits・concealsLimits・xAccountLimit）から導く。
 * BYOK は「API利用料は別」を必ず添える（月額だけ見て安い方へ流れないため）。
 * カードの tagline・機能行と語が重なる（「APIキー不要」が列内で3回）のは既知——絞るなら LP と `/plans` が
 * 同時に変わるので運営者の判断を待つ（D-56）。
 */
export function capSummary(plan: PlanDefinition): string {
  if (!plan.usageLimits) return "自分のAPIキーで使う（API利用料は別）";
  if (plan.concealsLimits) {
    return `APIキー不要・無制限・Xアカウント${plan.xAccountLimit}件まで`;
  }
  return "APIキー不要";
}

function PerDay({ plan, recommended }: { plan: PlanDefinition; recommended: boolean }) {
  const muted = recommended ? "text-white/85" : "text-ink-2";
  return (
    <>
      {/* プラン名は読み上げにだけ（カードの h3 が直下にある。両隣も同じ）。推奨はSPで DOM順と表示順が違うので対応を添える。 */}
      <p className="sr-only">
        {plan.displayName}
        {recommended ? "（この帯の直下のカード）" : ""}
      </p>
      <p className="mt-1 leading-none tabular-nums">
        <span className="text-sm font-medium">約</span>
        <span
          className={cn(
            "mx-0.5 tracking-tight",
            recommended ? "text-[40px] font-extrabold" : "text-[28px] font-bold",
          )}
        >
          {yen(perDayYen(plan))}
        </span>
        <span className="text-sm font-medium">円／日</span>
      </p>
      {/* 「月額（税込）÷30日の目安」の行は運営者の指示（2026-09-05）で削除。換算はカードの月額と対で読める。 */}
      <p className={cn("mt-1 text-caption", muted)}>{capSummary(plan)}</p>
    </>
  );
}

/**
 * キャップ行＋プランカード3枚＋プロモ帯。
 *
 * @param cta 各カードのCTA（`PlanPricingCards` と同じ形。LP＝Link、`/plans`＝CheckoutButton）。
 * @param trialAvailable 無料トライアルが使えるか。消化済みなら帯のトライアル文を出さない（`/plans`）。
 */
export function PlanPickerRecommendFirst({
  cta,
  trialAvailable = true,
  className,
}: {
  cta: (planId: PlanId, planName: string) => ReactNode;
  trialAvailable?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(styles.wrap, className)}>
      {/* キャップ行: 列幅はカード行と同じ変数（CSS module）。両隣はSPでは出さない。 */}
      <div className={cn(styles.caps, "grid grid-cols-1 gap-4 md:items-end")}>
        {comparisonColumns().map(({ id, plan }) => {
          const recommended = id === RECOMMENDED_PLAN;
          return recommended ? (
            <div
              className="rounded-t-card bg-brand px-5 pt-4 pb-4 text-white sm:px-6"
              key={id}
            >
              {/* 「選ばれています」等の実績表現は使わない（販売実績が無い・景表法）。セクション内で最小の文字にしない（帯の役割そのもの）。 */}
              <p className="text-sm font-bold tracking-wide text-white">まずはこれ</p>
              <PerDay plan={plan} recommended />
              {/* 帯に法令注記は置かない（運営者の指示 2026-09-04）。開示はカード下の CampaignCallout が担う。 */}
            </div>
          ) : (
            <div
              className="hidden rounded-t-card border border-b-0 border-hairline bg-white/60 px-5 pt-4 pb-3 text-ink md:block"
              key={id}
            >
              <PerDay plan={plan} recommended={false} />
            </div>
          );
        })}
      </div>

      {/* カード本体は共通部品そのまま。キャップに密着させる（共通部品の pt-3 を打ち消す）。 */}
      <div className={cn(styles.cards, "-mt-3")}>
        <PlanPricingCards cta={cta} />
      </div>

      {/* キャンペーン帯はカードの下へ（上は「どれを選ぶか」だけにする）。文面は共通部品のまま。 */}
      <CampaignCallout className="mt-6" trialAvailable={trialAvailable} />
    </div>
  );
}
