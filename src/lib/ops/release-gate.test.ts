import { describe, expect, it } from "vitest";

import {
  evaluateReleaseGate,
  expectedBranchFor,
  firstStop,
  judgeLinkedProject,
  onlyMigrationsPending,
  pickCiConclusion,
  isCiSkipRequested,
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

/**
 * **CIが緑でもデプロイのbuildは別に落ちる**（T-M8-370）。2026-08-29、Vercelに
 * `OPENAI_IMAGE_MODEL` が無くbuildが3回連続で失敗していたのに、この判定が無かったため
 * 「反映と検証が完了しました」と出て**古い版が動いたまま成功に見えていた**（原則1）。
 */
describe("デプロイ（Vercel）の結果", () => {
  it("buildが失敗していたら止める", () => {
    const steps = evaluateReleaseGate({ ...ok, deployConclusion: "failure" });
    const stop = steps.find((s) => s.level === "stop");
    expect(stop?.name).toBe("デプロイ（Vercel）");
  });

  it("build中も止める（終わるまで待たせる）", () => {
    const steps = evaluateReleaseGate({ ...ok, deployConclusion: "pending" });
    expect(steps.find((s) => s.level === "stop")?.name).toBe("デプロイ（Vercel）");
  });

  it("判定できないとき（ghが無い等）は止めない", () => {
    const steps = evaluateReleaseGate({ ...ok, deployConclusion: null });
    expect(steps.find((s) => s.level === "stop")).toBeUndefined();
  });
});

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

describe("pickCiConclusion (T-M8-389)", () => {
  const sha = "abc123";
  it("PRのskippedがpushのsuccessを隠さない（新しい順の先頭がskippedでも実行結果を選ぶ）", () => {
    expect(
      pickCiConclusion(
        [
          { headSha: sha, status: "completed", conclusion: "skipped" },
          { headSha: sha, status: "completed", conclusion: "success" },
        ],
        sha,
      ),
    ).toBe("success");
  });
  it("failureはskippedより優先して伝える", () => {
    expect(
      pickCiConclusion(
        [
          { headSha: sha, status: "completed", conclusion: "skipped" },
          { headSha: sha, status: "completed", conclusion: "failure" },
        ],
        sha,
      ),
    ).toBe("failure");
  });
  it("実行中のrunがあれば結論を先取りしない", () => {
    expect(
      pickCiConclusion(
        [
          { headSha: sha, status: "in_progress", conclusion: null },
          { headSha: sha, status: "completed", conclusion: "success" },
        ],
        sha,
      ),
    ).toBe("in_progress");
  });
  it("全部skippedならskippedのまま止める（緑をでっち上げない）", () => {
    expect(
      pickCiConclusion([{ headSha: sha, status: "completed", conclusion: "skipped" }], sha),
    ).toBe("skipped");
  });
  it("該当SHAのrunが無ければnull（CIがまだ無い＝止める）", () => {
    expect(pickCiConclusion([{ headSha: "other", status: "completed", conclusion: "success" }], sha)).toBeNull();
  });
});

describe("CI の省略（[skip ci]・運営者の選択 2026-09-05）", () => {
  it("CI 結果が無くても、コミットに [skip ci] があれば「省略」として通す", () => {
    const steps = evaluateReleaseGate({ ...ok, ciConclusion: null, ciSkipRequested: true });
    const ci = steps.find((s) => s.name === "自動テスト（CI）");
    expect(ci?.level).toBe("ok");
    expect(ci?.detail).toContain("省略");
    expect(firstStop(steps)).toBeNull();
  });

  it("[skip ci] があっても、CI が走って赤なら止まる（印は結果を上書きしない）", () => {
    expect(firstStop(evaluateReleaseGate({ ...ok, ciConclusion: "failure", ciSkipRequested: true }))?.name).toBe(
      "自動テスト（CI）",
    );
  });

  it("印が無く CI 結果も無ければ従来どおり止まる", () => {
    expect(firstStop(evaluateReleaseGate({ ...ok, ciConclusion: null, ciSkipRequested: false }))?.nextAction).toContain(
      "push",
    );
  });

  it("isCiSkipRequested は GitHub 公式の5種の印を大文字小文字を問わず認識する", () => {
    for (const m of ["[skip ci]", "[ci skip]", "[no ci]", "[skip actions]", "[actions skip]", "[SKIP CI]"]) {
      expect(isCiSkipRequested(`fix: 文言 ${m}`)).toBe(true);
    }
    expect(isCiSkipRequested("fix: 文言")).toBe(false);
    expect(isCiSkipRequested("skip ci")).toBe(false);
    expect(isCiSkipRequested(null)).toBe(false);
  });
});
