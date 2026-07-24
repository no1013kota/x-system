import "server-only";

import { env } from "../env";
import type { XClientDeps, XHttp, XPostingMode } from "./client";
import type { XCostConfig } from "./pricing";

/**
 * X API クライアントの server-only 配線（要件01 §3.1）。global fetch を `XHttp` へ、
 * env の X_POSTING_MODE を mode へ束ねる。request ID は X 応答ヘッダ（x-transaction-id /
 * x-request-id）から取り、原価台帳（external_api_usage_events, 台帳MSで接続）へ渡せるようにする。
 */

export function xPostingMode(): XPostingMode {
  return env.X_POSTING_MODE;
}

export const xHttp: XHttp = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    requestId:
      res.headers.get("x-transaction-id") ?? res.headers.get("x-request-id"),
  };
};

/** createPost/deletePost/getMe/getTweetMetrics へ渡す既定 deps（http + env mode）。 */
export function xClientDeps(): XClientDeps {
  return { http: xHttp, mode: xPostingMode() };
}

/** X 原価単価の env snapshot（要件01 §3.4, T-M3-17）。原価台帳記録（recordedXCall）に渡す。 */
export function xCostConfig(): XCostConfig {
  // 未設定（dev/preview等）は単価0とみなす。記録自体は継続する（要件04 §10・監査目的）。
  return {
    contentCreateUsd: env.X_COST_CONTENT_CREATE_USD ?? 0,
    contentCreateWithUrlUsd: env.X_COST_CONTENT_CREATE_WITH_URL_USD ?? 0,
    interactionDeleteUsd: env.X_COST_INTERACTION_DELETE_USD ?? 0,
  };
}
