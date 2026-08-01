import { describe, expect, it } from "vitest";

import {
  evaluateReleaseGate,
  expectedBranchFor,
  firstStop,
  judgeLinkedProject,
  onlyMigrationsPending,
  projectRefFromCsp,
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
  linkedProjectRef: "uykffujqpsogqffbnsrz",
  targetProjectRef: "uykffujqpsogqffbnsrz",
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

describe("projectRefFromCsp", () => {
  it("CSPからSupabaseプロジェクトのrefを読む", () => {
    const csp =
      "default-src 'self'; connect-src 'self' https://uykffujqpsogqffbnsrz.supabase.co https://challenges.cloudflare.com";
    expect(projectRefFromCsp(csp)).toBe("uykffujqpsogqffbnsrz");
  });

  it("Supabaseが含まれない・空・未設定なら null", () => {
    expect(projectRefFromCsp("default-src 'self'")).toBeNull();
    expect(projectRefFromCsp("")).toBeNull();
    expect(projectRefFromCsp(null)).toBeNull();
    expect(projectRefFromCsp(undefined)).toBeNull();
  });
});

describe("judgeLinkedProject", () => {
  const target = "staging" as const;

  it("一致していれば通す", () => {
    const step = judgeLinkedProject({ target, linkedProjectRef: "a".repeat(20), targetProjectRef: "a".repeat(20) });
    expect(step.level).toBe("ok");
  });

  it("**別のプロジェクトに繋がっていたら止める**（本番DBを更新する事故を防ぐ）", () => {
    const step = judgeLinkedProject({
      target,
      linkedProjectRef: "b".repeat(20),
      targetProjectRef: "a".repeat(20),
    });
    expect(step.level).toBe("stop");
    expect(step.detail).toContain("b".repeat(20));
    expect(step.detail).toContain("a".repeat(20));
    expect(step.nextAction).toContain(`supabase link --project-ref ${"a".repeat(20)}`);
  });

  it("未リンクなら止め、繋ぐ先を具体的に示す", () => {
    const step = judgeLinkedProject({ target, linkedProjectRef: null, targetProjectRef: "a".repeat(20) });
    expect(step.level).toBe("stop");
    expect(step.nextAction).toContain("a".repeat(20));
  });

  it("反映先のプロジェクトが判定できなければ止める（安全側）", () => {
    for (const linked of [null, "a".repeat(20)]) {
      const step = judgeLinkedProject({ target, linkedProjectRef: linked, targetProjectRef: null });
      expect(step.level).toBe("stop");
    }
  });
});

describe("接続先の取り違えとmigration適用の関係", () => {
  it("接続先が違うと、未適用migrationがあっても --apply では進めない", () => {
    const steps = evaluateReleaseGate({
      ...ok,
      unappliedMigrations: ["20260801000001_x.sql"],
      linkedProjectRef: "z".repeat(20),
    });
    // stop が2つになるため onlyMigrationsPending が false になり、--apply が効かない。
    expect(onlyMigrationsPending(steps)).toBe(false);
    expect(firstStop(steps)?.name).toBe("データベースの接続先");
  });
});
