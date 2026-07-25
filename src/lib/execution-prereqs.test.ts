import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/observability/errors";

import {
  assertExecutionPrerequisites,
  buildSetupChecklist,
  checkExecutionPrerequisites,
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

  it("requires persona (base_md_version >= 1)", () => {
    const r = checkExecutionPrerequisites(byok({ baseMdVersion: 0 }));
    expect(r?.code).toBe("persona_required");
    expect(r?.settingsPath).toBe("/app/ai-settings");
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
      "persona",
    ]);
    expect(r?.code).toBe("subscription_required"); // primary = first
  });
});

describe("checkExecutionPrerequisites — premium", () => {
  it("passes without X/AI keys (operator app + operator Claude)", () => {
    expect(checkExecutionPrerequisites(premium())).toBeNull();
  });

  it("does not require X/AI keys even when unset or image is requested", () => {
    expect(
      checkExecutionPrerequisites(
        premium({ xApiKeyStatus: null, textAiKeyValid: false, imageRequested: true, imageAiKeyValid: false }),
      ),
    ).toBeNull();
  });

  it("still requires subscription, X connection, and persona", () => {
    expect(checkExecutionPrerequisites(premium({ subscriptionStatus: "unpaid" }))?.code).toBe(
      "subscription_required",
    );
    expect(checkExecutionPrerequisites(premium({ hasActiveXAccount: false }))?.code).toBe(
      "x_account_required",
    );
    expect(checkExecutionPrerequisites(premium({ baseMdVersion: 0 }))?.code).toBe(
      "persona_required",
    );
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
    expect(textKey.settingsPath).toBe("/app/ai-settings?tab=purposes");
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
