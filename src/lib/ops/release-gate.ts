/**
 * リリース手順のゲート判定（T-M7-35）。`CLAUDE.md`「前提：運営者は個人」原則3に対応する。
 *
 * `deployment.md` の手順は24ステップあり、**migration適用（`supabase db push`）を飛ばすと
 * X連携が `internal_error` で壊れる**。この「忘れたら壊れる」を人間の記憶に依存させないため、
 * 判定をコードへ落として `npm run release:staging` / `release:production` が順番を強制する。
 *
 * ここは純粋関数だけを置く（gitやGitHub APIの呼び出しは `scripts/release.mjs` 側）。
 */

export type GateLevel = "ok" | "stop";

export interface GateStep {
  /** 運営者が読む見出し。 */
  name: string;
  level: GateLevel;
  /** いまの状態。数字や値を必ず入れる。 */
  detail: string;
  /** `stop` のときに次にやること。 */
  nextAction?: string;
}

export interface ReleaseContext {
  /** 反映先。 */
  target: "staging" | "production";
  /** 期待するブランチ（staging=stg / production=main）。 */
  expectedBranch: string;
  currentBranch: string;
  /** 未コミットの変更があるか。 */
  dirty: boolean;
  /** リモートへ push していないコミット数。 */
  unpushed: number;
  /** GitHub Actions の結論（`success` / `failure` / `in_progress` / null=見つからない）。 */
  ciConclusion: string | null;
  /** 未適用の migration ファイル名（空なら適用済み）。 */
  unappliedMigrations: string[];
  /** 反映先のURL（未設定なら空文字）。 */
  baseUrl: string;
}

/** 期待ブランチ。 */
export function expectedBranchFor(target: "staging" | "production"): string {
  return target === "staging" ? "stg" : "main";
}

/**
 * 反映してよいかを順に判定する。**最初の `stop` で止める**前提で並べる。
 *
 * 「未適用のmigrationがある」は `stop` にする（適用は同じコマンドの次の段でやる）。
 * 警告にして進めると、忘れたときと同じ結果になる。
 */
export function evaluateReleaseGate(ctx: ReleaseContext): GateStep[] {
  const steps: GateStep[] = [];

  steps.push(
    ctx.currentBranch === ctx.expectedBranch
      ? { name: "ブランチ", level: "ok", detail: `${ctx.currentBranch}（期待どおり）` }
      : {
          name: "ブランチ",
          level: "stop",
          detail: `いまは ${ctx.currentBranch} ですが、${ctx.target} は ${ctx.expectedBranch} から反映します`,
          nextAction: `git switch ${ctx.expectedBranch} で切り替えてください`,
        },
  );

  steps.push(
    ctx.dirty
      ? {
          name: "未コミットの変更",
          level: "stop",
          detail: "コミットしていない変更があります",
          nextAction: "変更をコミットするか元に戻してください（反映されるのはコミット済みの内容だけです）",
        }
      : { name: "未コミットの変更", level: "ok", detail: "ありません" },
  );

  steps.push(
    ctx.unpushed > 0
      ? {
          name: "未pushのコミット",
          level: "stop",
          detail: `${ctx.unpushed} 件がリモートにありません`,
          nextAction: `git push origin ${ctx.expectedBranch} を実行してください（反映されるのはリモートの内容です）`,
        }
      : { name: "未pushのコミット", level: "ok", detail: "ありません" },
  );

  if (ctx.ciConclusion === "success") {
    steps.push({ name: "自動テスト（CI）", level: "ok", detail: "緑です" });
  } else if (ctx.ciConclusion === null) {
    steps.push({
      name: "自動テスト（CI）",
      level: "stop",
      detail: "このコミットのCI結果が見つかりません",
      nextAction: "pushしてCIが走るのを待ってください（GitHub Actionsのページで確認できます）",
    });
  } else if (ctx.ciConclusion === "in_progress" || ctx.ciConclusion === "queued") {
    steps.push({
      name: "自動テスト（CI）",
      level: "stop",
      detail: "まだ実行中です",
      nextAction: "終わるまで待ってから、もう一度このコマンドを実行してください",
    });
  } else {
    steps.push({
      name: "自動テスト（CI）",
      level: "stop",
      detail: `結果が ${ctx.ciConclusion} です`,
      nextAction: "赤いまま反映しないでください。Claudeに「CIの失敗原因を調べて」と伝えてください",
    });
  }

  steps.push(
    ctx.baseUrl
      ? { name: "反映先のURL", level: "ok", detail: ctx.baseUrl }
      : {
          name: "反映先のURL",
          level: "stop",
          detail: `${ctx.target} のURLが設定されていません`,
          nextAction:
            ctx.target === "staging"
              ? "`-- --base https://<stagingのURL>` を付けるか、`.env.local` へ STAGING_BASE_URL を設定してください"
              : "`-- --base https://<本番のURL>` を付けるか、`.env.local` へ PRODUCTION_BASE_URL を設定してください",
        },
  );

  steps.push(
    ctx.unappliedMigrations.length > 0
      ? {
          name: "データ構造の更新（migration）",
          level: "stop",
          detail: `未適用が ${ctx.unappliedMigrations.length} 件: ${ctx.unappliedMigrations.join(", ")}`,
          nextAction:
            "このコマンドが続けて適用します。適用せずに反映すると、Xの連携が internal_error で壊れます",
        }
      : { name: "データ構造の更新（migration）", level: "ok", detail: "すべて適用済みです" },
  );

  return steps;
}

/** 最初に止まった段（無ければ null）。 */
export function firstStop(steps: GateStep[]): GateStep | null {
  return steps.find((s) => s.level === "stop") ?? null;
}

/**
 * 止まった理由が「未適用のmigration」だけかどうか。
 * これだけなら、同じコマンドの中で適用してから先へ進める（他の理由は人の対応が必要）。
 */
export function onlyMigrationsPending(steps: GateStep[]): boolean {
  const stops = steps.filter((s) => s.level === "stop");
  return stops.length === 1 && stops[0].name === "データ構造の更新（migration）";
}

/** 運営者向けの1行まとめ。 */
export function summarizeGate(steps: GateStep[]): string {
  const stop = firstStop(steps);
  if (!stop) return `${steps.length} 項目すべて問題ありません`;
  return `「${stop.name}」で止まりました: ${stop.detail}`;
}
