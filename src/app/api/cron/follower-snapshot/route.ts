import { hourWindowKey } from "@/lib/jobs/cron";
import { handleCronRoute } from "@/lib/jobs/cron-route";

/**
 * フォロワー数記録cron（要件04 §6/§13, K-3, T-M5-14→T-M8-257で復活）。CRON_SECRET認証＋時間窓claimで
 * 二重起動時はno-op 2xx。JST当日分snapshotが無い active Xアカウント（所有者の契約が有効なものだけ）の
 * フォロワー数を user token別に読み、(x_account_id, snapshot_date) へ upsert する
 * （1起動100 account・最大10並列、失敗accountは次回毎時起動へ委ねる）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;

export async function GET(request: Request): Promise<Response> {
  return handleCronRoute(request, {
    name: "follower_snapshot",
    windowKey: hourWindowKey,
    work: async ({ windowKey }) => {
      // X token/env に触れるため認証・受付通過後に遅延ロードする（module読込で env 検証を走らせない）。
      const { runFollowerSnapshot } = await import("@/lib/jobs/follower-snapshot-server");
      return runFollowerSnapshot(windowKey);
    },
    response: ({ ran, windowKey, result }) => ({
      ok: true,
      ran,
      window: windowKey,
      result: result ?? null,
    }),
  });
}
