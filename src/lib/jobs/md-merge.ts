import {
  generateInitialBaseMd,
  personaSettingsSchema,
  rebuildSettingsSections,
  type PersonaSettings,
} from "../persona-settings";
import { parseAndValidate } from "../ai/parse";
import { syncInUsePreset } from "@/lib/prompts/prompt-preset-sync";
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
 * **反映先はセクション1〜4**（T-M8-336で5〜6から移した）。「対象セクション現在値＋全active source
 * analyses」から書き直す。人が書くセクション5（参考にする型）は byte-for-byte 保持する
 * （T-M8-356で「文体・自分らしさ」を廃止し、見出しは1〜5になった）。
 * 新versionを change_source=learning で確定し、開始時 base_md_version と異なれば
 * （updatePersonaSettings等と競合）最新versionから再merge（上書き消失させない）。枯渇/時間不足は retryable。
 * merge出力は本文のみで、見出し混入や（内容があるのに）空出力は構造エラーとして修復・失敗させる。
 */

export const MD_MERGE_MAX_RETRIES = 2;

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
  /** 反映先。セクション1〜4を1回で書き直す（T-M8-336）。 */
  section: "profile";
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
  /** 現在のアカウント設定（フォームの値そのもの）。mergeの入力であり出力の形でもある。 */
  settings: unknown;
  analyses: unknown[];
  removed: unknown[];
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

/** 最新の base_md＋version と、active/removed analyses を読む（競合retryで都度再読）。 */
async function loadMergeState(
  db: Queryable,
  xAccountId: string,
  opts: { confirmSourceId?: string; removedSourceId?: string },
): Promise<MergeState> {
  const acct = (
    await db.query<{ base_md: string; base_md_version: number; settings: unknown }>(
      `select base_md, base_md_version, settings from x_accounts where id = $1`,
      [xAccountId],
    )
  ).rows[0];
  if (!acct) throw new Error("x_account not found for md-merge");

  /*
    **参考ソースの分析をすべて集める**（T-M8-336）。以前は「own_posts→セクション5 /
    参考ソース→セクション6」と種別でセクションを分けていたが、反映先をセクション1〜4へ
    まとめたので分ける理由が無くなった（own_posts＝自分の過去投稿からの学習はT-M8-103で廃止済み）。
  */
  const { rows } = await db.query<SourceAnalysisRow>(
    `select id, type::text as type, analysis_summary
       from learning_sources
      where x_account_id = $1
        and analysis_summary is not null
        and (status = 'analyzed' or id = $2)
        and ($3::uuid is null or id <> $3)`,
    [xAccountId, opts.confirmSourceId ?? null, opts.removedSourceId ?? null],
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

  return {
    baseMd: acct.base_md,
    version: acct.base_md_version,
    settings: acct.settings,
    analyses,
    removed,
  };
}

/**
 * アカウント設定を1回mergeし、**検証を通ったsettings**を返す（T-M8-341）。
 *
 * 出力は `personaSettingsSchema` と同じ形のJSON。読めない・形が違うものは1回だけ直させ、
 * それでも駄目なら構造エラー（学習を捨てるより、設定を壊さない方を採る）。
 */
async function mergeSection(
  provider: { textGen: TextGen; model: string },
  input: { current: string; analyses: unknown[]; removed: unknown[]; deadline: Deadline },
  now: () => number,
): Promise<{ settings: PersonaSettings; calls: ProviderCall[] }> {
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

  /*
    **設定の形を満たすまで**（T-M8-341）。ここを緩めると、保存の瞬間に
    「設定画面が開けない壊れた設定」を書き込むことになる。読めない出力は1回だけ直させる。
  */
  const parseSettings = (text: string): PersonaSettings | null => {
    const parsed = parseAndValidate(text, personaSettingsSchema);
    return parsed.ok ? parsed.value : null;
  };

  let settings = parseSettings(await call(""));
  if (!settings) {
    settings = parseSettings(
      await call(
        "出力は<current>と同じ形のJSONだけにしてください（前置き・説明・コードフェンスを付けない）。",
      ),
    );
  }
  if (!settings) throw new MdMergeStructureError();
  return { settings, calls };
}

/**
 * **何のためのmergeかを `learning_source_id` の有無で決める**（T-M8-344／T-M8-356）。
 *
 * - 有り: 学習ソースの**削除**に伴う作り直し（その1件を除いて再構成し、その場で確定する）
 * - 無し: 利用者が「アカウント設定を反映する」を押した反映（**保存前の提案として置く**）
 *
 * 判定を関数にしておく——ここが逆に配線されると、押した瞬間に本番の設定が書き換わる／
 * 削除したのに知見が残る、という**どちらも画面からは説明できない**壊れ方をする（原則1）。
 */
export function mergeModeFor(
  learningSourceId: string | null,
): { removedSourceId: string } | { proposalOnly: true } {
  return learningSourceId ? { removedSourceId: learningSourceId } : { proposalOnly: true };
}

/**
 * MD-MERGE を実行する。学習追加（confirmSourceId）または削除（removedSourceId）から呼ぶ。生成枠は親
 * learning_analysis/md_merge job の1回に含む（追加消費なし）。対象1セクションのみ書き直し、非対象は保持。
 * base_md新version・履歴・source状態確定を同一tx。時間不足・version競合枯渇は retryable。
 */
export async function executeMdMerge(
  deps: MdMergeDeps,
  opts: {
    confirmSourceId?: string;
    removedSourceId?: string;
    /**
     * **保存前の提案として置くだけにする**（T-M8-349・運営者の指示 2026-08-28）。
     *
     * 「参考ソースからアカウント設定を反映する」の経路で使う。`settings` も
     * アカウント.mdも触らず `settings_proposal` へ書く——押した瞬間に本番の設定が
     * 変わると、利用者は**中身を見る前に**書き換えられてしまう。画面のフォームが
     * この提案を読み込み、確認して「アカウント設定を保存」を押したときに確定する。
     */
    proposalOnly?: boolean;
  } = {},
): Promise<MdMergeResult> {
  const recordStage = deps.recordStage ?? defaultRecordStage(deps.jobId);
  const maxRetries = deps.maxRetries ?? MD_MERGE_MAX_RETRIES;
  const now = deps.now ?? Date.now;
  // 全attemptの provider call を蓄積し、成功確定時に原価台帳へ冪等記録する（要件02 §3.17）。
  const allCalls: ProviderCall[] = [];

  const job = await loadJobMeta(deps.db, deps.jobId);
  if (!job) throw new Error("job not found for md-merge");

  await recordStage("merging");
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

    const state = await loadMergeState(deps.db, job.x_account_id, opts);

    /*
      **アカウント設定が無くても走る**（T-M8-344・運営者の指示 2026-08-27）。
      「学習ソースによってアカウント設定をする」ための経路なので、未保存＝対象外にできない。
      設定が読めないときは `<current>` を "none" にして、分析だけから作らせる。
    */
    const currentSettings = personaSettingsSchema.safeParse(state.settings);
    const isFirstSetup = !currentSettings.success;
    if (isFirstSetup && state.analyses.length === 0) {
      // 材料も土台も無い。**空の設定を作らない**（何を根拠に決めたか説明できない設定になる）。
      throw new MdMergeStructureError();
    }

    const { settings: merged, calls } = await mergeSection(
      { textGen, model },
      {
        current: currentSettings.success ? JSON.stringify(currentSettings.data) : "none",
        analyses: state.analyses,
        removed: state.removed,
        deadline,
      },
      now,
    );
    allCalls.push(...calls);
    /*
      **アカウント設定そのものを更新する**（T-M8-341）。アカウント.mdはその設定から
      作り直す（`rebuildSettingsSections`）ので、画面の表示・本文・学習の成果が常に一致する。
      セクション5〜6（利用者の手入力）はバイト単位で残る。
    */
    // 初回は初版を作る（version 0 → 1）。2回目以降はセクション1〜4だけ作り直す。
    const newBaseMd = isFirstSetup
      ? generateInitialBaseMd(merged)
      : rebuildSettingsSections(state.baseMd, merged); // 6見出し構造を検証
    const nextVersion = state.version + 1;

    /*
      提案として置くだけの経路（T-M8-349）。版を積まず、本棚にも写さない——
      まだ何も確定していないので、履歴に残す出来事が無い。
    */
    if (opts.proposalOnly) {
      await deps.runInTx(async (tx) => {
        await tx.query(
          `update x_accounts set settings_proposal = $2::jsonb where id = $1`,
          [job.x_account_id, JSON.stringify(merged)],
        );
      });
      await recordProviderCalls(deps.db, allCalls, {
        userId: job.user_id,
        xAccountId: job.x_account_id,
        jobId: deps.jobId,
        keyPrefix: `mdmerge:${deps.jobId}`,
      });
      if (job.kind === "md_merge" && deps.runInTxForSettle) {
        const total = allCalls.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);
        await settleIfPremium(deps.runInTxForSettle, {
          plan: job.plan,
          jobId: deps.jobId,
          type: "generation",
          estimatedCostUsdTotal: total,
          userId: job.user_id,
          xAccountId: job.x_account_id,
        });
      }
      return { version: state.version, section: "profile" as const };
    }

    const written = await deps.runInTx(async (tx) => {
      const upd = await tx.query(
        `update x_accounts set base_md = $2, base_md_version = $3, settings = $5::jsonb
          where id = $1 and base_md_version = $4`,
        [job.x_account_id, newBaseMd, nextVersion, state.version, JSON.stringify(merged)],
      );
      if ((upd.rowCount ?? 0) !== 1) return null; // 競合 → 最新versionから再merge
      // 本棚の「使用中」へも写す（T-M8-332）。学習の反映が本棚に出ないと、
      // プロンプト画面の本文と生成に使われる本文が食い違う。
      await syncInUsePreset(tx, {
        xAccountId: job.x_account_id,
        kind: "base_md",
        content: newBaseMd,
      });
      /*
        **お知らせは出さない**（T-M8-344・運営者の指示 2026-08-27）。反映は利用者が
        ボタンを押して始めるものになったので、進行と完了は**その画面**で示す
        （「アカウント設定を書き換え中です」→ 完了したら新しい設定が表示される）。
        押していないのに変わることが無いなら、通知で追いかける必要も無い。
      */
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
          userId: job.user_id,
          xAccountId: job.x_account_id,
        });
      }
      return { version: written, section: "profile" as const };
    }
    // 競合: 次ループで最新stateを再読して再merge（並行変更を取り込み、上書き消失させない）。
  }
  throw new MdMergeConflictError();
}
