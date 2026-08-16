import {
  extractBaseMdSection,
  replaceLearningSections,
} from "../persona-settings";
import { toProviderCall, type ProviderCall } from "../ai/normalize";
import { estimateProviderCost } from "../ai/pricing";
import { PT_MD_MERGE } from "../prompts/gen-prompts";
import type { Provider, TextGen } from "../ai/types";
import { recordProviderCalls } from "../db/api-usage-ledger";
import { settleIfPremium, type RunInTx as SettleRunInTx } from "../usage/reserve-if-premium";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import { defaultRecordStage } from "./stale";

/**
 * 同一job内 MD-MERGE（L-8, プロンプト設計書 §4.2/§6.14, 要件04 §1/§12, 要件05 §9, 要件02 §3.4, T-M5-04）。
 * トリガーソースの種別が決める「該当セクション1つだけ」を「対象セクション現在値＋全active source analyses」
 * から書き直す（§4.2「該当セクションのみ」・§6.14「1セクションを書き直す」）。own_posts→セクション5
 * （文体・自分らしさ）、ref_account/ref_post→セクション6（参考にする型）。非対象セクションと1〜4は
 * byte-for-byte 保持する。新versionを change_source=learning で確定し、開始時 base_md_version と異なれば
 * （updatePersonaSettings等と競合）最新versionから再merge（上書き消失させない）。枯渇/時間不足は retryable。
 * merge出力は本文のみで、見出し混入や（内容があるのに）空出力は構造エラーとして修復・失敗させる。
 */

export const MD_MERGE_MAX_RETRIES = 2;
const HEADING_RE = /^#{1,6}\s/m;

export class MdMergeConflictError extends Error {
  readonly retryable = true;
  constructor(message = "base_md version conflict") {
    super(message);
    this.name = "MdMergeConflictError";
  }
}

export class MdMergeStructureError extends Error {
  readonly retryable = false;
  constructor(message = "md merge output broke base_md structure") {
    super(message);
    this.name = "MdMergeStructureError";
  }
}

export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

export interface MdMergeDeps {
  db: Queryable;
  jobId: string;
  runInTx: RunInTx;
  resolveProvider: (input: {
    plan: string;
    userId: string;
    deadline: Deadline;
  }) => Promise<{ textGen: TextGen; provider: Provider; model: string }>;
  now?: () => number;
  makeDeadline?: () => Deadline;
  recordStage?: (stage: string) => Promise<void>;
  maxRetries?: number;
  /** 単独md_merge jobのクレジット精算用（T-M8-109。学習内mergeでは渡さない）。 */
  runInTxForSettle?: SettleRunInTx;
}

export interface MdMergeResult {
  version: number;
  section: 5 | 6;
}

interface JobMetaRow {
  x_account_id: string;
  user_id: string;
  plan: string;
  kind: string;
}
interface SourceAnalysisRow {
  id: string;
  type: string;
  analysis_summary: unknown;
}
interface MergeState {
  baseMd: string;
  version: number;
  analyses: unknown[];
  removed: unknown[];
}

function isSection5(type: string): boolean {
  return type === "own_posts";
}

async function loadJobMeta(db: Queryable, jobId: string): Promise<JobMetaRow | null> {
  const { rows } = await db.query<JobMetaRow>(
    `select gj.x_account_id, gj.kind::text as kind, xa.user_id, p.plan
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
       join profiles p on p.id = xa.user_id
      where gj.id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

/** トリガー（確定 or 削除）ソースの種別から対象セクション（5 or 6）を決める（§4.2 該当セクションのみ）。 */
async function resolveTargetSection(
  db: Queryable,
  opts: { confirmSourceId?: string; removedSourceId?: string },
): Promise<5 | 6> {
  const id = opts.confirmSourceId ?? opts.removedSourceId;
  if (!id) throw new Error("md-merge requires confirmSourceId or removedSourceId");
  const row = (
    await db.query<{ type: string }>(
      `select type::text as type from learning_sources where id = $1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new Error("md-merge trigger source not found");
  return isSection5(row.type) ? 5 : 6;
}

/** 最新の base_md＋version と、対象セクションの active/removed analyses を読む（競合retryで都度再読）。 */
async function loadMergeState(
  db: Queryable,
  xAccountId: string,
  target: 5 | 6,
  opts: { confirmSourceId?: string; removedSourceId?: string },
): Promise<MergeState> {
  const acct = (
    await db.query<{ base_md: string; base_md_version: number }>(
      `select base_md, base_md_version from x_accounts where id = $1`,
      [xAccountId],
    )
  ).rows[0];
  if (!acct) throw new Error("x_account not found for md-merge");

  // 対象セクションに属する type だけを集める（own_posts→5 / ref_account,ref_post→6）。
  const typeFilter = target === 5 ? ["own_posts"] : ["ref_account", "ref_post"];
  const { rows } = await db.query<SourceAnalysisRow>(
    `select id, type::text as type, analysis_summary
       from learning_sources
      where x_account_id = $1
        and analysis_summary is not null
        and type::text = any($4::text[])
        and (status = 'analyzed' or id = $2)
        and ($3::uuid is null or id <> $3)`,
    [xAccountId, opts.confirmSourceId ?? null, opts.removedSourceId ?? null, typeFilter],
  );
  const analyses = rows.map((r) => r.analysis_summary);

  const removed: unknown[] = [];
  if (opts.removedSourceId) {
    const rm = (
      await db.query<SourceAnalysisRow>(
        `select analysis_summary from learning_sources where id = $1`,
        [opts.removedSourceId],
      )
    ).rows[0];
    if (rm?.analysis_summary) removed.push(rm.analysis_summary);
  }

  return { baseMd: acct.base_md, version: acct.base_md_version, analyses, removed };
}

/**
 * 対象セクションを1つmergeし、本文のみ（見出しなし）を返す。見出し混入は1回修復→なお不正なら構造エラー。
 * 内容（現在本文 or active analyses）があるのに空出力になった場合も、学習の消失を防ぐため構造エラーにする。
 */
async function mergeSection(
  provider: { textGen: TextGen; model: string },
  input: { current: string; analyses: unknown[]; removed: unknown[]; deadline: Deadline },
  now: () => number,
): Promise<{ body: string; calls: ProviderCall[] }> {
  const hadContent = input.current.trim().length > 0 || input.analyses.length > 0;
  const calls: ProviderCall[] = [];
  const buildUser = (): string =>
    PT_MD_MERGE.replaceAll("{{current_section}}", input.current)
      .replaceAll("{{active_analyses}}", JSON.stringify(input.analyses))
      .replaceAll("{{removed_analyses}}", JSON.stringify(input.removed));

  const call = async (extra: string): Promise<string> => {
    const start = now();
    const out = await provider.textGen.generate({
      system: [],
      user: extra ? `${buildUser()}\n\n${extra}` : buildUser(),
      timeoutMs: input.deadline.callTimeoutMs(),
    });
    calls.push(
      toProviderCall(out, {
        model: provider.model,
        operation: "text_generation",
        latencyMs: now() - start,
        estimatedCostUsd: estimateProviderCost(out.provider, out.usage),
      }),
    );
    return out.text.trim();
  };

  const invalid = (body: string): boolean =>
    HEADING_RE.test(body) || (hadContent && body.length === 0);

  let body = await call("");
  if (invalid(body)) {
    // 本文のみ規約違反（見出し混入 or 消失）→ 1回だけ修復指示を付けて再生成する（§7.1）。
    body = await call(
      "出力はセクション本文のみとし、`#`で始まる見出しや前置きを含めず、内容を空にしないでください。",
    );
  }
  if (invalid(body)) throw new MdMergeStructureError();
  return { body, calls };
}

/**
 * MD-MERGE を実行する。学習追加（confirmSourceId）または削除（removedSourceId）から呼ぶ。生成枠は親
 * learning_analysis/md_merge job の1回に含む（追加消費なし）。対象1セクションのみ書き直し、非対象は保持。
 * base_md新version・履歴・source状態確定を同一tx。時間不足・version競合枯渇は retryable。
 */
export async function executeMdMerge(
  deps: MdMergeDeps,
  opts: { confirmSourceId?: string; removedSourceId?: string } = {},
): Promise<MdMergeResult> {
  const recordStage = deps.recordStage ?? defaultRecordStage(deps.jobId);
  const maxRetries = deps.maxRetries ?? MD_MERGE_MAX_RETRIES;
  const now = deps.now ?? Date.now;
  // 全attemptの provider call を蓄積し、成功確定時に原価台帳へ冪等記録する（要件02 §3.17）。
  const allCalls: ProviderCall[] = [];

  const job = await loadJobMeta(deps.db, deps.jobId);
  if (!job) throw new Error("job not found for md-merge");

  await recordStage("merging");
  const target = await resolveTargetSection(deps.db, opts);
  // Function 全体で1つの deadline を共有する（分析phaseと合算した実経過を反映）。
  const deadline = (deps.makeDeadline ?? createDeadline)();
  const { textGen, model } = await deps.resolveProvider({
    plan: job.plan,
    userId: job.user_id,
    deadline,
  });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 残り時間が追加call最低分に満たなければ retryable として次回起動へ委ねる（要件04 §5）。
    if (!deadline.canStartCall()) throw new MdMergeConflictError("insufficient deadline for md-merge");

    const state = await loadMergeState(deps.db, job.x_account_id, target, opts);
    if (state.version < 1) throw new Error("base_md is not initialized (version 0)");

    const { body: merged, calls } = await mergeSection(
      { textGen, model },
      {
        current: extractBaseMdSection(state.baseMd, target),
        analyses: state.analyses,
        removed: state.removed,
        deadline,
      },
      now,
    );
    allCalls.push(...calls);
    // 対象セクションだけを差し替え、非対象は現状を byte-for-byte 保持する（§4.2 該当セクションのみ）。
    const section5 = target === 5 ? merged : extractBaseMdSection(state.baseMd, 5);
    const section6 = target === 6 ? merged : extractBaseMdSection(state.baseMd, 6);
    const newBaseMd = replaceLearningSections(state.baseMd, section5, section6); // 6見出し構造を検証
    const nextVersion = state.version + 1;

    const written = await deps.runInTx(async (tx) => {
      const upd = await tx.query(
        `update x_accounts set base_md = $2, base_md_version = $3
          where id = $1 and base_md_version = $4`,
        [job.x_account_id, newBaseMd, nextVersion, state.version],
      );
      if ((upd.rowCount ?? 0) !== 1) return null; // 競合 → 最新versionから再merge
      await tx.query(
        `insert into base_md_versions (x_account_id, version, content, change_source, summary)
         values ($1, $2, $3, 'learning', $4)`,
        [job.x_account_id, nextVersion, newBaseMd, opts.removedSourceId ? "学習ソース削除に伴うmerge" : "学習分析の反映"],
      );
      if (opts.confirmSourceId) {
        await tx.query(`update learning_sources set status = 'analyzed', updated_at = now() where id = $1`, [
          opts.confirmSourceId,
        ]);
      }
      if (opts.removedSourceId) {
        await tx.query(
          `update learning_sources set status = 'removed', removed_at = now(), updated_at = now() where id = $1`,
          [opts.removedSourceId],
        );
      }
      return nextVersion;
    });

    if (written != null) {
      await recordProviderCalls(deps.db, allCalls, {
        userId: job.user_id,
        xAccountId: job.x_account_id,
        jobId: deps.jobId,
        keyPrefix: `mdmerge:${deps.jobId}`,
      });
      // AIクレジットを実費で精算（premium・T-M8-109）。**単独md_merge job（削除merge）のみ**——
      // 学習job内のmergeは親（learning_analysis）が分析分と併せて精算する（同一jobIdのため
      // settle keyが衝突し、両方から呼ぶと先勝ちで片方の実費しか反映されない）。
      if (job.kind === "md_merge" && deps.runInTxForSettle) {
        const total = allCalls.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);
        await settleIfPremium(deps.runInTxForSettle, {
          plan: job.plan,
          jobId: deps.jobId,
          type: "generation",
          estimatedCostUsdTotal: total,
        });
      }
      return { version: written, section: target };
    }
    // 競合: 次ループで最新stateを再読して再merge（並行変更を取り込み、上書き消失させない）。
  }
  throw new MdMergeConflictError();
}
