import { STRIPE_WEBHOOK_EVENT_TYPES } from "@/lib/stripe/webhook";

import type { Check } from "./check";

/**
 * **Stripe側のwebhook設定が、アプリの扱うイベントを全部送ってくれるか**（T-M8-238）。
 *
 * 購読するイベントの選択は Stripe ダッシュボード側の設定で、コードには現れない。
 * 2026-08-23 の監査で、本番・stagingのどちらの endpoint にも `charge.refunded` が無かった。
 * つまり**返金しても招待報酬が取り消されない**（コード側は対応済みなのに一度も動いていない）。
 * 届かないイベントは例外にならないので、Sentryにも出ず、画面も正常に見える（CLAUDE.md 原則1）。
 *
 * 読み取りだけなので副作用も費用も無い。
 */

export interface WebhookEndpointGateway {
  webhookEndpoints: {
    list(params: { limit: number }): Promise<{
      data: { id: string; url: string; status: string; enabled_events: string[] }[];
    }>;
  };
}

export interface WebhookEventsProbeDeps {
  /** この環境のwebhook受け口（`APP_BASE_URL` から作る）。未設定なら判定しない。 */
  webhookUrl?: string | null;
  stripe?: WebhookEndpointGateway | null;
  /** デプロイ先（preview/production）なら true。ローカルは false で警告どまりにする。 */
  expected?: boolean;
}

export interface WebhookEventsSnapshot {
  /**
   * この環境でwebhookが届いている前提か（T-M8-247）。ローカルは `stripe listen` を
   * 常時動かすものではないので、受け口が無いだけで赤くしない（常に赤い表示は読まれなくなる）。
   */
  expected?: boolean;
  /** 受け口が見つかったか。false は「この環境向けの endpoint がStripeに無い」。 */
  found?: boolean;
  /** endpoint の status（`enabled` / `disabled`）。 */
  status?: string;
  /** 送られてくるイベント種別。 */
  enabledEvents?: string[];
  /** Stripeへ問い合わせできなかった（鍵が無い・通信不可）。 */
  unavailable?: boolean;
}

export async function probeWebhookEvents(
  deps: WebhookEventsProbeDeps,
): Promise<WebhookEventsSnapshot> {
  if (!deps.webhookUrl || !deps.stripe) return { unavailable: true, expected: deps.expected };
  try {
    const list = await deps.stripe.webhookEndpoints.list({ limit: 100 });
    // 末尾スラッシュの差だけで「無い」と言わない（設定は手で入れるもの）。
    const normalize = (url: string) => url.replace(/\/+$/, "");
    const target = list.data.find((e) => normalize(e.url) === normalize(deps.webhookUrl!));
    if (!target) return { found: false, expected: deps.expected };
    return {
      enabledEvents: target.enabled_events,
      expected: deps.expected,
      found: true,
      status: target.status,
    };
  // eslint-disable-next-line no-restricted-syntax -- 失敗そのものが答え（鍵が無い・通信不可）。判定へ unavailable として渡し「確認できませんでした」＋次の一手を出す。ここで投げると doctor 全体が落ちる
  } catch {
    return { unavailable: true, expected: deps.expected };
  }
}

export function judgeWebhookEvents(snapshot: WebhookEventsSnapshot): Check {
  const name = "契約イベントの受け取り（Stripe webhook）";
  if (snapshot.unavailable) {
    return {
      name,
      level: "warn",
      detail: "Stripeへ問い合わせできませんでした（鍵かAPP_BASE_URLが読めていない可能性があります）",
      nextAction: "STRIPE_SECRET_KEY と APP_BASE_URL がこの環境に設定されているか確認してください",
    };
  }
  if (snapshot.found === false) {
    // ローカルは `stripe listen` を常時動かすものではないので、赤くせず手順だけ出す。
    const local = snapshot.expected === false;
    return {
      name,
      level: local ? "warn" : "error",
      detail: local
        ? "ローカルのwebhook受け口がありません（課金を試すときだけ `stripe listen` が要ります）"
        : "この環境のwebhook受け口がStripeに登録されていません。契約・解約・返金が1件もアプリへ届きません",
      nextAction: local
        ? "`stripe listen --forward-to http://127.0.0.1:3000/api/stripe/webhook` を起動してください（起動しないと、Stripe側で契約を変えてもローカルDBへ反映されません）"
        : "Stripeダッシュボード → Developers → Webhooks で `<APP_BASE_URL>/api/stripe/webhook` を追加してください",
    };
  }
  if (snapshot.status !== "enabled") {
    return {
      name,
      level: "error",
      detail: `webhookの受け口が ${snapshot.status ?? "不明"} になっています（イベントが届きません）`,
      nextAction: "Stripeダッシュボードで該当のwebhookを有効化してください",
    };
  }
  const enabled = new Set(snapshot.enabledEvents ?? []);
  // `*` を選んでいる設定は全イベントが来るので不足なし。
  const missing = enabled.has("*")
    ? []
    : STRIPE_WEBHOOK_EVENT_TYPES.filter((type) => !enabled.has(type));
  if (missing.length > 0) {
    return {
      name,
      level: "error",
      detail: `届かないイベントがあります: ${missing.join("・")}（${missing.includes("charge.refunded") ? "返金しても招待報酬が取り消されません" : "契約の変更がアプリへ反映されません"}）`,
      nextAction:
        "Stripeダッシュボード → Developers → Webhooks → 該当の受け口 → 「Listen to」に不足イベントを追加してください",
    };
  }
  return {
    name,
    level: "ok",
    detail: `必要な ${STRIPE_WEBHOOK_EVENT_TYPES.length} 種類のイベントが届く設定です`,
  };
}
