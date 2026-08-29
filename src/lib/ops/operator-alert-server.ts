import "server-only";

import { collectDiagnostics } from "./diagnostics";
import { buildStripeProbeDeps } from "./stripe-probe-deps";
import { buildOperatorAlert } from "./operator-alert";

import { env } from "@/lib/env";
import { classifySentryDsn } from "./config-status";
import type { Queryable } from "@/lib/x/token-refresh";

/**
 * `doctor` の判定を1日1回、運営者へメールで届ける（T-M8-164）。
 *
 * **毎朝の日次サマリには混ぜない**——あれはX連携済みの全利用者へ配るもので、
 * 運営の内情（設定ミス・APIキー・残高）を利用者へ届けてはいけない。宛先は `SUPPORT_EMAIL` だけ。
 *
 * 呼び出しは `scheduler_tick` の中（5分ごとに来る）で、`cron_runs` の
 * `(job_name='operator_alert', window_key=JSTの日付)` を確保できた回だけ実際に送る。
 * **定時トリガーを1本増やさない**（原則3）。
 */

/** 送る時刻（JST）。日次サマリと同じ朝8時に揃える。 */
export const OPERATOR_ALERT_HOUR_JST = 8;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface OperatorAlertResult {
  /** 送ったか。異常なし・時刻前・宛先未設定・既に送信済みならいずれも false。 */
  sent: boolean;
  /** 送らなかった理由（運営者向けではなく、cron応答の説明用）。 */
  skipped?:
    | "before_hour"
    | "no_recipient"
    | "already_sent"
    | "no_problem"
    | "smtp_unavailable";
}

export interface OperatorAlertDeps {
  db: Queryable;
  nowIso: string;
  /** 同日の重複送信を止める。`true` を返した回だけ送る。 */
  claimDay: (windowKey: string) => Promise<boolean>;
  sendMail: (msg: { subject: string; text: string; to: string }) => Promise<void>;
}

function jstDate(nowIso: string): { date: string; hour: number } {
  const jst = new Date(new Date(nowIso).getTime() + JST_OFFSET_MS);
  return { date: jst.toISOString().slice(0, 10), hour: jst.getUTCHours() };
}

/** 環境の呼び名。件名に入るので、本番とstagingのメールを見分けられるようにする。 */
function environmentLabel(appEnv: string): string {
  if (appEnv === "production") return "本番";
  if (appEnv === "preview") return "staging";
  return appEnv;
}

export async function deliverOperatorAlert(
  deps: OperatorAlertDeps,
): Promise<OperatorAlertResult> {
  const { date, hour } = jstDate(deps.nowIso);
  if (hour < OPERATOR_ALERT_HOUR_JST) return { sent: false, skipped: "before_hour" };

  /*
    宛先は `SUPPORT_EMAIL`（運営者のアドレス）。**画面に出す問い合わせ先とは別物**で、
    そちらは `LEGAL_ENTITY.email`（support@exosai.net）が正本（T-M8-343）。
    差出人と宛先が同じだと、Gmailは自分宛のメールを受信トレイに入れないため
    **異常が起きても気付けない**（2026-08-25に踏んだ）。同じ値にしないこと。
  */
  const to = env.SUPPORT_EMAIL;
  if (!to) return { sent: false, skipped: "no_recipient" };

  const label = environmentLabel(env.APP_ENV);

  /*
    **判定の前に日付を確保する。** 判定はDBを何度も読み外部APIも叩くので、
    5分ごとの tick が並行しても1回で済むようにする。異常が無くて送らなかった日も
    「その日は見た」として確保したままにする——同じ日に何度も判定を走らせない。
  */
  const claimed = await deps.claimDay(`operator-alert:${label}:${date}`);
  if (!claimed) return { sent: false, skipped: "already_sent" };

  /*
    **Stripeの検査もここで渡す**（T-M8-247）。以前は1つも渡していなかったため、
    設定済みなのに「未設定です」と毎日送っていた。事実と違う警告は読まれなくなり、
    本当の異常まで埋もれる（CLAUDE.md 原則2）。入口は doctor と同じものを使う。
  */
  const stripeProbes = await buildStripeProbeDeps();
  const report = await collectDiagnostics(deps.db, {
    ...stripeProbes,
    /*
      **人間確認の接続情報もここで渡す**（T-M8-359）。Stripeと同じ抜けが残っていて、
      毎朝「Supabaseの接続情報が無いため確認できません」という【注意】が届いていた——
      設定はあるのに、渡していないから確認できていないだけ。事実と違う警告は読まれなくなり、
      本当の異常まで埋もれる（原則2）。渡す値は doctor の route と同じ。
    */
    captcha: {
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    schedulerExpected: env.APP_ENV === "production",
    subscriptionSyncExpected: env.APP_ENV === "production",
    mailSenderEmail: env.SMTP_USER ?? null,
    config: {
      appEnv: env.APP_ENV,
      postingMode: env.X_POSTING_MODE,
      appBaseUrl: env.APP_BASE_URL ?? null,
      // cronにはリクエストが無いので、設定値そのものを「実際の配信元」として扱う
      // （URL不一致の検知はHTTP経由の `doctor` が担う）。
      actualOrigin: env.APP_BASE_URL ?? null,
      stripeKeyKind: env.STRIPE_SECRET_KEY
        ? env.STRIPE_SECRET_KEY.startsWith("sk_live_")
          ? "live"
          : "test"
        : null,
      ...(() => {
        const server = classifySentryDsn(process.env.SENTRY_DSN);
        const browser = classifySentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
        return {
          sentryDsnKind: server.kind,
          sentryPublicDsnKind: browser.kind,
          sentryHost: server.host ?? browser.host,
        };
      })(),
    },
  });

  const alert = buildOperatorAlert(report.checks, {
    date,
    environmentLabel: label,
    baseUrl: env.APP_BASE_URL ?? null,
  });
  if (!alert) return { sent: false, skipped: "no_problem" };

  await deps.sendMail({ subject: alert.subject, text: alert.body, to });
  return { sent: true };
}
