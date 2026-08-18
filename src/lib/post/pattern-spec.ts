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
  /** 下書き編集で許すポスト数の上限。日次枠・投稿枠の見積りにも使う（最悪ケース）。 */
  maxPostsEdit: number;
  webSearchPolicy: PatternPolicy;
  webSearchMaxUses: number;
  sourcePolicy: PatternPolicy;
  /** 直近のニュースをまとめて渡すか。 */
  includeNewsDigest: boolean;
  requiresQuoteUrl: boolean;
  /** プロンプト内の `{名前}` に差し込む入力の定義（T-M8-132）。 */
  placeholders: { name: string }[];
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
  const maxPostsEdit = raw.max_posts_edit;
  const webSearchMaxUses = raw.web_search_max_uses;
  const webSearchPolicy = asPolicy(raw.web_search_policy);
  const sourcePolicy = asPolicy(raw.source_policy);

  if (typeof id !== "string" || id === "") return null;
  if (typeof name !== "string" || name === "") return null;
  if (typeof maxPosts !== "number" || !Number.isInteger(maxPosts) || maxPosts < 1) return null;
  if (
    typeof maxPostsEdit !== "number" ||
    !Number.isInteger(maxPostsEdit) ||
    maxPostsEdit < maxPosts
  ) {
    return null;
  }
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
    maxPostsEdit,
    webSearchPolicy,
    webSearchMaxUses,
    sourcePolicy,
    includeNewsDigest: raw.include_news_digest === true,
    requiresQuoteUrl: raw.requires_quote_url === true,
    placeholders: Array.isArray(raw.placeholders)
      ? raw.placeholders
          .map((v) => (v as { name?: unknown } | null)?.name)
          .filter((n): n is string => typeof n === "string" && n.length > 0)
          .map((name) => ({ name }))
      : [],
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

/**
 * 予約（スケジュール）で1回動いたときに必要な投稿枠（要件03 §7.4・要件04 §7.1）。
 *
 * **enum のIDで引く定数（旧 `ROLLBACK_SAFE_BUDGET`）をやめ、パターンの設定から導く**
 * （T-M8-129 U3）。利用者が作ったパターンには `p1` のようなIDが無いため。
 *
 * 仮定は要件04 §7.1 のまま:「出典を付けるパターンは最終1件がURL付き、先行は通常」。
 * 予約実行では利用者が参考URLを渡さないので、**`with_url` のパターンはURLを付けない**
 * （`always` だけが出典URLを必ず付ける）。
 * 必要量は `requiredPostSlots` と同じ式（全件成功と、最終失敗時のprefixロールバックの大きい方）。
 *
 * 既定6種で移行前の値と一致する: P-1=通常10+URL1、P-2=通常1+URL0、P-3=12+1、P-4=8+1、P-6=12+1。
 */
export function scheduledPostSlots(spec: PatternSpec): { normal: number; url: number } {
  // 上限まで作られる最悪ケースで見積もる（編集で増やせる分も含む）。
  const posts = Math.max(1, spec.maxPostsEdit);
  // **出典URLが付きうるか**を保守的に見る。予約実行では利用者が参考URLを渡さないので、
  // 「必ずWeb検索する」か「出典を必ず求める」パターンだけがURLを付ける。
  // 既定では P-1/P-3/P-4/P-6 が該当し、単発の P-2 は該当しない（要件04 §7.1 の数値と一致）。
  const lastIsUrl = spec.webSearchPolicy === "always" || spec.sourcePolicy === "always";
  const url = lastIsUrl ? 1 : 0;
  const normal = posts - url;
  // 最終投稿が失敗するとprefix（末尾直前まで）は作成＋削除で2回消費する。
  const prefixNormal = posts - 1;
  return {
    normal: Math.max(normal, 2 * prefixNormal),
    url,
  };
}

/**
 * パターンの設定をプロンプトへ渡す文（T-M8-131・運営者の指摘 2026-08-18）。
 *
 * **設定が生成に効いていることを、AIに渡す文の形で見えるようにする。**
 * それまでスレッド数は生成後の切り詰めだけ、参考URLの方針は生成後の検証だけで、
 * **AIには一言も伝えていなかった**。指示しないまま切り詰めるので、
 * 「締めが落ちた」「参考URLが無いと言われる」が起きやすい。
 *
 * 数字はここだけに書く。既定プロンプト本文からは分量・検索回数の数字を外した——
 * 2か所に書くと、設定を変えたときに本文だけ古い数字が残って食い違う（T-M8-33 と同じ型）。
 */
export function buildPatternRules(
  spec: PatternSpec,
  ctx: { hasInputUrl: boolean; webSearchMaxUses: number | null },
): string {
  const lines: string[] = [];

  lines.push(
    spec.maxPosts <= 1
      ? "分量: メインポストのみ（スレッドにしない。posts は1要素）"
      : `分量: メインポスト＋スレッド最大${spec.maxPosts - 1}（posts は合計${spec.maxPosts}要素以内）`,
  );

  if (ctx.webSearchMaxUses === null) {
    lines.push(
      spec.webSearchPolicy === "with_url"
        ? "Web検索: 使わない（<input>に参考URLが無いため）"
        : "Web検索: 使わない",
    );
  } else {
    lines.push(`Web検索: 使う（最大${ctx.webSearchMaxUses}回）`);
  }

  if (spec.sourcePolicy === "always") {
    lines.push(
      "参考URL: 内容の根拠になるURLを1つ以上 sources へ入れる（本文にURLは書かない）",
    );
  } else if (spec.sourcePolicy === "with_url") {
    lines.push(
      ctx.hasInputUrl
        ? "参考URL: <input>のURLを含め、根拠になるURLを sources へ入れる（本文にURLは書かない）"
        : "参考URL: 無理に付けない（sources は空でよい）",
    );
  } else {
    lines.push("参考URL: 付けない（sources は空でよい）");
  }

  return lines.join("\n");
}

/** 未入力のプレースホルダーに入れる語（`<input>` の書き方と揃える）。 */
const PLACEHOLDER_UNSPECIFIED = "（未指定）";

/**
 * プロンプト内の `{名前}` を利用者の入力で置き換える（T-M8-132）。
 *
 * **正規表現を使わない。** 名前は利用者が決めるので、`.` や `(` のような
 * 正規表現の特殊文字が入りうる。分割・結合なら文字列としてそのまま扱える。
 *
 * 未入力の項目は「（未指定）」にする。**空文字で消さない**——`{対象読者}` が
 * 消えると文が壊れ、AIが何を指示されているのか読めなくなる。
 */
export function fillPlaceholders(
  prompt: string,
  placeholders: readonly { name: string }[],
  values: Readonly<Record<string, string>>,
): string {
  let out = prompt;
  for (const { name } of placeholders) {
    const raw = values[name];
    const value = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : PLACEHOLDER_UNSPECIFIED;
    out = out.split(`{${name}}`).join(value);
  }
  return out;
}
