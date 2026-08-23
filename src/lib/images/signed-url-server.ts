import "server-only";

import type { DraftView } from "@/lib/drafts";
import { env } from "@/lib/env";
import { recordUnexpectedError } from "@/lib/observability/sentry";
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
  const paths = [...new Set(targets.map((img) => img.storage_path))];
  /*
    **1リクエストにまとめる**（T-M8-246）。以前は1枚ずつ `createSignedUrl` を呼んでいたため、
    下書き一覧を開くたびに画像の枚数だけStorageへ往復していた。
    **失敗も記録する**——署名URLが作れないと画面から画像が黙って消えるので、
    「画像が出ない」の原因が運営者には辿れなかった（CLAUDE.md 原則1/2）。
  */
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrls(paths, SIGNED_URL_TTL_SEC);
  if (error) {
    recordUnexpectedError(error, { at: "signed-url", count: paths.length });
  }
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl);
    else if (entry.error) {
      recordUnexpectedError(new Error(`signed url failed: ${entry.error}`), {
        at: "signed-url",
        path: entry.path ?? null,
      });
    }
  }

  return drafts.map((d) => ({
    ...d,
    images: d.images.map((img) =>
      img.status === "ready" && urlByPath.has(img.storage_path)
        ? { ...img, signed_url: urlByPath.get(img.storage_path) }
        : img,
    ),
  }));
}
