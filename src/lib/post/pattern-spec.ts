import { SYSTEM_DEFAULT_TEMPLATES, type PromptTemplateKind } from "@/lib/prompts/gen-prompts";

/**
 * 投稿パターンの設定（`post_patterns` の1行、またはジョブに凍結された snapshot）。
 *
 * 生成の振る舞いは**すべてここから決まる**（T-M8-129 U2・ADR-0008）。以前は
 * `switch (pattern) { case "p1": ... }` が検索回数・出典の必須・ポスト数上限・
 * ニュースダイジェストの有無を決めていた。利用者がパターンを追加できるようになると
 * `p1` のような固定IDでは表せないため、値を持ち回る形にする。
 *
 * **ジョブは enqueue 時点の spec を凍結して持つ**（`generation_jobs.pattern_spec`）。
 * 実行中にパターンを編集・削除されても、走っているジョブは当時の設定で完走する。
 */
export interface PatternSpec {
  id: string;
  /** 既定として投入されたパターンの元ID（`p1`〜`p6`）。自作は null。 */
  seedKey: PromptTemplateKind | null;
  /** 画面に出る唯一の名前。 */
  name: string;
  description: string | null;
  /** null = システム既定（`SYSTEM_DEFAULT_TEMPLATES[seedKey]`）を使う。 */
  prompt: string | null;
  maxPosts: number;
  webSearchPolicy: PatternPolicy;
  webSearchMaxUses: number;
  sourcePolicy: PatternPolicy;
  includeNewsDigest: boolean;
  asksUserOpinion: boolean;
  requiresQuoteUrl: boolean;
}

/** `always`=常に / `with_url`=入力にURLがあるときだけ / `never`=しない。 */
export type PatternPolicy = "always" | "with_url" | "never";

const POLICIES: readonly PatternPolicy[] = ["always", "with_url", "never"];

function asPolicy(value: unknown): PatternPolicy | null {
  return typeof value === "string" && (POLICIES as readonly string[]).includes(value)
    ? (value as PatternPolicy)
    : null;
}

/** 既定パターンの元ID。`image` は型ではないので含めない（DBの CHECK と同じ集合）。 */
const PATTERN_SEED_KEYS = ["p1", "p2", "p3", "p4", "p5", "p6"] as const;

function asSeedKey(value: unknown): PromptTemplateKind | null {
  return typeof value === "string" && (PATTERN_SEED_KEYS as readonly string[]).includes(value)
    ? (value as PromptTemplateKind)
    : null;
}

/**
 * `generation_jobs.pattern_spec`（jsonb）や `pattern_spec_of()` の戻りを型へ写す。
 *
 * **形が違うものは `null` を返す**（既定値で埋めない）。埋めてしまうと「意図した設定で
 * 生成したのか、壊れた入力を勝手に補ったのか」を呼び出し側が区別できなくなる
 * （CLAUDE.md 原則1）。呼び出し側は null を受けたら失敗として扱う。
 */
export function parsePatternSpec(value: unknown): PatternSpec | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const id = raw.id;
  const name = raw.name;
  const maxPosts = raw.max_posts;
  const webSearchMaxUses = raw.web_search_max_uses;
  const webSearchPolicy = asPolicy(raw.web_search_policy);
  const sourcePolicy = asPolicy(raw.source_policy);

  if (typeof id !== "string" || id === "") return null;
  if (typeof name !== "string" || name === "") return null;
  if (typeof maxPosts !== "number" || !Number.isInteger(maxPosts) || maxPosts < 1) return null;
  if (
    typeof webSearchMaxUses !== "number" ||
    !Number.isInteger(webSearchMaxUses) ||
    webSearchMaxUses < 0
  ) {
    return null;
  }
  if (!webSearchPolicy || !sourcePolicy) return null;

  return {
    id,
    seedKey: asSeedKey(raw.seed_key),
    name,
    description: typeof raw.description === "string" ? raw.description : null,
    prompt: typeof raw.prompt === "string" && raw.prompt !== "" ? raw.prompt : null,
    maxPosts,
    webSearchPolicy,
    webSearchMaxUses,
    sourcePolicy,
    includeNewsDigest: raw.include_news_digest === true,
    asksUserOpinion: raw.asks_user_opinion === true,
    requiresQuoteUrl: raw.requires_quote_url === true,
  };
}

/**
 * このパターンで使うプロンプト本文。`prompt` が null ならシステム既定（コード定数）。
 *
 * 既定を「行が無い」ではなく「null」で表すので、**コード側のプロンプト改善が、既定のままに
 * しているアカウントへそのまま届く**（T-M7-37 の回帰防止）。既定でないのにプロンプトが無い
 * （＝自作なのに空）状態はDBのCHECKで作れないが、snapshot が壊れている場合に備え null を返す。
 */
export function patternPrompt(spec: PatternSpec): string | null {
  if (spec.prompt !== null) return spec.prompt;
  if (spec.seedKey === null) return null;
  return SYSTEM_DEFAULT_TEMPLATES[spec.seedKey];
}

/**
 * Web検索の設定。再試行（attempt >= 2）では `pause_turn` の未完了を避けるため1段階ずつ縮小する
 * （プロンプト設計書 §5.2「4→2」）。使わない場合は undefined を返す（provider へ tool を渡さない）。
 */
export function webSearchForSpec(
  spec: PatternSpec,
  hasUrl: boolean,
  attempt: number,
  /** 縮小規則は provider 側の `reduceWebSearchMaxUses` を渡す（同じ規則を2か所に書かない）。 */
  reduce: (maxUses: number) => number,
): { maxUses: number } | undefined {
  if (spec.webSearchPolicy === "never" || spec.webSearchMaxUses === 0) return undefined;
  if (spec.webSearchPolicy === "with_url" && !hasUrl) return undefined;
  let maxUses = spec.webSearchMaxUses;
  for (let i = 1; i < attempt; i++) maxUses = reduce(maxUses);
  return { maxUses };
}

/** 出典URLを必須とするか。`with_url` は入力にURLがあるときだけ必須。 */
export function sourceRequiredForSpec(spec: PatternSpec, hasReferenceUrl: boolean): boolean {
  if (spec.sourcePolicy === "always") return true;
  if (spec.sourcePolicy === "with_url") return hasReferenceUrl;
  return false;
}
