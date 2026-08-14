import { describe, expect, it } from "vitest";

import {
  allowsUrl,
  AUTH_URL_CHECK_NAME,
  confirmRedirectUrl,
  isRedirectAllowed,
  judgeAuthUrls,
  parseAllowList,
  sameOrigin,
  unknownAuthUrls,
} from "./auth-url-status";

/**
 * 登録・再設定メールの行き先の判定（T-M8-90）。
 *
 * 2026-08-14 に本番で実際に起きた状態をそのままfixtureにする。Site URL が既定の
 * `http://localhost:3000`、許可リストもlocalhostのみで、**確認メールのリンクが localhost を指し
 * 登録を完了できなかった**。Supabaseはこれをエラーにせず黙って差し替えるため、
 * アプリ側の応答は成功で返っていた。
 */

/** 2026-08-14 の本番の状態（Supabaseプロジェクト作成時の既定）。 */
const BROKEN = {
  appBaseUrl: "https://exosai.net",
  siteUrl: "http://localhost:3000",
  uriAllowList: ["http://localhost:3000/**"],
};

/** 直したあとの状態。 */
const FIXED = {
  appBaseUrl: "https://exosai.net",
  siteUrl: "https://exosai.net",
  uriAllowList: ["https://exosai.net/**"],
};

describe("confirmRedirectUrl", () => {
  it("`app/actions/auth.ts` と同じURLを作る", () => {
    expect(confirmRedirectUrl("https://exosai.net")).toBe("https://exosai.net/auth/confirm");
  });

  it("末尾スラッシュ付きでも同じ", () => {
    expect(confirmRedirectUrl("https://exosai.net/")).toBe("https://exosai.net/auth/confirm");
  });
});

describe("allowsUrl（Supabaseのワイルドカード）", () => {
  const target = "https://exosai.net/auth/confirm";

  it("`**` はパス区切りを越えて一致する", () => {
    expect(allowsUrl("https://exosai.net/**", target)).toBe(true);
  });

  it("`*` はパス区切りを越えない（`/auth/confirm` には届かない）", () => {
    // ここを緩く判定すると、実際には許されていない行き先を「許されている」と誤って報告する。
    expect(allowsUrl("https://exosai.net/*", target)).toBe(false);
  });

  it("完全一致のエントリも許す", () => {
    expect(allowsUrl(target, target)).toBe(true);
  });

  it("別ホストは許さない", () => {
    expect(allowsUrl("http://localhost:3000/**", target)).toBe(false);
  });

  it("ドットをワイルドカードとして扱わない（`exosai.net` が `exosaiXnet` に一致しない）", () => {
    expect(allowsUrl("https://exosai.net/**", "https://exosaiXnet/auth/confirm")).toBe(false);
  });

  it("部分一致で許さない（前方・後方の取りこぼしを防ぐ）", () => {
    expect(allowsUrl("https://exosai.net/auth", target)).toBe(false);
    expect(allowsUrl("https://evil.example/https://exosai.net/**", target)).toBe(false);
  });

  it("スキームの違いを見分ける", () => {
    expect(allowsUrl("http://exosai.net/**", target)).toBe(false);
  });
});

describe("isRedirectAllowed", () => {
  it("どれか1つが許せばよい", () => {
    expect(
      isRedirectAllowed(
        ["http://localhost:3000/**", "https://exosai.net/**"],
        "https://exosai.net/auth/confirm",
      ),
    ).toBe(true);
  });

  it("前後の空白を無視する（Dashboardの入力で混ざる）", () => {
    expect(
      isRedirectAllowed([" https://exosai.net/** "], "https://exosai.net/auth/confirm"),
    ).toBe(true);
  });

  it("空の許可リストは許さない", () => {
    expect(isRedirectAllowed([], "https://exosai.net/auth/confirm")).toBe(false);
  });
});

describe("parseAllowList", () => {
  it("Management APIのカンマ区切り文字列を配列にする", () => {
    expect(parseAllowList("https://exosai.net/**,http://localhost:3000/**")).toEqual([
      "https://exosai.net/**",
      "http://localhost:3000/**",
    ]);
  });

  it("配列で返ってきてもそのまま扱う", () => {
    expect(parseAllowList(["https://exosai.net/**"])).toEqual(["https://exosai.net/**"]);
  });

  it("空文字を要素として数えない（空の許可リストを1件と誤認しない）", () => {
    expect(parseAllowList("")).toEqual([]);
    expect(parseAllowList(",  ,")).toEqual([]);
  });

  it("想定外の型は空配列（許可されていると誤判定しない）", () => {
    expect(parseAllowList(null)).toEqual([]);
    expect(parseAllowList(undefined)).toEqual([]);
    expect(parseAllowList(42)).toEqual([]);
  });
});

describe("sameOrigin", () => {
  it("末尾スラッシュの差を無視する", () => {
    expect(sameOrigin("https://exosai.net/", "https://exosai.net")).toBe(true);
  });

  it("ポートの違いを見分ける", () => {
    expect(sameOrigin("http://localhost:3000", "http://localhost:54321")).toBe(false);
  });

  it("URLとして読めない値は一致にしない", () => {
    expect(sameOrigin("exosai.net", "https://exosai.net")).toBe(false);
  });
});

describe("judgeAuthUrls", () => {
  it("2026-08-14 の本番の状態を error として、差し替え先まで名指しする", () => {
    const check = judgeAuthUrls(BROKEN);
    expect(check.level).toBe("error");
    expect(check.name).toBe(AUTH_URL_CHECK_NAME);
    // 「どこへ飛ぶか」を書く。これが無いと運営者は何が起きているか分からない。
    expect(check.detail).toContain("http://localhost:3000");
    expect(check.detail).toContain("https://exosai.net/auth/confirm");
    expect(check.nextAction).toContain("https://exosai.net/**");
    expect(check.nextAction).toContain("Redirect URLs");
  });

  it("直った状態は ok", () => {
    const check = judgeAuthUrls(FIXED);
    expect(check.level).toBe("ok");
    expect(check.detail).toContain("https://exosai.net/auth/confirm");
  });

  it("許可リストは合っているが Site URL が違うときは warn（メールは届くが取りこぼしが残る）", () => {
    const check = judgeAuthUrls({
      appBaseUrl: "https://exosai.net",
      siteUrl: "http://localhost:3000",
      uriAllowList: ["https://exosai.net/**"],
    });
    expect(check.level).toBe("warn");
    expect(check.nextAction).toContain("Site URL");
  });

  it("Site URL が未設定でも許可リストが無ければ error（未設定を素通りさせない）", () => {
    const check = judgeAuthUrls({
      appBaseUrl: "https://exosai.net",
      siteUrl: null,
      uriAllowList: [],
    });
    expect(check.level).toBe("error");
    expect(check.detail).toContain("(未設定)");
  });

  it("ローカル開発の組み合わせも ok（同じ判定で両方を見る）", () => {
    expect(
      judgeAuthUrls({
        appBaseUrl: "http://127.0.0.1:3000",
        siteUrl: "http://127.0.0.1:3000",
        uriAllowList: ["http://localhost:3000/**", "http://127.0.0.1:3000/**"],
      }).level,
    ).toBe("ok");
  });
});

describe("unknownAuthUrls", () => {
  it("トークンが無いときは warn で、ok にしない", () => {
    // 「確認できません」を ✅ にすると、壊れていても緑に見える（CLAUDE.md 原則1）。
    const check = unknownAuthUrls("SUPABASE_ACCESS_TOKEN が無い");
    expect(check.level).toBe("warn");
    expect(check.detail).toContain("確認できません");
    expect(check.nextAction).toContain("SUPABASE_ACCESS_TOKEN");
  });
});
