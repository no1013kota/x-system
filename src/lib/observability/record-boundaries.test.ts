import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「未知のエラーが利用者向け結果に変換される境界で必ず記録される」ことを固定する（要件01 §8）。
 *
 * Next.js の `onRequestError`（src/instrumentation.ts）は throw された例外だけを Sentry へ送るため、
 * catch して値を返す共通出口（Server Action の `errorResult` / API Route の `apiError` / job の
 * `failJob`）では発火しない。そこが沈黙すると原因が画面にもログにもDBにも残らない
 * （2026-07-26 のX連携不具合が追跡不能になった原因）。この性質はテストが無いと簡単に戻るため固定する。
 *
 * AppError（仕様どおりの分岐）は記録しないことも併せて検証する。記録すると本物の異常が埋もれる。
 */

const { recordUnexpectedError } = vi.hoisted(() => ({
  recordUnexpectedError: vi.fn(),
}));
vi.mock("@/lib/observability/sentry", () => ({ recordUnexpectedError }));
// getCurrentUser は _helpers の import 連鎖に入るだけで本テストでは使わない。
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => null }));

import { errorResult } from "@/app/actions/_helpers";
import { apiError } from "@/lib/http/api-response";
import { AppError } from "@/lib/observability/errors";

describe("未知エラーの記録（共通出口）", () => {
  beforeEach(() => {
    recordUnexpectedError.mockClear();
  });

  describe("errorResult（Server Action の共通出口）", () => {
    it("未知の例外は internal_error にしつつ記録する", () => {
      const boom = new Error("db permission denied");
      const result = errorResult(boom);

      expect(result.status).toBe("error");
      expect(result.code).toBe("internal_error");
      expect(recordUnexpectedError).toHaveBeenCalledTimes(1);
      expect(recordUnexpectedError.mock.calls[0][0]).toBe(boom);
      expect(recordUnexpectedError.mock.calls[0][1]).toMatchObject({ at: "server-action" });
    });

    it("AppError は記録しない（仕様どおりの分岐）", () => {
      for (const code of ["unauthorized", "validation_error", "usage_limit_exceeded"] as const) {
        errorResult(new AppError(code));
      }
      expect(recordUnexpectedError).not.toHaveBeenCalled();
    });

    it("例外の生メッセージを利用者向け結果へ漏らさない", () => {
      const result = errorResult(new Error("postgres://user:pw@host で 42501"));
      expect(result.message).not.toContain("42501");
      expect(result.message).not.toContain("postgres");
    });
  });

  describe("apiError（API Route の共通出口）", () => {
    it("未知の例外を記録し、500 で返す", () => {
      const boom = new Error("unexpected");
      const res = apiError(boom);

      expect(res.status).toBe(500);
      expect(recordUnexpectedError).toHaveBeenCalledTimes(1);
      // どの種類で記録したかを `at` に残す（T-M8-128でprovider_errorも記録対象にしたため）。
      expect(recordUnexpectedError.mock.calls[0][1]).toMatchObject({
        at: "api-route:internal_error",
      });
    });

    /**
     * 外部サービスの失敗も記録する（T-M8-128）。
     *
     * `provider_error` は「外部サービスとの通信に失敗しました」という汎用文で返るだけで、
     * **理由がどこにも残らなかった**。2026-08-18、ローカルでプラン管理が開けない原因を
     * 突き止めるのにこれが妨げになった（Stripeの応答を誰も見ていない・原則2違反）。
     * 設定ミスのように待っても直らない失敗ほど、原因が残っていないと辿れない。
     */
    it("provider_error も記録する（外部サービスの理由を捨てない）", () => {
      const cause = new Error("No such configuration: bpc_xxx");
      const res = apiError(new AppError("provider_error", { cause }));

      expect(res.status).toBe(502);
      expect(recordUnexpectedError).toHaveBeenCalledTimes(1);
      expect(recordUnexpectedError.mock.calls[0][1]).toMatchObject({
        at: "api-route:provider_error",
      });
    });

    it("それ以外の AppError は記録せず、対応する HTTP status を返す", () => {
      expect(apiError(new AppError("unauthorized")).status).toBe(401);
      expect(apiError(new AppError("validation_error")).status).toBe(400);
      expect(recordUnexpectedError).not.toHaveBeenCalled();
    });
  });
});
