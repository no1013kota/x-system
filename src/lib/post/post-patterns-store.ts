import { AppError } from "@/lib/observability/errors";

import type { Queryable } from "../db/queryable";

/**
 * 投稿パターンの読み出し（T-M8-129 U3・ADR-0008）。
 *
 * **画面はここから選択肢を得る。** 以前は `POST_PATTERN_OPTIONS`（コード定数の6件）を
 * 各画面が直接importしていたため、利用者が作ったパターンはどの画面にも現れなかった。
 *
 * 返す `id` は `post_patterns.id`（uuid）で、**内部ID（`p1`）は返さない**。
 * 画面に内部IDを出さない（要件06 §1.0）という決めごとを、型のうえで守れるようにする。
 */

export interface PatternOption {
  /** `post_patterns.id`。画面とServer Actionはこれで指す。 */
  id: string;
  name: string;
  description: string | null;
  /** 生成時に作るポスト数の上限。画面の説明（「2〜4ポスト」）はこれから組む。 */
  maxPosts: number;
  /** 下書き編集で許すポスト数の上限。 */
  maxPostsEdit: number;
  /** 引用対象のX URLを毎回指定させるか。true は予約に使えない。 */
  requiresQuoteUrl: boolean;
  /** 利用者の意見・視点を入力として求めるか（画面の入力欄の出し分けに使う）。 */
  asksUserOpinion: boolean;
  /** システム既定として投入されたものか（`p1`〜`p6`）。既定を復元する導線の判定に使う。 */
  isSystemDefault: boolean;
  /** プロンプトを自分で書き換えているか（false = システム既定のまま）。 */
  hasCustomPrompt: boolean;
}

interface PatternRow {
  id: string;
  seed_key: string | null;
  name: string;
  description: string | null;
  prompt: string | null;
  max_posts: number;
  max_posts_edit: number;
  requires_quote_url: boolean;
  asks_user_opinion: boolean;
}

const COLUMNS = `id, seed_key, name, description, prompt, max_posts, max_posts_edit,
                 requires_quote_url, asks_user_opinion`;

function toOption(row: PatternRow): PatternOption {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    maxPosts: row.max_posts,
    maxPostsEdit: row.max_posts_edit,
    requiresQuoteUrl: row.requires_quote_url,
    asksUserOpinion: row.asks_user_opinion,
    isSystemDefault: row.seed_key !== null,
    hasCustomPrompt: row.prompt !== null,
  };
}

/** 画面の並び順（`sort_order` → 作成順）でパターンを返す。 */
export async function listPatterns(
  db: Queryable,
  xAccountId: string,
): Promise<PatternOption[]> {
  const { rows } = await db.query<PatternRow>(
    `select ${COLUMNS} from post_patterns
      where x_account_id = $1 order by sort_order, created_at`,
    [xAccountId],
  );
  return rows.map(toOption);
}

/**
 * 予約（スケジュール）で選べるパターン。**引用URLが必須のものは除く**——
 * 毎回URLの指定が要るため自動実行できない（DBのトリガも同じ判定で拒否する）。
 */
export async function listSchedulablePatterns(
  db: Queryable,
  xAccountId: string,
): Promise<PatternOption[]> {
  const all = await listPatterns(db, xAccountId);
  return all.filter((p) => !p.requiresQuoteUrl);
}

/**
 * 1件を取り、無ければ `not_found`。**所有者チェックを兼ねる**ので、
 * Server Action は必ずこれを通してから書き込む（他人のパターンで生成させない）。
 */
export async function requirePattern(
  db: Queryable,
  xAccountId: string,
  patternId: string,
): Promise<PatternOption> {
  const { rows } = await db.query<PatternRow>(
    `select ${COLUMNS} from post_patterns where x_account_id = $1 and id = $2`,
    [xAccountId, patternId],
  );
  const row = rows[0];
  if (!row) throw new AppError("not_found", { details: { reason: "pattern_not_found" } });
  return toOption(row);
}

/**
 * 旧 enum（`p1`〜`p6`）から現在の行を引く。**移行の間だけ使う**（U5 で撤去）。
 * 既定パターンを削除済みなら null。
 */
export async function findPatternBySeedKey(
  db: Queryable,
  xAccountId: string,
  seedKey: string,
): Promise<PatternOption | null> {
  const { rows } = await db.query<PatternRow>(
    `select ${COLUMNS} from post_patterns where x_account_id = $1 and seed_key = $2`,
    [xAccountId, seedKey],
  );
  return rows[0] ? toOption(rows[0]) : null;
}

/**
 * 画面に出す説明文。**ポスト数はここで付ける**（説明文に書かせない・T-M8-33）。
 * 説明とポスト数が別々に書かれていると、片方だけ直して食い違う。
 */
export function patternDescriptionWithCount(option: PatternOption): string {
  const count = option.maxPosts === 1 ? "1ポスト" : `最大${option.maxPosts}ポスト`;
  return option.description ? `${option.description}（${count}）` : count;
}
