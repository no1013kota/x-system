import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool } from "../db/pool";
import { X_SCOPES } from "../x/oauth";
import { WRITING_CHECKPOINTS } from "./writing-checkpoints";
import {
  readWritingCheckpoints,
  saveWritingCheckpoints,
} from "./writing-checkpoints-server";

/**
 * 書き方のチェックポイントの保存（T-M8-447）。本番実装をそのまま実DBで通す。
 * 守るもの: 本人のアカウントだけ書ける／未知のIDは拒否（黙って落とさない）／保存した選択がそのまま読める。
 */
let available = false;
beforeAll(async () => {
  try {
    const c = await getPool().connect();
    c.release();
    available = true;
  } catch {
    available = false;
  }
});
afterAll(async () => {
  await closePool();
});
beforeEach((ctx) => {
  if (!available) ctx.skip();
});

const testKey = randomBytes(32);
const encrypt = (p: string) => encryptWithKey(p, testKey);

async function createUserAndAccount(): Promise<{
  userId: string;
  xAccountId: string;
}> {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  const pool = getPool();
  await pool.query(
    `insert into auth.users (id, instance_id, aud, role, email)
     values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
    [userId, email],
  );
  await pool.query(
    `insert into profiles (id, email, plan) values ($1,$2,'premium') on conflict (id) do update set plan = 'premium'`,
    [userId, email],
  );
  const { rows } = await pool.query<{ id: string }>(
    `insert into x_accounts
       (user_id, x_user_id, handle, name, auth_type, status,
        access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at, base_md, base_md_version)
     values ($1,$2,'h','n','byok','active',$3,$3,$4, now()+interval '1 hour', '', 0)
     returning id`,
    [userId, `x-${randomUUID()}`, encrypt("t"), X_SCOPES],
  );
  return { userId, xAccountId: rows[0]!.id };
}

async function cleanup(userId: string) {
  await getPool().query(`delete from auth.users where id = $1`, [userId]);
}

describe("writing checkpoints（実DB）", () => {
  it("保存した選択がカタログ順で読める。本人以外は書けない。未知のIDは拒否", async () => {
    const own = await createUserAndAccount();
    const other = await createUserAndAccount();
    try {
      const ids = [
        WRITING_CHECKPOINTS[WRITING_CHECKPOINTS.length - 1]!.id,
        WRITING_CHECKPOINTS[0]!.id,
      ];
      const saved = await saveWritingCheckpoints({
        userId: own.userId,
        xAccountId: own.xAccountId,
        checkpointIds: ids,
      });
      expect(saved).toEqual([
        WRITING_CHECKPOINTS[0]!.id,
        WRITING_CHECKPOINTS[WRITING_CHECKPOINTS.length - 1]!.id,
      ]);
      expect(
        await readWritingCheckpoints({
          userId: own.userId,
          xAccountId: own.xAccountId,
        }),
      ).toEqual(saved);

      await expect(
        saveWritingCheckpoints({
          userId: other.userId,
          xAccountId: own.xAccountId,
          checkpointIds: [],
        }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        saveWritingCheckpoints({
          userId: own.userId,
          xAccountId: own.xAccountId,
          checkpointIds: ["zzz-9"],
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
      // 拒否後も前の選択が残る
      expect(
        await readWritingCheckpoints({
          userId: own.userId,
          xAccountId: own.xAccountId,
        }),
      ).toEqual(saved);
    } finally {
      await cleanup(own.userId);
      await cleanup(other.userId);
    }
  });
});
