import type { ThreadItem } from "@/lib/ai/gen-output";

import { matchNgWords } from "./ng-words";
import {
  maxWeightedLengthFor,
  measurePostText,
  MIN_SHORTENED_WEIGHTED_LENGTH,
  TARGET_WEIGHTED_LENGTH,
} from "./text-metrics";
import { capPostCount } from "./thread-limits";

/**
 * 生成後検証（プロンプト設計書 §7.2〜7.7, 要件06 §4.3, T-M3-06）。
 * 280超過はPT-FIXで最大2回短縮（なお超過は編集必須警告）／cashtag2件以上・NGワード・インジェクション
 * 疑い（指示への言及・不自然なURL）は自動投稿ブロック警告／SSRF検証を通過した出典だけを最終ポストへ付加。
 * NG照合・URL検証はコードで行う（LLM不使用）。shorten・validateSource は注入する。
 */

// 警告コードと分類の正本は `warning-codes.ts`（依存ゼロ。画面からも読めるようにするため）。
// 既存の import 元を壊さないよう re-export する（ローカル参照のため import も持つ）。
import { AUTO_POST_BLOCKING_WARNINGS, WARNING } from "./warning-codes";

export {
  AUTO_POST_BLOCKING_WARNINGS,
  blocksAutoPost,
  WARNING,
  type WarningCode,
} from "./warning-codes";

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
 * `premium`（X Premium加入アカウント）は上限を25,000へ緩和する（T-M8-221。投稿直前の再検証と同じ判定）。
 */
export function revalidateEditedThread(
  posts: { local_id?: string; text: string; sources?: string[] }[],
  ngWords: readonly string[],
  opts: { premium?: boolean } = {},
): ThreadItem[] {
  const limit = maxWeightedLengthFor(opts.premium ?? false);
  return posts.map((post, index) => {
    const metrics = measurePostText(post.text, limit);
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
  /** このパターンの生成時ポスト数上限（`post_patterns.max_posts`）。 */
  maxPosts: number;
  /** 出典URLを必須とするか。判定は `sourceRequiredForSpec` が行う（T-M8-129 U2）。 */
  sourceRequired: boolean;
  posts: string[];
  aiSources: string[];
  ngWords: readonly string[];
  hasReferenceUrl: boolean;
  /** X Premium加入アカウント。true なら上限25,000・240字への読みやすさ短縮もしない（T-M8-391）。 */
  premium?: boolean;
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
  const sourcesMissing = input.sourceRequired && validatedSources.length === 0;

  // ポスト数の上限をコードで担保する（プロンプトの分量指示は守られない・T-M7-41）。
  const capped = capPostCount(input.maxPosts, input.posts);

  /*
    文字数上限はアカウントの X Premium 加入で分岐する（T-M8-391・運営者の指示 2026-09-01）。
    Premium は長文が正当な成果物なので、280への短縮も「読みやすさの240目標」も適用しない
    （どちらも本文を削る＝長文プロンプトの意図を壊す）。上限25,000だけは投稿可否として守る。
  */
  const premium = input.premium ?? false;
  const limit = maxWeightedLengthFor(premium);

  const thread: ThreadItem[] = [];
  for (let index = 0; index < capped.posts.length; index++) {
    let text = capped.posts[index];
    const warnings: string[] = [];

    // 加重文字数の上限超過はPT-FIXで最大2回短縮（なお超過は編集必須警告）。
    let metrics = measurePostText(text, limit);
    let attempts = 0;
    while (!metrics.withinLimit && attempts < MAX_FIX_ATTEMPTS) {
      text = await deps.shorten(text, limit);
      metrics = measurePostText(text, limit);
      attempts++;
    }
    if (!metrics.withinLimit) warnings.push(WARNING.lengthExceeded);

    // 読みやすさの目標（加重240）超過は1回だけ縮める。契約ではないので失敗にはしない。
    // 縮めた結果が短すぎる（内容を削り過ぎた）場合は元の本文を採る。Premiumは適用しない。
    if (!premium && metrics.withinLimit && metrics.weightedLength > TARGET_WEIGHTED_LENGTH) {
      const shortened = await deps.shorten(text, TARGET_WEIGHTED_LENGTH);
      const candidate = measurePostText(shortened, limit);
      const usable =
        candidate.withinLimit &&
        !candidate.empty &&
        candidate.weightedLength >= MIN_SHORTENED_WEIGHTED_LENGTH &&
        candidate.weightedLength < metrics.weightedLength;
      if (usable) {
        text = shortened;
        metrics = candidate;
      }
      if (metrics.weightedLength > TARGET_WEIGHTED_LENGTH) {
        warnings.push(WARNING.lengthOverTarget);
      }
    }
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
    // ポストを落としたことは黙って済ませない（運営者が下書きで気付ける）。
    if (capped.dropped > 0) last.warnings.push(WARNING.postCountTrimmed);
  }

  return {
    thread,
    validatedSources,
    sourcesMissing,
    autoPostBlocked: threadBlocksAutoPost(thread),
  };
}
