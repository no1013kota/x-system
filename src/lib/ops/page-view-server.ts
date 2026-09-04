import "server-only";

import { headers } from "next/headers";
import { after } from "next/server";

import { readVerifiedUserHeaders } from "@/lib/auth/request-user";
import { getAppEncryptionKey } from "@/lib/crypto";
import { getPool } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { recordUnexpectedError } from "@/lib/observability/sentry";

import { jstDateOf } from "./kpi";
import { isCountableRequest, visitorHashFor, type TrackedPage } from "./page-view";

/**
 * 公開ページの閲覧を記録する（T-M8-378・運営者の指示 2026-08-30）。
 *
 * 各ページのServer Componentから呼ぶ。**画面を1msも待たせない**——ヘッダの読み取りだけ
 * render中に行い、DBへの書き込みは `after()`（応答を返した後）で実行する。
 * 記録の失敗で画面を壊さない（握り潰してSentryへ記録するだけ）。
 *
 * 数えないもの:
 * - Next.jsの先読み（`next-router-prefetch` ヘッダ）——リンクが画面に見えただけで飛ぶため
 *   「開いた」ではない。数えるとホームの数字が数倍に膨らむ
 * - bot（`page-view.ts` のUA判定）、画面遷移でないリクエスト（`sec-fetch-dest` が document 以外。
 *   release／doctor の疎通確認やスキャナ）、運営者自身（proxy が検証したメールが `SUPPORT_EMAIL`）
 *   ——T-M8-422
 */
/**
 * @param options.source 流入元（`?src=`・T-M8-423）。`parseTrafficSource` 済みの値を渡す。
 *   登録済みの流入元だけを数え、未登録は ''（直接・不明）として数える（判定は書き込み時のSQL）。
 */
export async function recordPageView(
  path: TrackedPage,
  options: { source?: string } = {},
): Promise<void> {
  try {
    const h = await headers();
    if (h.get("next-router-prefetch") !== null) return;
    const ua = h.get("user-agent");
    // proxy の署名付きヘッダだけを見る（Supabase Auth へは問い合わせない＝LPを遅くしない）。
    const forwarded = readVerifiedUserHeaders(h, getAppEncryptionKey());
    const viewerEmail = forwarded ? (forwarded.email ?? null) : null;
    if (
      !isCountableRequest({
        userAgent: ua,
        secFetchDest: h.get("sec-fetch-dest"),
        secFetchMode: h.get("sec-fetch-mode"),
        viewerEmail,
        operatorEmail: env.SUPPORT_EMAIL ?? null,
      })
    ) {
      return;
    }
    // Vercelでは x-forwarded-for の先頭が実クライアント。ローカルは空でよい
    // （全員同じハッシュになるだけで、表示回数は正しく数えられる）。
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const date = jstDateOf(new Date().toISOString());
    const hash = visitorHashFor(env.APP_ENCRYPTION_KEY as string, date, ip, ua as string);
    after(async () => {
      try {
        await getPool().query(
          `insert into page_views (view_date, path, visitor_hash, source)
           values ($1, $2, $3,
             coalesce((select slug from traffic_sources where slug = $4), ''))
           on conflict (view_date, path, visitor_hash, source)
           do update set views = page_views.views + 1`,
          [date, path, hash, options.source ?? ""],
        );
      } catch (err) {
        recordUnexpectedError(err, { at: "page-view", path });
      }
    });
  } catch (err) {
    recordUnexpectedError(err, { at: "page-view", path });
  }
}
