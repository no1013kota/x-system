import "server-only";

import { judgePortalFeatures, type PortalFeatureSnapshot } from "@/lib/stripe/portal-features";

import type { Check } from "./diagnostics";

/**
 * Stripe の Portal Configuration を読み、画面のボタンが使える状態かを判定する（T-M8-32）。
 *
 * **相手側の設定はコードに現れない。** 2026-08-03、「プランを変更」が Stripe 側で無効なまま
 * ボタンだけ出ていて、押して初めて分かった。状態確認（doctor）で毎回見る。
 * 読み取りだけなので費用も副作用も無い。
 */

export interface PortalConfigurationGateway {
  billingPortal: {
    configurations: {
      retrieve(id: string): Promise<{
        features?: {
          subscription_update?: { enabled?: boolean };
          subscription_cancel?: { enabled?: boolean };
        } | null;
      }>;
    };
  };
}

export interface PortalProbeDeps {
  configurationId?: string | null;
  stripe?: PortalConfigurationGateway | null;
}

export async function probePortalFeatures(
  deps: PortalProbeDeps,
): Promise<PortalFeatureSnapshot> {
  if (!deps.configurationId) return { features: null, configurationMissing: true };
  if (!deps.stripe) return { features: null };
  try {
    const configuration = await deps.stripe.billingPortal.configurations.retrieve(
      deps.configurationId,
    );
    return { features: configuration.features ?? {} };
  } catch (error) {
    // **「設定IDが無い」と「Stripeへ届かない」を区別する**（T-M8-55）。
    // 前者は別環境の値が入っている典型的な事故で、待っても直らない。
    return { features: null, ...(isMissingResource(error) ? { configurationNotFound: true } : {}) };
  }
}

/** Stripe の `resource_missing`（No such ...）か。 */
function isMissingResource(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  return code === "resource_missing" || /No such configuration/i.test(message);
}

export function judgePortal(snapshot: PortalFeatureSnapshot): Check {
  const judged = judgePortalFeatures(snapshot);
  return {
    name: "プラン管理（Stripe）",
    level: judged.level,
    detail: judged.detail,
    // 判定側が次の一手を持っていればそれを使う（T-M8-128）。
    ...(judged.nextAction ? { nextAction: judged.nextAction } : {}),
    ...(judged.level === "error"
      ? {
          // **どの環境を直すかまで書く**（T-M8-49）。`--target` を必須にした（T-M8-35）のに
          // ここが旧形式のままで、運営者が言われた通り打つとエラーで止まっていた。
          // 原則2「原因が開発知識なしで辿れる」は、示したコマンドがそのまま動くことまで含む。
          nextAction:
            "`npm run stripe:portal:setup -- --target <local|staging|production>` を実行して" +
            "Stripe側の設定をコードへ合わせてください（IDは変わりません）。手順は docs/operations/deployment.md §1.4",
        }
      : {}),
  };
}
