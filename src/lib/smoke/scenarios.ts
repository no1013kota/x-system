import "server-only";

import { randomUUID } from "node:crypto";

import { pooledQueryable } from "../db/pool";
import { runJob } from "../jobs/worker";
import { weightedLength } from "../post/text-metrics";
import { resolveXAccountId } from "./resolve-account";

/**
 * 実物スモーク（T-M7-25）。**実APIを叩いてアプリの最終成果物まで検証する**。
 *
 * 既存の層との違い:
 * - 単体・E2E: 外部境界をモックするので「送ったものが受理されるか／返ったものを扱えるか」を見ない
 * - `check:providers`: 受理されるかは見るが、**応答をアプリが扱えるか**は見ない
 * - ここ: job を実際に走らせ、**下書き・画像・ニュース item という成果物**を検証する
 *
 * 2026-07-28 に手動操作でしか見つからなかった4件を、この層で機械的に落とせるようにした:
 * `allowed_callers`欠落で400（T-M7-15）／schemaの`additionalProperties`欠落で400（T-M7-21）／
 * 200だが前置き文でJSON検証が落ちる・`<cite>`が本文へ混入（T-M7-20）／
 * 200だが応答が字数上限に触れて全件破棄され分野が常に0件（T-M7-24）。
 *
 * 呼び出しは手動のみ（`npm run smoke:live` と `/api/cron/canary`）。cron へは登録しない。
 * 実費が発生し、生成枠も消費する（実測: 検索あり生成 $0.11〜0.16／検索なし $0.013／画像 $0.003）。
 */

const db = pooledQueryable();

export interface SmokeResult {
  name: string;
  ok: boolean;
  /** 成否の理由。失敗時は何がどう違ったかを書く（ログを見なくても判断できるように）。 */
  detail: string;
  costUsd: number;
  /** 失敗ではないが注意すべき事象（除外件数など）。 */
  warning?: string;
  /**
   * 生成物の実物（先頭2ポストと形の計測）。**シナリオは作った下書きを削除する**ため、
   * ここへ残さないと「実物を1周させて成果物を目で確認する」ができない（T-M7-37で判明）。
   * 秘密値は含まない（生成本文のみ）。
   */
  sample?: string;
}

// --- 純粋な判定（ここだけは単体テストで固定する） ---

/**
 * 生成物の形を運営者が読める1文へ畳む（先頭2ポストの本文＋計測）。
 *
 * 見るのは、指示が実際に守られたかを判断できる項目に絞る: 字数・改行の塊数・ハッシュタグ・URL。
 * 「プロンプトで頼んだことは守られない前提で組む」ため、**守られたかを毎回測る**（プロンプト設計書 §2 原則5）。
 */
export function describeGenerated(texts: string[]): string {
  const shape = (text: string) => {
    const chars = text.replace(/\n/g, "").length;
    // 判定に使う単位は加重文字数（CJKは2）。字数だけ見ると上限との関係が読めない。
    const weighted = weightedLength(text);
    const blocks = text.split(/\n{2,}/).length;
    const tags = (text.match(/(?:^|\s)#[^\s#]+/g) ?? []).length;
    const urls = (text.match(/https?:\/\//g) ?? []).length;
    return `${chars}字（加重${weighted}）/改行塊${blocks}/タグ${tags}/URL${urls}`;
  };
  const head = texts.slice(0, 2).map((text, i) => `[${i + 1}] ${shape(text)}\n${text}`);
  return `全${texts.length}ポスト\n${head.join("\n")}`;
}

/** providerのマークアップが本文に残っていないか（T-M7-20）。見つかったタグを返す。 */
export function findProviderMarkup(texts: string[]): string[] {
  const patterns = [/<\/?cite\b[^>]*>/gi, /```/g];
  const found = new Set<string>();
  for (const text of texts) {
    for (const re of patterns) {
      for (const m of text.matchAll(re)) found.add(m[0]);
    }
  }
  return [...found];
}

/**
 * ニュースの結果が「正常な空」か「全滅」かを判定する（T-M7-24）。
 *
 * 0件そのものは異常ではない（該当ニュースが無い時間帯は普通にある）。**0件かつ除外があった**
 * ときだけ全滅＝異常とする。この2つを区別できなかったため、web3分野は長期間0件のまま
 * 「成功」として記録され続けていた。
 */
/**
 * 除外理由が「取得窓より古い」だけかどうか（T-M7-44）。
 *
 * `published_at:too_old` は**応答が壊れているのではなく、その時間帯に新しい記事が無かった**だけ。
 * 運営者に直せるものは無い。一方 `title:too_big` のような契約違反は、プロンプトか検証条件の
 * 不具合なので直す必要がある。**同じ「0件」でも意味が違うので分けて扱う。**
 */
export function onlyOutsideWindow(reasons: Record<string, number>): boolean {
  const keys = Object.keys(reasons);
  return keys.length > 0 && keys.every((k) => k === "published_at:too_old");
}

export function newsOutcome(
  items: number,
  dropped: number,
  reasons: Record<string, number> = {},
): { ok: boolean; detail: string } {
  if (items === 0 && dropped > 0) {
    // 窓外だけなら「該当なし」と同じ扱い（成功）。件数は出して黙って流さない。
    if (onlyOutsideWindow(reasons)) {
      return {
        ok: true,
        detail: `取得0件（${dropped}件はいずれも取得窓より古い記事＝その時間帯に新しいニュースが無い）`,
      };
    }
    return {
      ok: false,
      detail: `全滅: 取得0件だが${dropped}件を規定外で除外した（応答が出力契約を満たしていない）`,
    };
  }
  if (items === 0) return { ok: true, detail: "取得0件（除外も0件＝該当ニュースが無い）" };
  return { ok: true, detail: `${items}件取得（除外${dropped}件）` };
}

// --- シナリオ ---

interface JobRow {
  status: string;
  draft_id: string | null;
  error: Record<string, unknown> | null;
  cost: string | null;
}

async function loadJob(jobId: string): Promise<JobRow | undefined> {
  const { rows } = await db.query<JobRow>(
    `select status::text as status, draft_id, error,
            usage->>'estimated_cost_usd_total' as cost
       from generation_jobs where id = $1`,
    [jobId],
  );
  return rows[0];
}

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/**
 * jobが終端に至るまで待つ。**親jobは子（画像）を非同期にdispatchする**ため、子へ直接
 * `runJob` を呼ぶと「既にleaseされている」で即returnし、走り終える前に成果物を読んでしまう。
 * 一定時間 queued のままなら（dispatchが届いていないとみなして）自分で走らせる。
 */
async function waitForJob(jobId: string, timeoutMs = 180_000): Promise<JobRow | undefined> {
  const deadline = Date.now() + timeoutMs;
  let drove = false;
  for (;;) {
    const job = await loadJob(jobId);
    if (job && TERMINAL.has(job.status)) return job;
    if (Date.now() > deadline) return job;
    if (!drove && job?.status === "queued") {
      drove = true;
      await runJob(jobId).catch(() => {
        // 競合でleaseできないのは正常（dispatch済み）。次のpollで結果を拾う。
      });
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function createJob(xAccountId: string, pattern: string, input: object): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into generation_jobs (x_account_id, kind, trigger, pattern, input, request_key)
     values ($1, 'post_generation', 'manual', $2::post_pattern, $3::jsonb, $4)
     returning id`,
    [xAccountId, pattern, JSON.stringify(input), `smoke:${randomUUID()}`],
  );
  return rows[0].id;
}

/** 作成したjobとdraftを消す（成果物を残さない）。失敗しても他のシナリオを止めない。 */
async function cleanup(jobIds: string[], draftIds: string[]): Promise<void> {
  try {
    for (const id of draftIds) {
      await db.query(`delete from drafts where id = $1`, [id]);
    }
    for (const id of jobIds) {
      await db.query(`delete from generation_jobs where parent_job_id = $1`, [id]);
      await db.query(`delete from generation_jobs where id = $1`, [id]);
    }
  } catch (error) {
    console.warn("[smoke] cleanup failed:", (error as Error).message);
  }
}

/** Web検索を使う生成が下書きまで到達し、本文にproviderマークアップが残らないこと。 */
async function generationWithSearch(xAccountId: string): Promise<SmokeResult> {
  const name = "生成（Web検索あり・P-6）";
  const jobIds: string[] = [];
  const draftIds: string[] = [];
  try {
    const jobId = await createJob(xAccountId, "p6", {
      pattern: "p6",
      requested_mode: "draft",
    });
    jobIds.push(jobId);
    await runJob(jobId);

    const job = await loadJob(jobId);
    const costUsd = Number(job?.cost ?? 0);
    if (!job || job.status !== "succeeded") {
      return {
        name,
        ok: false,
        costUsd,
        detail: `job が ${job?.status ?? "不明"}: ${JSON.stringify(job?.error ?? null)}`,
      };
    }
    if (!job.draft_id) return { name, ok: false, costUsd, detail: "succeeded だが下書きが無い" };
    draftIds.push(job.draft_id);

    const { rows } = await db.query<{ thread: { text?: string }[] }>(
      `select thread from drafts where id = $1`,
      [job.draft_id],
    );
    const texts = (rows[0]?.thread ?? []).map((p) => p.text ?? "");
    if (texts.length === 0) return { name, ok: false, costUsd, detail: "下書きのポストが0件" };

    const markup = findProviderMarkup(texts);
    if (markup.length > 0) {
      return {
        name,
        ok: false,
        costUsd,
        detail: `本文にproviderのマークアップが残っている: ${markup.join(" ")}`,
      };
    }
    return {
      name,
      ok: true,
      costUsd,
      detail: `${texts.length}ポストの下書きを作成`,
      sample: describeGenerated(texts),
    };
  } catch (error) {
    return { name, ok: false, costUsd: 0, detail: `例外: ${(error as Error).message}` };
  } finally {
    await cleanup(jobIds, draftIds);
  }
}

/** 画像付き生成が、子jobまで通って実バイト列の画像に到達すること。 */
async function generationWithImage(xAccountId: string): Promise<SmokeResult> {
  const name = "生成＋画像（P-2）";
  const jobIds: string[] = [];
  const draftIds: string[] = [];
  let costUsd = 0;
  try {
    const jobId = await createJob(xAccountId, "p2", {
      pattern: "p2",
      requested_mode: "draft",
      image_enabled: true,
      user_opinion: "AIツールの選び方について、要点を短くまとめてください。",
    });
    jobIds.push(jobId);
    await runJob(jobId);

    const parent = await loadJob(jobId);
    costUsd += Number(parent?.cost ?? 0);
    if (!parent || parent.status !== "succeeded" || !parent.draft_id) {
      return {
        name,
        ok: false,
        costUsd,
        detail: `親job が ${parent?.status ?? "不明"}: ${JSON.stringify(parent?.error ?? null)}`,
      };
    }
    draftIds.push(parent.draft_id);

    const { rows: children } = await db.query<{ id: string }>(
      `select id from generation_jobs where parent_job_id = $1 and kind = 'image_generation'`,
      [jobId],
    );
    if (children.length === 0) {
      return { name, ok: false, costUsd, detail: "画像ONなのに image_generation の子jobが無い" };
    }
    const child = await waitForJob(children[0].id);
    costUsd += Number(child?.cost ?? 0);
    if (!child || child.status !== "succeeded") {
      return {
        name,
        ok: false,
        costUsd,
        detail: `画像job が ${child?.status ?? "不明"}: ${JSON.stringify(child?.error ?? null)}`,
      };
    }

    const { rows } = await db.query<{ images: { status?: string; size_bytes?: number }[] }>(
      `select images from drafts where id = $1`,
      [parent.draft_id],
    );
    const image = (rows[0]?.images ?? [])[0];
    if (!image || image.status !== "ready") {
      return {
        name,
        ok: false,
        costUsd,
        detail: `画像が ready でない（status=${image?.status ?? "無し"}）: ${JSON.stringify(child?.error ?? null)}`,
      };
    }
    if (!image.size_bytes || image.size_bytes < 1000) {
      return { name, ok: false, costUsd, detail: `画像が小さすぎる（${image.size_bytes}バイト）` };
    }
    const { rows: threadRows } = await db.query<{ thread: { text?: string }[] }>(
      `select thread from drafts where id = $1`,
      [parent.draft_id],
    );
    return {
      name,
      ok: true,
      costUsd,
      detail: `画像 ready（${image.size_bytes}バイト）`,
      sample: describeGenerated((threadRows[0]?.thread ?? []).map((p) => p.text ?? "")),
    };
  } catch (error) {
    return { name, ok: false, costUsd, detail: `例外: ${(error as Error).message}` };
  } finally {
    await cleanup(jobIds, draftIds);
  }
}

/** ニュース取得が例外にならず、0件のときはそれが「該当なし」だと説明できること。 */
async function newsResearch(): Promise<SmokeResult> {
  const name = "ニュース取得（ai分野）";
  try {
    const { researchNews, formatDropReasons } = await import("../jobs/news-research");
    const { resolveNewsProvider } = await import("../ai/resolve-provider-server");
    const { createDeadline } = await import("../jobs/deadline");
    const { textGen, provider, model } = resolveNewsProvider({ deadline: createDeadline() });

    const res = await researchNews("ai", {
      db,
      textGen,
      provider,
      model,
      clock: new Date(),
      ledgerKeyPrefix: `smoke:${randomUUID()}`,
    });
    const costUsd = res.usage.estimated_cost_usd_total ?? 0;
    const outcome = newsOutcome(res.items.length, res.dropped, res.dropReasons);
    // 取得できたitemはDBへ保存しない（スモークは成果物を残さない）。
    return {
      name,
      ok: outcome.ok,
      costUsd,
      detail: outcome.detail,
      warning:
        res.dropped > 0
          ? `${res.dropped}件を規定外で除外（${formatDropReasons(res.dropReasons)}）`
          : undefined,
    };
  } catch (error) {
    return { name, ok: false, costUsd: 0, detail: `例外: ${(error as Error).message}` };
  }
}

export interface SmokeReport {
  ok: boolean;
  results: SmokeResult[];
  totalCostUsd: number;
  skipped: string[];
}

/**
 * 実物スモークを1周する。`account` を渡さない場合は生成系をskipし、ニュースだけ検証する
 * （本番で他人のアカウントを使わないよう、対象は必ず呼び出し側が明示する）。
 *
 * `account` は **UUID でも `@handle` でも指定できる**（T-M7-49）。運営者に内部のUUIDを
 * 探させないため。解決できなければ生成系は実行せず、理由を結果として返す。
 */
export async function runSmoke(account?: string): Promise<SmokeReport> {
  const results: SmokeResult[] = [];
  const skipped: string[] = [];

  if (account) {
    const resolved = await resolveXAccountId(account, { db });
    if (resolved.ok) {
      results.push(await generationWithSearch(resolved.id));
      results.push(await generationWithImage(resolved.id));
    } else {
      results.push({
        name: "Xアカウントの指定",
        ok: false,
        costUsd: 0,
        detail: resolved.message,
      });
    }
  } else {
    skipped.push("生成・画像（検証するXアカウントが指定されていない）");
  }
  results.push(await newsResearch());

  return {
    ok: results.every((r) => r.ok),
    results,
    totalCostUsd: Number(results.reduce((s, r) => s + r.costUsd, 0).toFixed(4)),
    skipped,
  };
}
