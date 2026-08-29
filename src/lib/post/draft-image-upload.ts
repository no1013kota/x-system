import { AppError } from "@/lib/observability/errors";

import type { DraftImage } from "../drafts";

/**
 * 下書きへ自分で画像を添える（T-M8-353・運営者の指示 2026-08-28）。
 *
 * **AIに作らせるだけでなく、手元の画像を投稿に付けられるようにする。** 生成した絵が
 * 意図と違うとき、これまでは「画像なしで出す」か「作り直して当たりを待つ」しかなかった。
 *
 * **投稿に使われる画像は1枚**（`post-publish` は最初の `ready` 画像を使う）。だから
 * アップロードは**置き換え**にする——2枚目を足せる形にすると、画面には2枚出ているのに
 * 投稿されるのは片方、という説明できない状態になる（原則1）。差し替えた古い画像は
 * Storageから消す（残すと使われない実体が課金対象として増え続ける・原則4）。
 */

/** 受け取る形式。Xが受け付ける静止画と同じにする（変換は `normalizeForX` が行う）。 */
export const UPLOAD_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * 受け取る前に断る大きさ（バイト）。**5MB**（T-M8-367・運営者の決定 2026-08-29「案A」）。
 *
 * Xの投稿画像の上限が5MBで、`normalizeForX` もそこまでしか圧縮できない。それより大きい元画像を
 * 受けても最終的に弾くだけなので、Xの上限に合わせる。**`next.config` の
 * `serverActions.bodySizeLimit` と揃える**——フレームワークの本文上限より大きい値をここに書くと、
 * この検査に届く前にフレームワーク層で汎用エラーになり、「何MBまでか」を画面で言えなくなる（D-50）。
 */
export const UPLOAD_MAX_INPUT_BYTES = 5 * 1024 * 1024;

export interface UploadedFileInfo {
  name: string;
  type: string;
  size: number;
}

/**
 * 受け取ってよいファイルか。**理由は画面にそのまま出す**（「アップロードできません」だけだと
 * 何を直せばよいか分からない・原則2）。
 */
export function assertUploadableImage(file: UploadedFileInfo): void {
  if (file.size <= 0) {
    throw new AppError("validation_error", {
      message: "ファイルが空です。別の画像を選んでください。",
      details: { reason: "empty" },
    });
  }
  if (file.size > UPLOAD_MAX_INPUT_BYTES) {
    throw new AppError("validation_error", {
      message: `画像は${Math.floor(UPLOAD_MAX_INPUT_BYTES / 1024 / 1024)}MBまでです。小さくしてからお試しください。`,
      details: { reason: "too_large", max: UPLOAD_MAX_INPUT_BYTES },
    });
  }
  /*
    **申告されたMIMEを信じ切らない。** ここは入口の足切りで、実際の形式は
    `normalizeForX` が中身（マジックバイト）から判定して変換する。
  */
  if (!(UPLOAD_ALLOWED_MIME as readonly string[]).includes(file.type)) {
    throw new AppError("validation_error", {
      message: "PNG・JPEG・WEBPの画像を選んでください。",
      details: { reason: "unsupported_type", type: file.type },
    });
  }
}

/** Storageの置き場。生成画像と同じ並び（利用者/アカウント/下書き/画像ID）にそろえる。 */
export function draftImagePath(params: {
  userId: string;
  xAccountId: string;
  draftId: string;
  localId: string;
  ext: string;
}): string {
  return `${params.userId}/${params.xAccountId}/${params.draftId}/${params.localId}.${params.ext}`;
}

/** 置き換え後の `drafts.images`（1枚だけ）。 */
export function uploadedImagesJson(image: DraftImage): DraftImage[] {
  return [image];
}

/** 置き換えで不要になる既存画像のStorage path（消す対象）。 */
export function replacedImagePaths(current: DraftImage[], keepPath: string): string[] {
  return current
    .map((img) => img.storage_path)
    .filter((path): path is string => Boolean(path) && path !== keepPath);
}
