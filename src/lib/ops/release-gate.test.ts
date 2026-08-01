import { describe, expect, it } from "vitest";

import {
  evaluateReleaseGate,
  expectedBranchFor,
  firstStop,
  onlyMigrationsPending,
  summarizeGate,
  type ReleaseContext,
} from "./release-gate";

/**
 * リリースゲート（T-M7-35）。24ステップの手順を人の記憶に依存させないための判定。
 * **migration適用を飛ばすとX連携が internal_error で壊れる**ので、忘れても進める形にしない。
 */

const ok: ReleaseContext = {
  target: "staging",
  expectedBranch: "stg",
  currentBranch: "stg",
  dirty: false,
  unpushed: 0,
  ciConclusion: "success",
  unappliedMigrations: [],
  baseUrl: "https://x-system-stg.vercel.app",
};

describe("expectedBranchFor", () => {
  it("staging は stg、production は main", () => {
    expect(expectedBranchFor("staging")).toBe("stg");
    expect(expectedBranchFor("production")).toBe("main");
  });
});

describe("evaluateReleaseGate", () => {
  it("すべて整っていれば止まらない", () => {
    const steps = evaluateReleaseGate(ok);
    expect(firstStop(steps)).toBeNull();
    expect(summarizeGate(steps)).toContain("すべて問題ありません");
  });

  it("未適用のmigrationがあれば止まる（警告にして進めない）", () => {
    const steps = evaluateReleaseGate({ ...ok, unappliedMigrations: ["20260801000001_x.sql"] });
    const stop = firstStop(steps);
    expect(stop?.name).toBe("データ構造の更新（migration）");
    expect(stop?.detail).toContain("20260801000001_x.sql");
    expect(stop?.nextAction).toContain("internal_error");
  });

  it("未適用のmigrationだけなら、同じコマンドで適用して進められる", () => {
    const steps = evaluateReleaseGate({ ...ok, unappliedMigrations: ["a.sql"] });
    expect(onlyMigrationsPending(steps)).toBe(true);
  });

  it("他にも止まる理由があるときは自動で進めない", () => {
    const steps = evaluateReleaseGate({ ...ok, unappliedMigrations: ["a.sql"], dirty: true });
    expect(onlyMigrationsPending(steps)).toBe(false);
  });

  it("CIが赤・実行中・見つからないときは止まる（理由ごとに次の一手が違う）", () => {
    expect(firstStop(evaluateReleaseGate({ ...ok, ciConclusion: "failure" }))?.nextAction).toContain(
      "赤いまま反映しない",
    );
    expect(
      firstStop(evaluateReleaseGate({ ...ok, ciConclusion: "in_progress" }))?.nextAction,
    ).toContain("終わるまで待って");
    expect(firstStop(evaluateReleaseGate({ ...ok, ciConclusion: null }))?.nextAction).toContain(
      "pushして",
    );
  });

  it("未pushのコミットがあれば止まる（反映されるのはリモートの内容）", () => {
    const stop = firstStop(evaluateReleaseGate({ ...ok, unpushed: 3 }));
    expect(stop?.name).toBe("未pushのコミット");
    expect(stop?.detail).toContain("3 件");
  });

  it("ブランチが違えば止まる", () => {
    const stop = firstStop(evaluateReleaseGate({ ...ok, currentBranch: "main" }));
    expect(stop?.name).toBe("ブランチ");
    expect(stop?.nextAction).toContain("git switch stg");
  });

  it("反映先のURLが未設定なら止まる（環境ごとに案内を変える）", () => {
    expect(firstStop(evaluateReleaseGate({ ...ok, baseUrl: "" }))?.nextAction).toContain(
      "STAGING_BASE_URL",
    );
    // 引数でも渡せることを案内に含める（Vercel側に設定済みでも手元のコマンドは別途知る必要がある）。
    expect(firstStop(evaluateReleaseGate({ ...ok, baseUrl: "" }))?.nextAction).toContain("--base");
    expect(
      firstStop(
        evaluateReleaseGate({
          ...ok,
          target: "production",
          expectedBranch: "main",
          currentBranch: "main",
          baseUrl: "",
        }),
      )?.nextAction,
    ).toContain("PRODUCTION_BASE_URL");
  });

  it("止まった理由は運営者が読める1文になる", () => {
    const steps = evaluateReleaseGate({ ...ok, ciConclusion: "failure" });
    expect(summarizeGate(steps)).toBe("「自動テスト（CI）」で止まりました: 結果が failure です");
  });
});
