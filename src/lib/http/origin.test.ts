import { describe, expect, it } from "vitest";

import { hasExactAppOrigin } from "./origin";

describe("hasExactAppOrigin", () => {
  it("accepts only the canonical application origin", () => {
    expect(hasExactAppOrigin("https://app.example.com", "https://app.example.com")).toBe(
      true,
    );
    expect(
      hasExactAppOrigin("https://app.example.com", "https://app.example.com/path"),
    ).toBe(true);
  });

  it("rejects missing, malformed, or merely prefixed origins", () => {
    expect(hasExactAppOrigin(null, "https://app.example.com")).toBe(false);
    expect(hasExactAppOrigin("https://app.example.com/", "https://app.example.com")).toBe(
      false,
    );
    expect(
      hasExactAppOrigin("https://app.example.com.evil.test", "https://app.example.com"),
    ).toBe(false);
    expect(hasExactAppOrigin("https://app.example.com", "not-a-url")).toBe(false);
  });
});

/**
 * ローカル開発での 127.0.0.1 ⇄ localhost（T-M8-128）。
 *
 * `APP_BASE_URL` はローカルで `127.0.0.1`（X OAuthが`localhost`を許さない）。
 * ブラウザで `localhost` を開くとOriginが一致せず、決済もプラン管理も403で失敗し、
 * 画面には「時間をおいてもう一度」と出た（待っても直らない）。忘れても壊れない形にする。
 *
 * **本番の守りは緩めない**ことをここで固定する。
 */
describe("ローカル開発のループバック", () => {
  const local = "http://127.0.0.1:3000";

  it("127.0.0.1 と localhost を同じものとして受ける", () => {
    expect(hasExactAppOrigin("http://localhost:3000", local)).toBe(true);
    expect(hasExactAppOrigin("http://127.0.0.1:3000", "http://localhost:3000")).toBe(true);
    expect(hasExactAppOrigin("http://[::1]:3000", local)).toBe(true);
  });

  it("ポートは区別する（別のアプリなので）", () => {
    expect(hasExactAppOrigin("http://localhost:3001", local)).toBe(false);
    expect(hasExactAppOrigin("http://localhost", local)).toBe(false);
  });

  it("スキームは区別する", () => {
    expect(hasExactAppOrigin("https://localhost:3000", local)).toBe(false);
  });

  /** ここが緩むと本番でCSRFの入口になる。 */
  it("本番のオリジンにループバックを混ぜられない", () => {
    const prod = "https://exosai.net";
    for (const attacker of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://localhost",
      "https://exosai.net.evil.test",
      "http://exosai.net",
    ]) {
      expect(hasExactAppOrigin(attacker, prod), `${attacker} を拒否する`).toBe(false);
    }
    expect(hasExactAppOrigin(prod, prod)).toBe(true);
  });

  it("ループバックの設定に本番オリジンを混ぜられない", () => {
    expect(hasExactAppOrigin("https://exosai.net", local)).toBe(false);
    // ホスト名に localhost を含むだけの別ドメインを通さない。
    expect(hasExactAppOrigin("http://localhost.evil.test:3000", local)).toBe(false);
    expect(hasExactAppOrigin("http://127.0.0.1.evil.test:3000", local)).toBe(false);
  });
});
