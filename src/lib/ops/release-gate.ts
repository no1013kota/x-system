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
  /**
   * いまのコミットのメッセージに GitHub 公式の省略の印（skip ci 等）があるか。この印は workflow ごと止めるため
   * 必須チェックが報告されず PR がマージできない（2026-09-05 に実際に起きた）。些細な修正の軽量化は
   * ci.yml が見る [light ci] を使う（CI は走り、本体だけ飛ばす）ので、ゲートには特別扱いが要らない。
   */
  ciSkipRequested?: boolean;
  /**
   * **いまのコミットに対するデプロイ（Vercel）の結論**（判定できなければ null）。
   *
   * CIが緑でも**デプロイのbuildは別に落ちる**（環境変数はCIとVercelで別物）。2026-08-29、
   * `OPENAI_IMAGE_MODEL` がVercelに無いためbuildが3回連続で失敗していたのに、ここを見て
   * いなかったので「✅ 反映と検証が完了しました」と出ていた。**古い版が動いたまま成功に
   * 見える**のが一番まずい（原則1）。判定できないときは止めずに warn にする——
   * `gh` が無い環境でも反映そのものは進められるようにするため。
   */
  deployConclusion?: string | null;
  /** 未適用の migration ファイル名（空なら適用済み）。 */
  unappliedMigrations: string[];
  /** 反映先のURL（未設定なら空文字）。 */
  baseUrl: string;
  /**
   * いま `supabase link` で繋がっている Supabase プロジェクトのref（未リンク・読めない場合は null）。
   * `supabase/.temp/project-ref` から読む。
   */
  linkedProjectRef?: string | null;
  /**
   * **反映先のアプリが実際に使っている** Supabase プロジェクトのref（判定できない場合は null）。
   * デプロイ先のCSPヘッダから読む（秘密値ではない）。
   */
  targetProjectRef?: string | null;
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
  } else if (ctx.ciConclusion === null && ctx.ciSkipRequested) {
    steps.push({
      name: "自動テスト（CI）",
      level: "stop",
      detail: "コミットに GitHub 公式の省略の印（skip ci 等）があり、CI が走っていません",
      nextAction: "この印では必須チェックが報告されず PR をマージできません。印を外し、些細な修正なら [light ci] を付けて push し直してください（CI は本体を飛ばして数分で終わります）",
    });
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

  if (ctx.deployConclusion === "success") {
    steps.push({ name: "デプロイ（Vercel）", level: "ok", detail: "このコミットのbuildは成功しています" });
  } else if (ctx.deployConclusion === "failure" || ctx.deployConclusion === "error") {
    steps.push({
      name: "デプロイ（Vercel）",
      level: "stop",
      detail: "このコミットのbuildが失敗しています（古い版が動いたままです）",
      nextAction:
        "Vercelのbuildログを見てください（`npx vercel inspect <デプロイID> --logs`）。CIが緑でも環境変数の違いで落ちます",
    });
  } else if (ctx.deployConclusion === "pending") {
    steps.push({
      name: "デプロイ（Vercel）",
      level: "stop",
      detail: "まだbuild中です",
      nextAction: "終わるまで待ってから、もう一度このコマンドを実行してください",
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

  // **どのデータベースへmigrationを流すか**の確認（T-M7-52）。
  //
  // `supabase link` は作業ディレクトリに1つしか保持しない。production に繋いだまま
  // `release:staging -- --apply` を実行すると**本番DBへmigrationが入る**。逆向きだと本番が
  // 未適用のまま「全部通りました」と出る。どちらも黙って起き、後から気付けない。
  // 反映先のアプリが実際に使っているプロジェクトと突き合わせて、違えば止める。
  steps.push(judgeLinkedProject(ctx));

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

/**
 * 繋がっているSupabaseプロジェクトが、反映先のアプリが使っているものと一致するか。
 *
 * **判定できないときは止める**（安全側）。取り違えると本番DBを壊すため、警告では足りない。
 */
export function judgeLinkedProject(ctx: {
  target: "staging" | "production";
  linkedProjectRef?: string | null;
  targetProjectRef?: string | null;
}): GateStep {
  const name = "データベースの接続先";
  const linked = ctx.linkedProjectRef ?? null;
  const wanted = ctx.targetProjectRef ?? null;

  if (!wanted) {
    return {
      name,
      level: "stop",
      detail: `${ctx.target} のアプリがどのSupabaseプロジェクトを使っているか確認できませんでした`,
      nextAction:
        "デプロイ先が起動しているか確認してください。判定できないまま migration を流すと、別の環境のデータベースを更新する恐れがあります",
    };
  }
  if (!linked) {
    return {
      name,
      level: "stop",
      detail: "Supabase プロジェクトへ繋がっていません",
      nextAction: `\`npx supabase link --project-ref ${wanted}\` を実行してください（${ctx.target} のプロジェクトです）`,
    };
  }
  if (linked !== wanted) {
    return {
      name,
      level: "stop",
      detail: `いま繋がっているのは ${linked} ですが、${ctx.target} が使っているのは ${wanted} です`,
      nextAction: `\`npx supabase link --project-ref ${wanted}\` で繋ぎ直してください。このまま進めると**別の環境のデータベース**を更新します`,
    };
  }
  return { name, level: "ok", detail: `${linked}（${ctx.target} のプロジェクト）` };
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

/**
 * `supabase migration list --linked` の出力から、**リモートへ適用済み**のversionを取り出す。
 * 解釈できなければ `null`（呼び出し側は安全側＝未適用として扱う）。
 *
 * CLIのバージョンで出力形式が変わる。2026-08-01、表形式だけを想定していたため、JSONを返す
 * CLI v2系で**適用済みなのに「未適用11件」と誤判定**し、リリースが永久に完了しない状態になった。
 * 誤読が「適用済み」側へ倒れるとDBが古いまま反映されてしまうため、**判断できないときは止める**。
 *
 * 対応する形式:
 * - JSON: `{"migrations":[{"local":"2026...","remote":"2026...","time":"..."}]}`
 * - 表:   `  20260720000001 | 20260720000001 | 2026-07-20 ...`（Local | Remote | 時刻）
 */
export function parseAppliedRemote(raw: string): Set<string> | null {
  const jsonStart = raw.indexOf('{"migrations"');
  if (jsonStart !== -1) {
    try {
      const parsed: unknown = JSON.parse(raw.slice(jsonStart, raw.lastIndexOf("}") + 1));
      const migrations = (parsed as { migrations?: unknown }).migrations;
      if (!Array.isArray(migrations)) return null;
      return new Set(
        migrations
          .map((m) => String((m as { remote?: unknown }).remote ?? "").trim())
          .filter((v) => /^\d{14}$/.test(v)),
      );
    // eslint-disable-next-line no-restricted-syntax -- 壊れたJSONは「解釈できない」が判定結果
    } catch {
      return null;
    }
  }
  const rows = raw
    .split("\n")
    .map((line) => line.split("|").map((c) => c.trim()))
    .filter((cols) => cols.length >= 2);
  if (rows.length === 0) return null;
  return new Set(rows.map((cols) => cols[1]).filter((v) => /^\d{14}$/.test(v)));
}

/**
 * 同一コミット（headSha）の複数のworkflow runから、ゲートが見るべきCIの結論を1つ選ぶ（T-M8-389）。
 *
 * PRを作ると**同じSHAにPRトリガーのrunがもう1本増え**、CI重複排除（T-M8-372の
 * `github.head_ref != 'stg'` スキップ）によりそのrunは `skipped` で終わる。`gh run list` は
 * 新しい順なので、**先頭一致で拾うとpush時の `success` がPRの `skipped` に隠れて**
 * 「結果が skipped です」で止まる（2026-08-31、T-M8-388のstaging再検証で実際に止まった）。
 * 実行された結論（success / failure / …）を skipped より優先し、実行中があればそれを返す
 * （まだ結論が出ていないことを隠さない）。
 */
export function pickCiConclusion(
  runs: { headSha?: string; status?: string; conclusion?: string | null }[],
  headSha: string,
): string | null {
  const mine = runs.filter((r) => r.headSha === headSha);
  if (mine.length === 0) return null; // このコミットのCIはまだ無い＝止める
  const running = mine.find((r) => r.status !== "completed");
  if (running) return running.status ?? null;
  const decisive = mine.find((r) => r.conclusion && r.conclusion !== "skipped");
  return decisive?.conclusion ?? mine[0].conclusion ?? null;
}

/**
 * デプロイ先の CSP ヘッダから Supabase プロジェクトのrefを読む（T-M7-52）。
 *
 * `NEXT_PUBLIC_SUPABASE_URL` はCSPの `connect-src` に載る。**認証情報が不要で、refは秘密値でない**。
 * クライアントバンドルを探すより確実（認証をServer Actionで行うため、ログイン画面のバンドルには
 * Supabaseクライアントが載らないことがある）。
 */
export function projectRefFromCsp(csp: string | null | undefined): string | null {
  if (!csp) return null;
  const m = /https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(csp);
  return m ? m[1] : null;
}

/**
 * 検証先URLに対して、どの設定名の `CRON_SECRET` を使うかを決める（T-M7-35）。
 *
 * **鍵は環境ごとに違う**（同じにすると片方の漏洩で両方が破られる）。ローカル宛はローカルの鍵、
 * デプロイ先宛はその環境の鍵を使う。この鍵が要るのは**デプロイ先を覗く2つのコマンド**だけで、
 * E2Eはローカル限定なので関係しない（`e2e/fixtures/guard.ts` がローカル以外を拒否する）。
 *
 * - `npm run smoke:live -- --base <URL>`（実物スモーク＝デプロイ後検証）
 * - `npm run doctor -- --base <URL>`（状態確認）
 *
 * 対応が判別できないURLは **staging用を既定**にする。本番の鍵で意図せず本番を叩く方が害が大きい。
 */
export function cronSecretEnvName(
  baseUrl: string,
  known: { stagingBaseUrl?: string; productionBaseUrl?: string } = {},
): "CRON_SECRET" | "STAGING_CRON_SECRET" | "PRODUCTION_CRON_SECRET" {
  if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(baseUrl)) return "CRON_SECRET";
  const trim = (u?: string) => u?.replace(/\/$/, "");
  const production = trim(known.productionBaseUrl);
  const staging = trim(known.stagingBaseUrl);
  if (production && baseUrl.startsWith(production)) return "PRODUCTION_CRON_SECRET";
  if (staging && baseUrl.startsWith(staging)) return "STAGING_CRON_SECRET";
  return "STAGING_CRON_SECRET";
}

/**
 * GitHub Actions が push / pull_request を省略するコミットメッセージの印（公式の5種）。
 * **このリポジトリでは使わない**（必須チェックが報告されず PR がマージできない）。検出して止めるための定義。
 * 些細な修正の軽量化は ci.yml が見る [light ci]（CI は走り、本体だけ飛ばす）。
 */
export const CI_SKIP_MARKER_RE = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i;

/** コミットメッセージに CI 省略の印があるか。 */
export function isCiSkipRequested(commitMessage: string | null | undefined): boolean {
  return CI_SKIP_MARKER_RE.test(commitMessage ?? "");
}
