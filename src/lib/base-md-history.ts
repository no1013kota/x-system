/** 最小のクエリ実行者。pool・PoolClient・job側のtxをそのまま渡せる形にする。 */
interface HistoryQueryable {
  query: <T = unknown>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * 1アカウントあたり保持するアカウント.mdの版数（運営者の指示・2026-08-20・T-M8-156）。
 *
 * `base_md_versions` は版ごとに**アカウント.md全文**を持ち、削除経路が1つも無かった。
 * しかも `md_merge` ジョブが学習のたびに自動で版を積むため、利用者が何もしなくても
 * 無制限に増え続け、ストレージ費用が読めなくなっていた（原則4「費用が見える」）。
 *
 * **この上限はロールバック可能な範囲でもある。** 6版以上前へは戻せない（要件05）。
 */
export const BASE_MD_HISTORY_LIMIT = 5;

/**
 * 最新 `BASE_MD_HISTORY_LIMIT` 版だけを残し、それより古い版を消す。
 *
 * **版を積んだのと同じtransactionの中で呼ぶ。** 別ジョブに寄せると「忘れたら効かない手順」に
 * なる（原則3）。version は `unique(x_account_id, version)` で単調増加なので、
 * 残す集合は「version降順の先頭N件」で一意に決まる。
 *
 * @returns 削除した版数
 */
export async function pruneBaseMdVersions(
  db: HistoryQueryable,
  xAccountId: string,
  limit: number = BASE_MD_HISTORY_LIMIT,
): Promise<number> {
  const { rowCount } = await db.query(
    `delete from base_md_versions
      where x_account_id = $1
        and version not in (
          select version from base_md_versions
           where x_account_id = $1
           order by version desc
           limit $2
        )`,
    [xAccountId, limit],
  );
  return rowCount ?? 0;
}
