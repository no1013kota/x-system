import { AppError } from "@/lib/observability/errors";
import { PLANS, type PlanId } from "@/lib/plans";

import { disableAutomationForAccount } from "./automation-consent";
import { expectedAuthTypeForPlan } from "./oauth-start";
import type { Queryable } from "./token-refresh";

/**
 * Xアカウント管理Actionの中核（要件05 §4.3, A-6, 要件03 §6, 要件06 §9）。
 * DB・HTTP（token refresh / /2/users/me / token revoke）は注入し純粋に保つ。
 * 平文tokenや外部レスポンス本文はここでも扱わず（server層で復号）、Actionへはstatusだけ返す。
 */

const X_SETTINGS_PATH = "/app/settings?tab=api-keys";

export interface XAccountListItem {
  id: string;
  handle: string;
  name: string;
  profileImageUrl: string | null;
  authType: string;
  status: string;
  isActive: boolean;
  automationActive: boolean;
}

/** GET /2/users/me の正規化結果。 */
export type XMeFetcher = (accessToken: string) => Promise<{
  id: string;
  username: string;
  name: string;
  profileImageUrl: string | null;
}>;

/** transaction 実行の注入（server層は withTransaction を渡す）。 */
export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

interface OwnedAccount {
  status: string;
  authType: string;
  plan: PlanId;
}

/** 本人所有のアカウントを読む。存在しない/他人のものは not_found（列挙防止）。 */
async function readOwnedAccount(
  db: Queryable,
  xAccountId: string,
  userId: string,
): Promise<OwnedAccount> {
  const { rows } = await db.query<{
    status: string;
    auth_type: string;
    plan: PlanId;
  }>(
    `select xa.status, xa.auth_type, p.plan
       from x_accounts xa
       join profiles p on p.id = xa.user_id
      where xa.id = $1 and xa.user_id = $2`,
    [xAccountId, userId],
  );
  if (!rows[0]) throw new AppError("not_found");
  return { status: rows[0].status, authType: rows[0].auth_type, plan: rows[0].plan };
}

/** 本人のXアカウント一覧（active/自動投稿状態つき）。要件06 §9・SC-11の表示用。 */
export async function listXAccountsForUser(
  db: Queryable,
  userId: string,
): Promise<XAccountListItem[]> {
  const { rows } = await db.query<{
    id: string;
    handle: string;
    name: string;
    profile_image_url: string | null;
    auth_type: string;
    status: string;
    is_active: boolean;
    automation_active: boolean;
  }>(
    `select xa.id, xa.handle, xa.name, xa.profile_image_url, xa.auth_type, xa.status,
            (p.active_x_account_id = xa.id) as is_active,
            (xa.automation_consented_at is not null
             and xa.automation_disabled_at is null) as automation_active
       from x_accounts xa
       join profiles p on p.id = xa.user_id
      where xa.user_id = $1
      order by xa.created_at`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    name: r.name,
    profileImageUrl: r.profile_image_url,
    authType: r.auth_type,
    status: r.status,
    isActive: r.is_active,
    automationActive: r.automation_active,
  }));
}

async function readStatus(db: Queryable, xAccountId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(
    `select status from x_accounts where id = $1`,
    [xAccountId],
  );
  return rows[0]?.status ?? "error";
}

async function applyMe(
  db: Queryable,
  xAccountId: string,
  me: Awaited<ReturnType<XMeFetcher>>,
): Promise<void> {
  await db.query(
    `update x_accounts
        set handle = $2, name = $3, profile_image_url = $4,
            status = 'active', updated_at = now()
      where id = $1`,
    [xAccountId, me.username, me.name, me.profileImageUrl],
  );
}

export interface RefreshDeps {
  db: Queryable;
  getAccessToken: (xAccountId: string) => Promise<string>;
  fetchMe: XMeFetcher;
}

/**
 * `/2/users/me` で疎通確認し status を更新する（要件05 §4.3 refreshXAccountStatus）。
 * token失効（getAccessTokenがexpired化）は token-refresh 側が status=expired 済み → その値を返す。
 * tokenは有効だが /me が失敗（凍結等）は status=error にする。成功はactive化しhandle/name/画像を更新。
 */
export async function refreshXAccountStatus(
  xAccountId: string,
  userId: string,
  deps: RefreshDeps,
): Promise<{ status: string }> {
  await readOwnedAccount(deps.db, xAccountId, userId);

  let token: string;
  try {
    token = await deps.getAccessToken(xAccountId);
  } catch {
    // token refresh が invalid_grant/scope不足で status=expired にしている想定。
    return { status: await readStatus(deps.db, xAccountId) };
  }

  try {
    const me = await deps.fetchMe(token);
    await applyMe(deps.db, xAccountId, me);
    return { status: "active" };
  } catch {
    await deps.db.query(
      `update x_accounts set status = 'error', updated_at = now() where id = $1`,
      [xAccountId],
    );
    return { status: "error" };
  }
}

export interface EnableDeps {
  db: Queryable;
  runInTx: RunInTx;
  getAccessToken: (xAccountId: string) => Promise<string>;
  fetchMe: XMeFetcher;
}

/**
 * disabled/expired のアカウントを再びactive化する（要件05 §4.3 enableXAccount）。
 * (1) planに対応する auth_type 一致、(2) refresh＋/2/users/me 成功、(3) plan件数上限の空き、を
 * すべて満たす場合だけ active にする。失敗はいずれも再連携/エラー導線を返す。上限確認とactive化は
 * profiles を FOR UPDATE で読む同一transactionで直列化する（並行enableでの上限超過を防ぐ）。
 */
export async function enableXAccount(
  xAccountId: string,
  userId: string,
  deps: EnableDeps,
): Promise<{ status: string }> {
  const acct = await readOwnedAccount(deps.db, xAccountId, userId);

  const expected = expectedAuthTypeForPlan(acct.plan);
  if (acct.authType !== expected) {
    throw new AppError("forbidden", {
      details: {
        reason: "auth_type_mismatch",
        expected,
        settingsPath: X_SETTINGS_PATH,
      },
    });
  }

  let me: Awaited<ReturnType<XMeFetcher>>;
  try {
    const token = await deps.getAccessToken(xAccountId);
    me = await deps.fetchMe(token);
  } catch {
    throw new AppError("forbidden", {
      details: { reason: "reauth_required", settingsPath: X_SETTINGS_PATH },
    });
  }

  const activated = await deps.runInTx(async (tx) => {
    const prof = (
      await tx.query<{ plan: PlanId }>(
        `select plan from profiles where id = $1 for update`,
        [userId],
      )
    ).rows[0];
    if (!prof) throw new AppError("not_found");
    const active = (
      await tx.query<{ n: number }>(
        `select count(*)::int as n from x_accounts
          where user_id = $1 and status = 'active' and id <> $2`,
        [userId, xAccountId],
      )
    ).rows[0].n;
    if (active >= PLANS[prof.plan].xAccountLimit) return false;
    await tx.query(
      `update x_accounts
          set status = 'active', handle = $3, name = $4, profile_image_url = $5,
              updated_at = now()
        where id = $1 and user_id = $2`,
      [xAccountId, userId, me.username, me.name, me.profileImageUrl],
    );
    return true;
  });
  if (!activated) {
    throw new AppError("forbidden", {
      details: {
        reason: "x_account_limit_reached",
        limit: PLANS[acct.plan].xAccountLimit,
        settingsPath: X_SETTINGS_PATH,
      },
    });
  }
  return { status: "active" };
}

export interface DisconnectDeps {
  db: Queryable;
  runInTx: RunInTx;
  /** best effort の token revoke（xAccountIdからtoken/clientを解決）。失敗しても続行する。 */
  revoke: (xAccountId: string) => Promise<void>;
}

/**
 * Xアカウント連携を解除する（要件05 §4.3 disconnectXAccount）。best effortでtoken revokeを試み、
 * 保存tokenをnull化、status=disabled、自動投稿同意を停止、当該アカウントの全autoスロットを無効化する。
 * 下書き・履歴・base_md等は削除しない。active指定だった場合はactive_x_account_idをnullにする
 * （フォールバック再選択は T-M2-17）。
 */
export async function disconnectXAccount(
  xAccountId: string,
  userId: string,
  deps: DisconnectDeps,
): Promise<{ status: string }> {
  await readOwnedAccount(deps.db, xAccountId, userId);

  // token revoke は best effort（保存token削除より優先度は低い）。失敗は握りつぶす。
  try {
    await deps.revoke(xAccountId);
  } catch {
    // ignore: revoke failure must not block disconnect
  }

  await deps.runInTx(async (tx) => {
    // 自動投稿の停止（disabled_at・auto slot無効化・queued auto起点jobのcancel）を共通化（T-M4-02）。
    await disableAutomationForAccount(tx, xAccountId);
    await tx.query(
      `update x_accounts
          set access_token_ciphertext = null,
              refresh_token_ciphertext = null,
              token_expires_at = null,
              token_refresh_lock_id = null,
              token_refresh_locked_at = null,
              status = 'disabled',
              automation_consent_version = null,
              automation_consented_at = null,
              updated_at = now()
        where id = $1 and user_id = $2`,
      [xAccountId, userId],
    );
    await tx.query(
      `update profiles set active_x_account_id = null
        where id = $1 and active_x_account_id = $2`,
      [userId, xAccountId],
    );
  });
  return { status: "disabled" };
}

/**
 * 選択中Xアカウントを切り替える（要件05 §4.1 setActiveXAccount）。所有権と status=active を検証し、
 * 他人所有（not_found＝列挙防止）・非activeを拒否する。DB trigger（enforce_active_x_account_owner）は
 * 所有権のバックストップ。無効化されたアカウントの再有効化は enableXAccount の役割。
 */
export async function setActiveXAccount(
  xAccountId: string,
  userId: string,
  db: Queryable,
): Promise<void> {
  const { rows } = await db.query<{ status: string }>(
    `select status from x_accounts where id = $1 and user_id = $2`,
    [xAccountId, userId],
  );
  if (!rows[0]) throw new AppError("not_found");
  if (rows[0].status !== "active") {
    throw new AppError("validation_error", {
      details: { reason: "x_account_not_active", settingsPath: X_SETTINGS_PATH },
    });
  }
  await db.query(
    `update profiles set active_x_account_id = $2 where id = $1`,
    [userId, xAccountId],
  );
}

/**
 * 選択中Xアカウントをフォールバック規則で解決する（要件01 §5・要件02 §3.3）。/app系レイアウト読込時に呼ぶ。
 * 現在の active_x_account_id が有効（status=active）ならそのまま返す（書き込みなし）。未選択、または指す
 * アカウントが expired/disabled/不在なら `created_at, id` 最古の status=active を選び active_x_account_id へ
 * 永続化する。activeが1件も無ければ null にする。選択が変わるときだけ更新する（trigger/無駄書き込みを避ける）。
 */
export async function resolveActiveXAccount(
  db: Queryable,
  userId: string,
): Promise<string | null> {
  const current = (
    await db.query<{
      active_x_account_id: string | null;
      active_status: string | null;
    }>(
      `select p.active_x_account_id,
              (select status from x_accounts where id = p.active_x_account_id) as active_status
         from profiles p where p.id = $1`,
      [userId],
    )
  ).rows[0];
  if (!current) return null; // profile 不在
  if (current.active_x_account_id && current.active_status === "active") {
    return current.active_x_account_id; // 有効な選択を維持（書き込みなし）
  }

  const candidate =
    (
      await db.query<{ id: string }>(
        `select id from x_accounts
          where user_id = $1 and status = 'active'
          order by created_at, id
          limit 1`,
        [userId],
      )
    ).rows[0]?.id ?? null;
  if (candidate !== (current.active_x_account_id ?? null)) {
    await db.query(`update profiles set active_x_account_id = $2 where id = $1`, [
      userId,
      candidate,
    ]);
  }
  return candidate;
}
