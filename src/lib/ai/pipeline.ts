import type { ZodType } from "zod";

import { parseAndValidate } from "./parse";
import { failedProviderCall, toProviderCall, type ProviderCall } from "./normalize";
import { estimateProviderCost } from "./pricing";
import type { GenerationUsage } from "./usage-schema";
import type { Provider, TextGen, TextGenRequest } from "./types";

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
  /** 解決済みprovider（例外時の失敗call記録に使う。アダプタからは取れないため呼び出し側が渡す）。 */
  providerId: Provider;
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

/** 例外へ蓄積usageを載せる（型は変えない）。 */
function attachUsage(error: unknown, usage: GenerationUsage): void {
  if (typeof error === "object" && error !== null) {
    (error as { usage?: GenerationUsage }).usage = usage;
  }
}

/**
 * `runTextGeneration` が投げた例外に載っている usage を取り出す（D-4 案A）。
 * 例外で終わったcallも原価台帳へ記録するために使う。載っていなければ null。
 */
export function usageFromError(error: unknown): GenerationUsage | null {
  const usage =
    typeof error === "object" && error !== null
      ? (error as { usage?: unknown }).usage
      : undefined;
  if (!usage || typeof usage !== "object") return null;
  const calls = (usage as { calls?: unknown }).calls;
  return Array.isArray(calls) ? (usage as GenerationUsage) : null;
}

function readString(error: unknown, key: string): string | null {
  const value =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)[key]
      : undefined;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 台帳へ残す error code。providerの応答本文は入れず、安全な短い識別子だけにする
 * （HTTP status → `http_<status>`、SDKのcode/name → そのまま、いずれも無ければ `unknown_error`）。
 */
function failureCode(error: unknown): string {
  const status =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>).status
      : undefined;
  if (typeof status === "number" && Number.isFinite(status)) return `http_${status}`;
  const code = readString(error, "code");
  if (code && /^[A-Za-z][A-Za-z0-9_.-]{0,62}$/.test(code)) return code;
  const name = readString(error, "name");
  if (name && /^[A-Za-z][A-Za-z0-9_.-]{0,62}$/.test(name)) return name;
  return "unknown_error";
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
    let out;
    try {
      out = await opts.provider.generate(req);
    } catch (error) {
      // 例外で終わったcallも「発生事実」として残す（要件04 §10・D-4 案A）。SDKはthrow時に
      // usageを返さないため、記録できるのは request ID と error code に限られる。
      calls.push(
        failedProviderCall({
          provider: opts.providerId,
          model: opts.model,
          operation: opts.operation,
          latencyMs: now() - start,
          requestId: readString(error, "requestId") ?? readString(error, "request_id"),
          errorCode: failureCode(error),
        }),
      );
      // 例外はそのまま投げる（retry分類が status/kind を見るため型を変えない）。蓄積済みの
      // usage だけを載せ、呼び出し側が catch で台帳へ記録できるようにする。
      attachUsage(error, buildUsage(calls));
      throw error;
    }
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
