"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import { pooledQueryable } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { recordUnexpectedError } from "@/lib/observability/sentry";
import {
  normalizeTrafficSourceLabel,
  parseTrafficSource,
  TRAFFIC_SOURCE_LABEL_MAX,
} from "@/lib/ops/traffic-source";

import type { TrafficSourceFormState } from "./traffic-source-form-state";

/** 運営者（SUPPORT_EMAIL）以外は何もできない。/admin のゲートと同じ判定。 */
async function isOperator(): Promise<boolean> {
  const user = await getCurrentUser();
  const operator = env.SUPPORT_EMAIL;
  return Boolean(user && operator && (user.email ?? "").toLowerCase() === operator.toLowerCase());
}

/**
 * 流入元を登録する（T-M8-423）。slug は URL の `?src=` に入る値で、後から変えられない
 * （配った追跡URLが切れるため）。同じ slug は「登録済み」として弾く。
 */
export async function createTrafficSource(
  _previous: TrafficSourceFormState,
  formData: FormData,
): Promise<TrafficSourceFormState> {
  if (!(await isOperator())) return { status: "error", message: "この操作はできません。" };
  const slugRaw = formData.get("slug");
  const slug = parseTrafficSource(slugRaw);
  if (slug === "" || (typeof slugRaw === "string" && slugRaw.trim().toLowerCase() !== slug)) {
    return {
      status: "error",
      message: "URLに入る名前は、小文字の英数字・_・- の1〜32文字にしてください（例: x_bio）。",
    };
  }
  const label = normalizeTrafficSourceLabel(formData.get("label"));
  if (!label) {
    return { status: "error", message: `表示名は1〜${TRAFFIC_SOURCE_LABEL_MAX}文字で入力してください。` };
  }
  try {
    const { rowCount } = await pooledQueryable().query(
      `insert into traffic_sources (slug, label) values ($1, $2)
       on conflict (slug) do nothing`,
      [slug, label],
    );
    if ((rowCount ?? 0) === 0) {
      return { status: "error", message: `「${slug}」は登録済みです。別の名前にしてください。` };
    }
  } catch (err) {
    recordUnexpectedError(err, { at: "admin.createTrafficSource" });
    return { status: "error", message: "登録できませんでした。時間をおいて再度お試しください。" };
  }
  revalidatePath("/admin");
  return { status: "success", message: `「${label}」を登録しました。追跡URLを配ってください。` };
}
