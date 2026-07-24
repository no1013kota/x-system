import type { ZodType } from "zod";

import { parseAndValidate } from "./parse";
import { toProviderCall, type ProviderCall } from "./normalize";
import { estimateProviderCost } from "./pricing";
import type { GenerationUsage } from "./usage-schema";
import type { TextGen, TextGenRequest } from "./types";

/**
 * JSON修復付き生成パイプライン骨格（プロンプト設計書 §5.1/§7, 要件04 §5）。
 * resolveProvider→assembleContext→generate→parseAndValidate→（失敗時）修復call 1回→
 * 文字数/NG検証フック→logUsage。provider解決(T-M0-19)・context組み立て・GEN-FIX/NGの
 * 本実装は後続マイルストーン。ここではgenerate＋parse＋修復＋usage.calls蓄積までを実装する。
 */

/** 修復指示（§7.1）。初回応答がparse失敗のときだけ1回付加する。 */
export const REPAIR_INSTRUCTION =
  "前回の応答は有効なJSONとして解釈できませんでした。指定スキーマに厳密に従い、コードフェンスや前後の説明文を付けず、JSONのみを出力してください。";

export function withRepairInstruction(req: TextGenRequest): TextGenRequest {
  return { ...req, user: `${req.user}\n\n${REPAIR_INSTRUCTION}` };
}

/** parse失敗が修復callでも解消しなかった終端エラー（§5.6: JSON parse失敗はfailed・retry非対象）。 */
export class InvalidProviderOutputError extends Error {
  readonly retryable = false;
  constructor(
    /** 失敗時も蓄積済みのusageを保持し、呼び出し側がlogUsageできるようにする。 */
    readonly usage: GenerationUsage,
    message = "provider output failed JSON validation after repair",
  ) {
    super(message);
    this.name = "InvalidProviderOutputError";
  }
}

/** 検証後フック（§7.2 文字数/§7.3 NG）。M0はIFのみ。本実装は生成機能マイルストーン。 */
export interface PostValidationHooks<T> {
  enforceCharLimit?: (parsed: T) => Promise<void> | void;
  ngCheck?: (parsed: T) => Promise<void> | void;
}

export interface RunTextGenerationOptions<T> {
  provider: TextGen;
  request: TextGenRequest;
  schema: ZodType<T>;
  model: string;
  operation: string;
  /** 修復リクエストの組み立て（既定: withRepairInstruction）。 */
  repair?: (req: TextGenRequest) => TextGenRequest;
  hooks?: PostValidationHooks<T>;
  /** テスト用の時刻source（latency計測）。既定: Date.now。 */
  now?: () => number;
}

export interface RunTextGenerationResult<T> {
  parsed: T;
  usage: GenerationUsage;
}

function buildUsage(calls: ProviderCall[]): GenerationUsage {
  return {
    calls,
    estimated_cost_usd_total: calls.reduce(
      (sum, c) => sum + (c.estimated_cost_usd ?? 0),
      0,
    ),
  };
}

export async function runTextGeneration<T>(
  opts: RunTextGenerationOptions<T>,
): Promise<RunTextGenerationResult<T>> {
  const now = opts.now ?? Date.now;
  const repair = opts.repair ?? withRepairInstruction;
  const calls: ProviderCall[] = [];

  const callOnce = async (req: TextGenRequest) => {
    const start = now();
    const out = await opts.provider.generate(req);
    calls.push(
      toProviderCall(out, {
        model: opts.model,
        operation: opts.operation,
        latencyMs: now() - start,
        estimatedCostUsd: estimateProviderCost(out.provider, out.usage),
      }),
    );
    return out;
  };

  // 初回応答の検証（parseAndValidate内でコードフェンス除去→再パースまで実施）
  let out = await callOnce(opts.request);
  let result = parseAndValidate(out.text, opts.schema);

  // 失敗時のみ修復指示付きで1回だけ再生成（§7.1、job retryには含めない）
  if (!result.ok) {
    out = await callOnce(repair(opts.request));
    result = parseAndValidate(out.text, opts.schema);
  }

  const usage = buildUsage(calls);
  if (!result.ok) throw new InvalidProviderOutputError(usage);

  // 検証後フック（M0はno-op。GEN-FIX短縮・NG照合・下書き化は後続で実装）
  await opts.hooks?.enforceCharLimit?.(result.value);
  await opts.hooks?.ngCheck?.(result.value);

  return { parsed: result.value, usage };
}
