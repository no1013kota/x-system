import "server-only";

import type { DraftView } from "@/lib/drafts";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 生成画像の表示用署名URL付与（要件02 §4.8・要件06 §6, T-M3-16）。
 * private Storage の ready 画像に短時間の署名URLを生成し、DraftView へ転写する（DBへ永続化しない）。
 * 署名URLは表示時に都度生成し、失敗しても本文表示は継続する（url未設定で返す）。
 */

/** 署名URLの有効期限（秒）。短時間に留める。 */
export const SIGNED_URL_TTL_SEC = 300;

export async function attachSignedImageUrls(drafts: DraftView[]): Promise<DraftView[]> {
  const targets = drafts.flatMap((d) =>
    d.images.filter((img) => img.status === "ready" && img.storage_path),
  );
  if (targets.length === 0) return drafts;

  const admin = createSupabaseAdminClient();
  const bucket = env.SUPABASE_STORAGE_BUCKET_IMAGES;
  const urlByPath = new Map<string, string>();
  await Promise.all(
    [...new Set(targets.map((img) => img.storage_path))].map(async (path) => {
      const { data } = await admin.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SEC);
      if (data?.signedUrl) urlByPath.set(path, data.signedUrl);
    }),
  );

  return drafts.map((d) => ({
    ...d,
    images: d.images.map((img) =>
      img.status === "ready" && urlByPath.has(img.storage_path)
        ? { ...img, signed_url: urlByPath.get(img.storage_path) }
        : img,
    ),
  }));
}
