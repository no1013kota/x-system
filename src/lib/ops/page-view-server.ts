import "server-only";

import { headers } from "next/headers";
import { after } from "next/server";

import { getPool } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { recordUnexpectedError } from "@/lib/observability/sentry";

import { jstDateOf } from "./kpi";
import { isCountableUserAgent, visitorHashFor, type TrackedPage } from "./page-view";

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
 * - bot（`page-view.ts` のUA判定）
 */
export async function recordPageView(path: TrackedPage): Promise<void> {
  try {
    const h = await headers();
    if (h.get("next-router-prefetch") !== null) return;
    const ua = h.get("user-agent");
    if (!isCountableUserAgent(ua)) return;
    // Vercelでは x-forwarded-for の先頭が実クライアント。ローカルは空でよい
    // （全員同じハッシュになるだけで、表示回数は正しく数えられる）。
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const date = jstDateOf(new Date().toISOString());
    const hash = visitorHashFor(env.APP_ENCRYPTION_KEY as string, date, ip, ua as string);
    after(async () => {
      try {
        await getPool().query(
          `insert into page_views (view_date, path, visitor_hash)
           values ($1, $2, $3)
           on conflict (view_date, path, visitor_hash)
           do update set views = page_views.views + 1`,
          [date, path, hash],
        );
      } catch (err) {
        recordUnexpectedError(err, { at: "page-view", path });
      }
    });
  } catch (err) {
    recordUnexpectedError(err, { at: "page-view", path });
  }
}
