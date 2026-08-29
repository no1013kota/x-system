import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/observability/errors";

import {
  assertExecutionPrerequisites,
  assertPrereqsFromInput,
  buildSetupChecklist,
  checkExecutionPrerequisites,
  checkPostingPrerequisites,
  resolveExecutionPrereqError,
  type ExecutionPrereqInput,
} from "./execution-prereqs";

/** A fully-satisfied BYOK (standard) baseline; override per case. */
function byok(over: Partial<ExecutionPrereqInput> = {}): ExecutionPrereqInput {
  return {
    plan: "standard",
    subscriptionStatus: "active",
    xApiKeyStatus: "valid",
    hasActiveXAccount: true,
    textAiKeyValid: true,
    imageRequested: false,
    imageAiKeyValid: false,
    baseMdVersion: 1,
    ...over,
  };
}

function premium(over: Partial<ExecutionPrereqInput> = {}): ExecutionPrereqInput {
  return {
    plan: "premium",
    subscriptionStatus: "active",
    xApiKeyStatus: null, // premium does not register an X key
    hasActiveXAccount: true,
    textAiKeyValid: false, // uses operator Claude
    imageRequested: false,
    imageAiKeyValid: false,
    baseMdVersion: 1,
    ...over,
  };
}

describe("checkExecutionPrerequisites — BYOK", () => {
  it("passes when all prerequisites are satisfied", () => {
    expect(checkExecutionPrerequisites(byok())).toBeNull();
  });

  it("blocks on a non-executable subscription first", () => {
    const r = checkExecutionPrerequisites(
      byok({ subscriptionStatus: "past_due", xApiKeyStatus: null }),
    );
    expect(r?.code).toBe("subscription_required");
    expect(r?.missing[0]).toBe("subscription");
    expect(r?.missing).toContain("x_api_key");
    expect(r?.settingsPath).toBe("/app/settings?tab=billing");
  });

  it("requires the X API key when unregistered or invalid", () => {
    for (const status of [null, "invalid"]) {
      const r = checkExecutionPrerequisites(byok({ xApiKeyStatus: status }));
      expect(r?.code).toBe("api_key_required");
      expect(r?.missing).toEqual(["x_api_key"]);
      expect(r?.settingsPath).toBe("/app/settings?tab=api-keys");
    }
  });

  it("accepts an unchecked (registered) X API key", () => {
    expect(checkExecutionPrerequisites(byok({ xApiKeyStatus: "unchecked" }))).toBeNull();
  });

  it("requires an active X account", () => {
    const r = checkExecutionPrerequisites(byok({ hasActiveXAccount: false }));
    expect(r?.code).toBe("x_account_required");
    expect(r?.settingsPath).toBe("/app/settings?tab=x-accounts");
  });

  it("requires a valid text AI key", () => {
    const r = checkExecutionPrerequisites(byok({ textAiKeyValid: false }));
    expect(r?.code).toBe("api_key_required");
    expect(r?.missing).toEqual(["text_ai_key"]);
  });

  it("requires the image AI key only when image is requested", () => {
    expect(
      checkExecutionPrerequisites(byok({ imageRequested: false, imageAiKeyValid: false })),
    ).toBeNull();
    const r = checkExecutionPrerequisites(
      byok({ imageRequested: true, imageAiKeyValid: false }),
    );
    expect(r?.code).toBe("api_key_required");
    expect(r?.missing).toEqual(["image_ai_key"]);
  });

  /**
   * T-M8-337・運営者の指示 2026-08-27。**アカウント設定が未保存でも生成できる。**
   * アカウント.mdは「誰として書くか」を鮮明にする補助であって、無ければ作れないものではない。
   * 登録直後に設定を全部埋めさせる足止めの方が害が大きい。
   */
  it("アカウント設定が未保存でも生成をブロックしない", () => {
    expect(checkExecutionPrerequisites(byok({ baseMdVersion: 0 }))).toBeNull();
  });

  /**
   * T-M8-337。**生成の前提から外しても、初期設定ガイドからは消さない。**
   * 前提の判定結果をそのままガイドに使うと、未保存なのに「完了」と表示されて
   * 設定へ辿り着く導線が消える（実際にE2Eがこれを検出した）。
   */
  it("生成の前提から外しても、初期設定ガイドには未完了として残る", () => {
    const items = buildSetupChecklist(byok({ baseMdVersion: 0 }));
    const persona = items.find((i) => i.item === "persona");
    expect(persona?.satisfied, "アカウント設定がガイドから消えている").toBe(false);
  });

  it("collects all missing items in precedence order", () => {
    const r = checkExecutionPrerequisites({
      plan: "standard",
      subscriptionStatus: "canceled",
      xApiKeyStatus: null,
      hasActiveXAccount: false,
      textAiKeyValid: false,
      imageRequested: true,
      imageAiKeyValid: false,
      baseMdVersion: 0,
    });
    expect(r?.missing).toEqual([
      "subscription",
      "x_api_key",
      "x_account",
      "text_ai_key",
      "image_ai_key",
    ]);
    expect(r?.code).toBe("subscription_required"); // primary = first
  });
});

describe("checkExecutionPrerequisites — premium", () => {
  it("passes without X/AI keys (operator app + operator Claude)", () => {
    expect(checkExecutionPrerequisites(premium())).toBeNull();
  });

  /**
   * expert も運営キー系（T-M8-168）。判定が `plan === "premium"` のままだと expert がBYOK扱いに
   * なり、¥14,800のプランで生成・投稿が全滅する（レビューで検出。isOperatorManagedPlanで判定する）。
   */
  it("expert もX/AIキーなしで通る（運営キー系はplans.tsのusageLimitsで判定）", () => {
    expect(checkExecutionPrerequisites(premium({ plan: "expert" }))).toBeNull();
    expect(checkPostingPrerequisites(premium({ plan: "expert" }))).toBeNull();
    // 初期設定ガイドも運営キー系の2項目（X連携・アカウント設定）になる。
    expect(buildSetupChecklist(premium({ plan: "expert" })).map((i) => i)).toEqual(
      buildSetupChecklist(premium()),
    );
  });

  it("does not require X/AI keys even when unset or image is requested", () => {
    expect(
      checkExecutionPrerequisites(
        premium({ xApiKeyStatus: null, textAiKeyValid: false, imageRequested: true, imageAiKeyValid: false }),
      ),
    ).toBeNull();
  });

  it("契約とX連携は引き続き必要（アカウント設定は必須ではない）", () => {
    expect(checkExecutionPrerequisites(premium({ subscriptionStatus: "unpaid" }))?.code).toBe(
      "subscription_required",
    );
    expect(checkExecutionPrerequisites(premium({ hasActiveXAccount: false }))?.code).toBe(
      "x_account_required",
    );
    // アカウント設定は前提から外れた（T-M8-337）。初期設定ガイドでは案内し続ける。
    expect(checkExecutionPrerequisites(premium({ baseMdVersion: 0 }))).toBeNull();
  });
});

describe("buildSetupChecklist", () => {
  const items = (list: { item: string }[]) => list.map((i) => i.item);

  it("BYOK lists the 4 setup items, all satisfied when fully set up", () => {
    const list = buildSetupChecklist(byok());
    expect(items(list)).toEqual(["x_api_key", "x_account", "text_ai_key", "persona"]);
    expect(list.every((i) => i.satisfied)).toBe(true);
  });

  it("marks unsatisfied items and links each to a settings path", () => {
    const list = buildSetupChecklist(
      byok({ xApiKeyStatus: null, hasActiveXAccount: false }),
    );
    const key = list.find((i) => i.item === "x_api_key")!;
    const account = list.find((i) => i.item === "x_account")!;
    expect(key.satisfied).toBe(false);
    expect(key.settingsPath).toBe("/app/settings?tab=api-keys");
    expect(account.satisfied).toBe(false);
    expect(account.settingsPath).toBe("/app/settings?tab=x-accounts");
  });

  it("shows the guide when there is no active X account candidate", () => {
    const list = buildSetupChecklist(byok({ hasActiveXAccount: false }));
    expect(list.some((i) => !i.satisfied)).toBe(true);
  });

  it("premium excludes the key items (only X connection + persona)", () => {
    const list = buildSetupChecklist(premium());
    expect(items(list)).toEqual(["x_account", "persona"]);
    expect(list.every((i) => i.satisfied)).toBe(true); // fully set-up premium hides the guide
  });

  it("ignores image key state (image is optional for the guide)", () => {
    const list = buildSetupChecklist(byok({ imageRequested: true, imageAiKeyValid: false }));
    expect(list.every((i) => i.satisfied)).toBe(true);
    expect(items(list)).not.toContain("image_ai_key");
  });

  it("points to the AI purpose tab when the key is valid but no text provider is assigned", () => {
    // キーは登録・確認済みでも AI用途 未割り当てなら textAiKeyValid は false。APIキー画面へ
    // 戻しても「確認済み」と出るだけで進めないため、割り当て画面へ誘導する。
    const list = buildSetupChecklist(
      byok({
        textAiKeyValid: false,
        textProviderAssigned: false,
        hasValidTextCapableKey: true,
      }),
    );
    const textKey = list.find((i) => i.item === "text_ai_key")!;
    expect(textKey.satisfied).toBe(false);
    expect(textKey.label).toBe("文章AIの割り当て");
    expect(textKey.settingsPath).toBe("/app/settings?tab=purposes");
  });

  it("keeps pointing to the API key tab when no valid AI key exists yet", () => {
    // 未割り当てでも、そもそも有効なキーが無いならAPIキー登録が先。
    const list = buildSetupChecklist(
      byok({
        textAiKeyValid: false,
        textProviderAssigned: false,
        hasValidTextCapableKey: false,
      }),
    );
    const textKey = list.find((i) => i.item === "text_ai_key")!;
    expect(textKey.label).toBe("文章AIキー");
    expect(textKey.settingsPath).toBe("/app/settings?tab=api-keys");
  });

  it("gives every item a one-line description", () => {
    for (const item of buildSetupChecklist(byok({ hasActiveXAccount: false }))) {
      expect(item.description.length).toBeGreaterThan(0);
    }
  });
});

describe("assertExecutionPrerequisites", () => {
  it("does nothing when satisfied", () => {
    expect(() => assertExecutionPrerequisites(byok())).not.toThrow();
  });
  it("throws an AppError with the code and details when unmet", () => {
    try {
      assertExecutionPrerequisites(byok({ hasActiveXAccount: false }));
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.code).toBe("x_account_required");
      expect(err.details?.settingsPath).toBe("/app/settings?tab=x-accounts");
      expect(err.details?.missing).toEqual(["x_account"]);
    }
  });
});

/**
 * 「そもそも読めなかった」場合の扱い（R27）。
 *
 * `gatherPrereqInputs` は対象が見つからないと `null` を返す。その代替値
 * `{ code: "not_found", missing: [], settingsPath: "/app" }` は以前**呼び出し側4箇所が
 * それぞれ書いていた**ため、扱いを変えるときに1つ忘れると経路によって別のエラーが出た。
 * この経路のテストが無かったので、ここで固定する。
 */
describe("resolveExecutionPrereqError（input=null を含む）", () => {
  it("input が null なら not_found（不足項目は空・導線はホーム）", () => {
    expect(resolveExecutionPrereqError(null)).toEqual({
      code: "not_found",
      missing: [],
      settingsPath: "/app",
    });
  });

  it("input があれば通常の判定へ委ねる", () => {
    expect(resolveExecutionPrereqError(byok())).toBeNull();
    expect(resolveExecutionPrereqError(byok({ hasActiveXAccount: false }))).toEqual({
      code: "x_account_required",
      missing: ["x_account"],
      settingsPath: "/app/settings?tab=x-accounts",
    });
  });

  it("判定関数を差し替えれば投稿前提にも使える（文章AIキー不足では止めない）", () => {
    const noTextKey = byok({ textAiKeyValid: false });
    expect(resolveExecutionPrereqError(noTextKey)?.code).toBe("api_key_required");
    expect(resolveExecutionPrereqError(noTextKey, checkPostingPrerequisites)).toBeNull();
  });
});

describe("assertPrereqsFromInput", () => {
  it("null のときも AppError を投げる（黙って通さない）", () => {
    expect(() => assertPrereqsFromInput(null)).toThrow(AppError);
    try {
      assertPrereqsFromInput(null);
    } catch (e) {
      const err = e as AppError;
      expect(err.code).toBe("not_found");
      expect(err.details?.missing).toEqual([]);
      expect(err.details?.settingsPath).toBe("/app");
    }
  });

  it("充足していれば投げない", () => {
    expect(() => assertPrereqsFromInput(byok())).not.toThrow();
  });
});

describe("契約の期限切れ（webhook未達）を実行前提で止める（T-M8-235）", () => {
  const base = {
    plan: "premium" as const,
    subscriptionStatus: "trialing",
    xApiKeyStatus: "valid",
    hasActiveXAccount: true,
    textAiKeyValid: true,
    imageRequested: false,
    imageAiKeyValid: true,
    baseMdVersion: 1,
  };

  it("期限を渡さなければ従来どおり通る", () => {
    expect(checkExecutionPrerequisites(base)).toBeNull();
    expect(checkPostingPrerequisites(base)).toBeNull();
  });

  it("トライアル期限を大きく過ぎていたら subscription 不足として止める", () => {
    const stale = { ...base, trialEndsAt: "2020-01-01T00:00:00Z" };
    expect(checkExecutionPrerequisites(stale)).toMatchObject({
      code: "subscription_required",
      missing: ["subscription"],
    });
    expect(checkPostingPrerequisites(stale)).toMatchObject({ code: "subscription_required" });
  });

  it("期限が未来なら止めない（猶予の内側でも止めない）", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(checkExecutionPrerequisites({ ...base, trialEndsAt: future })).toBeNull();
    const justEnded = new Date(Date.now() - 3_600_000).toISOString();
    expect(
      checkExecutionPrerequisites({ ...base, subscriptionStatus: "active", currentPeriodEnd: justEnded }),
      "更新直後の数時間で支払い済みの利用者を締め出さない",
    ).toBeNull();
  });
})
