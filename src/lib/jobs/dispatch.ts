import "server-only";

/**
 * ジョブ dispatch ヘルパ（要件04 §1/§3, ADR-0002）。「1 job = 1 Function呼び出し」で
 * `POST /api/jobs/run` を叩く。手動（Server Action/API Routeの after()）・親workerからの
 * 連鎖・scheduler_tick からの一括、の3経路すべてが本ヘルパを使う。
 *
 * worker route は 202 を即時返し本処理を after() で行うため、dispatchJob は 202 受領で
 * 返り、worker の処理完了は待たない。transport失敗・非2xxでも**例外を投げず**結果を返す
 * （ジョブ行には触れないので queued のまま残り、scheduler_tick が回収する）。
 */

export interface DispatchResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function dispatchJob(jobId: string): Promise<DispatchResult> {
  const base = process.env.APP_BASE_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    // 設定不足でも投げない。ジョブは queued のまま、次の scheduler_tick が回収する。
    return { ok: false, error: "APP_BASE_URL/CRON_SECRET missing" };
  }
  try {
    const res = await fetch(`${base}/api/jobs/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ jobId }),
    });
    if (res.status !== 202) {
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "dispatch failed",
    };
  }
}
