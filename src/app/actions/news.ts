"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { errorResult } from "./_helpers";
import {
  listCreatedNewsItemIdsForAccount,
  listNewsItemsForUser,
} from "@/lib/news-items-server";
import type { NewsItemView } from "@/lib/news-items";
import { AppError } from "@/lib/observability/errors";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

/**
 * SC-06 ニュース一覧の Server Action（要件05 §6）。認証済みユーザー向けに分野・インパクト・時間窓・
 * cursor で `news_items` を返す。検証は `listNewsItems`（`listNewsItemsSchema`）が担う。
 */

export interface ListNewsItemsActionResult {
  status: "error" | "success";
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  items?: NewsItemView[];
  nextCursor?: string | null;
  /** 表示中Xアカウントで作成済みの news_item_id（作成済みバッジ用）。 */
  createdNewsItemIds?: string[];
}

export async function listNewsItemsAction(
  input: unknown = {},
): Promise<ListNewsItemsActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return errorResult(new AppError("unauthorized"));
  }
  try {
    const page = await listNewsItemsForUser(input ?? {});
    const activeId = await resolveActiveXAccountForUser(user.id);
    const createdNewsItemIds = activeId
      ? await listCreatedNewsItemIdsForAccount(
          activeId,
          page.items.map((i) => i.id),
        )
      : [];
    return {
      createdNewsItemIds,
      items: page.items,
      message: "",
      nextCursor: page.nextCursor,
      status: "success",
    };
  } catch (error) {
    return errorResult(error);
  }
}
