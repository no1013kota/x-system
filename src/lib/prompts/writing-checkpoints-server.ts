import "server-only";

import { AppError } from "@/lib/observability/errors";

import { pooledQueryable } from "../db/pool";
import {
  isKnownWritingCheckpointId,
  normalizeWritingCheckpointIds,
} from "./writing-checkpoints";

/**
 * 書き方のチェックポイントの読み書き（T-M8-447）。本人のアカウントだけ。プランで制限しない
 * （アカウント.md の編集は全プランで可・T-M8-168）。
 */

export async function readWritingCheckpoints(params: {
  userId: string;
  xAccountId: string;
}): Promise<string[]> {
  const db = pooledQueryable();
  const { rows } = await db.query<{ writing_checkpoints: unknown }>(
    `select writing_checkpoints from x_accounts where id = $1 and user_id = $2`,
    [params.xAccountId, params.userId],
  );
  if (!rows[0])
    throw new AppError("not_found", {
      details: { reason: "x_account_not_found" },
    });
  return normalizeWritingCheckpointIds(rows[0].writing_checkpoints);
}

/**
 * 選択を丸ごと置き換える。未知の ID は拒否（黙って落とさない。古い画面から来た ID を静かに消すと
 * 「チェックしたのに保存されない」になる）。
 */
export async function saveWritingCheckpoints(params: {
  userId: string;
  xAccountId: string;
  checkpointIds: string[];
}): Promise<string[]> {
  const unknown = params.checkpointIds.filter(
    (id) => !isKnownWritingCheckpointId(id),
  );
  if (unknown.length > 0) {
    throw new AppError("validation_error", {
      message: `不明なチェックポイントです: ${unknown.join(", ")}（画面を再読み込みしてください）`,
    });
  }
  const ids = normalizeWritingCheckpointIds(params.checkpointIds);
  const db = pooledQueryable();
  const { rowCount } = await db.query(
    `update x_accounts set writing_checkpoints = $3::jsonb where id = $1 and user_id = $2`,
    [params.xAccountId, params.userId, JSON.stringify(ids)],
  );
  if (rowCount === 0)
    throw new AppError("not_found", {
      details: { reason: "x_account_not_found" },
    });
  return ids;
}
