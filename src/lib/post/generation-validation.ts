import type { ThreadItem } from "@/lib/ai/gen-output";

import { matchNgWords } from "./ng-words";
import { MAX_WEIGHTED_LENGTH, measurePostText } from "./text-metrics";

/**
 * 生成後検証（プロンプト設計書 §7.2〜7.7, 要件06 §4.3, T-M3-06）。
 * 280超過はPT-FIXで最大2回短縮（なお超過は編集必須警告）／cashtag2件以上・NGワード・インジェクション
 * 疑い（指示への言及・不自然なURL）は自動投稿ブロック警告／SSRF検証を通過した出典だけを最終ポストへ付加。
 * NG照合・URL検証はコードで行う（LLM不使用）。shorten・validateSource は注入する。
 */

export const WARNING = {
  lengthExceeded: "length_exceeded",
  cashtagMultiple: "cashtag_multiple",
  ngWord: "ng_word",
  sourceMissing: "source_missing",
  injectionSuspected: "injection_suspected",
} as const;

export type WarningCode = (typeof WARNING)[keyof typeof WARNING];

/** これらの警告があるポストを含む下書きは自動投稿しない（要件06 §4.3）。 */
export const AUTO_POST_BLOCKING_WARNINGS: ReadonlySet<string> = new Set<string>([
  WARNING.lengthExceeded,
  WARNING.cashtagMultiple,
  WARNING.ngWord,
  WARNING.sourceMissing,
  WARNING.injectionSuspected,
]);

export const MAX_FIX_ATTEMPTS = 2;

/** pattern別の最大ポスト数（要件06 §4.3）。 */
export const PATTERN_MAX_POSTS: Record<string, number> = {
  p1: 6,
  p2: 1,
  p3: 7,
  p4: 5,
  p5: 3,
  p6: 7,
};

/**
 * 下書き編集時のポスト再検証（要件06 §4.3, T-M3-10）。加重文字数を再計算し、length/cashtag/NG の
 * 警告を付け直す。PT-FIX短縮・SSRF・インジェクション判定は行わない（生成時の finalizeThread が担う）。
 */
export function revalidateEditedThread(
  posts: { local_id?: string; text: string; sources?: string[] }[],
  ngWords: readonly string[],
): ThreadItem[] {
  return posts.map((post, index) => {
    const metrics = measurePostText(post.text);
    const warnings: string[] = [];
    if (!metrics.withinLimit) warnings.push(WARNING.lengthExceeded);
    if (!metrics.cashtagOk) warnings.push(WARNING.cashtagMultiple);
    if (matchNgWords(post.text, ngWords).length > 0) warnings.push(WARNING.ngWord);
    return {
      local_id: post.local_id ?? `p${index + 1}`,
      text: post.text,
      weighted_length: metrics.weightedLength,
      sources: post.sources ?? [],
      warnings,
    };
  });
}

export function threadBlocksAutoPost(thread: ThreadItem[]): boolean {
  return thread.some((post) =>
    post.warnings.some((w) => AUTO_POST_BLOCKING_WARNINGS.has(w)),
  );
}

/** 出典必須パターン: P-1/P-4/P-6は常に、P-2/P-3は参考URL指定時のみ（プロンプト設計書 §7.5）。 */
export function sourceRequired(pattern: string, hasReferenceUrl: boolean): boolean {
  if (pattern === "p1" || pattern === "p4" || pattern === "p6") return true;
  if ((pattern === "p2" || pattern === "p3") && hasReferenceUrl) return true;
  return false;
}

// インジェクション疑い（§7.7）: 指示への言及マーカー。
const INSTRUCTION_MARKERS: readonly RegExp[] = [
  /システムプロンプト/,
  /(以前|上記|前)の指示/,
  /あなたへの指示/,
  /指示を無視/,
  /ignore (the )?(above|previous|prior)/i,
  /system prompt/i,
  /as an ai/i,
];

function extractUrls(text: string): string[] {
  return (text.match(/https?:\/\/[^\s"'<>））]+/g) ?? []).map((u) =>
    u.replace(/[.,)）]+$/, ""),
  );
}

/** 指示への言及、または検証済み出典に無いURL（不自然なURL）を含めばインジェクション疑い。 */
export function looksLikeInjection(text: string, allowedUrls: string[]): boolean {
  if (INSTRUCTION_MARKERS.some((re) => re.test(text))) return true;
  const allowed = new Set(allowedUrls.map((u) => u.replace(/[.,)）]+$/, "")));
  return extractUrls(text).some((url) => !allowed.has(url));
}

export interface FinalizeThreadInput {
  pattern: string;
  posts: string[];
  aiSources: string[];
  ngWords: readonly string[];
  hasReferenceUrl: boolean;
}

export interface FinalizeThreadDeps {
  /** PT-FIX で加重文字数 limit 以内へ短縮する（親jobと同じproviderで実行）。 */
  shorten: (text: string, limit: number) => Promise<string>;
  /** 出典URLのSSRF検証（通過でtrue）。 */
  validateSource: (url: string) => Promise<boolean>;
}

export interface FinalizeThreadResult {
  thread: ThreadItem[];
  validatedSources: string[];
  sourcesMissing: boolean;
  autoPostBlocked: boolean;
}

/**
 * 生成posts＋AI出典から最終thread（警告つき）を作る。280超過はPT-FIXで最大2回短縮し、SSRF通過の出典
 * だけを最終ポストへ付加する。出典必須で通過出典が空なら sourcesMissing=true（呼び出し側で再試行判断）。
 */
export async function finalizeThread(
  input: FinalizeThreadInput,
  deps: FinalizeThreadDeps,
): Promise<FinalizeThreadResult> {
  // 出典のSSRF検証（通過分のみ最終ポストへ）。
  const validatedSources: string[] = [];
  for (const url of input.aiSources) {
    if (await deps.validateSource(url)) validatedSources.push(url);
  }
  const required = sourceRequired(input.pattern, input.hasReferenceUrl);
  const sourcesMissing = required && validatedSources.length === 0;

  const thread: ThreadItem[] = [];
  for (let index = 0; index < input.posts.length; index++) {
    let text = input.posts[index];
    const warnings: string[] = [];

    // 加重文字数280超過はPT-FIXで最大2回短縮（なお超過は編集必須警告）。
    let metrics = measurePostText(text);
    let attempts = 0;
    while (!metrics.withinLimit && attempts < MAX_FIX_ATTEMPTS) {
      text = await deps.shorten(text, MAX_WEIGHTED_LENGTH);
      metrics = measurePostText(text);
      attempts++;
    }
    if (!metrics.withinLimit) warnings.push(WARNING.lengthExceeded);
    if (!metrics.cashtagOk) warnings.push(WARNING.cashtagMultiple);
    if (matchNgWords(text, input.ngWords).length > 0) warnings.push(WARNING.ngWord);
    if (looksLikeInjection(text, validatedSources)) warnings.push(WARNING.injectionSuspected);

    thread.push({
      local_id: `p${index + 1}`,
      text,
      weighted_length: metrics.weightedLength,
      sources: [],
      warnings,
    });
  }

  // 検証済み出典は最終ポストへ付加。出典必須で空なら該当警告。
  if (thread.length > 0) {
    const last = thread[thread.length - 1];
    last.sources = validatedSources;
    if (sourcesMissing) last.warnings.push(WARNING.sourceMissing);
  }

  return {
    thread,
    validatedSources,
    sourcesMissing,
    autoPostBlocked: threadBlocksAutoPost(thread),
  };
}
