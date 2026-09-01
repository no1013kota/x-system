import type { DraftImage } from "@/lib/drafts";

/**
 * ポストごとの画像の割り当て（T-M8-398・運営者の指示 2026-09-01）。
 *
 * `drafts.images` は配列で、各画像は `post_local_id` でスレッド内のポストへ紐づく。
 * **旧データは `post_local_id` を持たない**（下書き単位で1枚だった時代）——
 * その画像は「1ポスト目のもの」として扱う。ここを1か所に固定しないと、
 * 画面・生成job・アップロード・投稿処理で解釈がずれる。
 */

/** この画像がどのポストのものか（未指定は1ポスト目・旧データ互換）。 */
export function effectiveImagePost(
  image: { post_local_id?: string },
  firstPostLocalId: string,
): string {
  return image.post_local_id ?? firstPostLocalId;
}

/** 対象ポストの画像だけを差し替える（他のポストの画像は残す）。 */
export function imagesReplacingPost<T extends { post_local_id?: string }>(
  current: T[],
  firstPostLocalId: string,
  next: DraftImage,
): (T | DraftImage)[] {
  const target = effectiveImagePost(next, firstPostLocalId);
  return [
    ...current.filter((img) => effectiveImagePost(img, firstPostLocalId) !== target),
    next,
  ];
}

/** 対象ポストの ready 画像（無ければ undefined）。 */
export function readyImageForPost<T extends { post_local_id?: string; status?: string }>(
  images: T[],
  firstPostLocalId: string,
  postLocalId: string,
): T | undefined {
  return images.find(
    (img) =>
      img.status === "ready" && effectiveImagePost(img, firstPostLocalId) === postLocalId,
  );
}

/** 対象ポストに紐づく既存画像のStorage path（差し替え時に消す対象）。 */
export function imagePathsForPost(
  images: { post_local_id?: string; storage_path?: string }[],
  firstPostLocalId: string,
  postLocalId: string,
): string[] {
  return images
    .filter((img) => effectiveImagePost(img, firstPostLocalId) === postLocalId)
    .map((img) => img.storage_path)
    .filter((path): path is string => Boolean(path));
}
