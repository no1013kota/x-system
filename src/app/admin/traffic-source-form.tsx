"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

import { createTrafficSource } from "./actions";
import { INITIAL_TRAFFIC_SOURCE_FORM_STATE } from "./traffic-source-form-state";

const INPUT =
  "h-10 w-full rounded-md border border-hairline bg-surface px-3 text-sm text-ink placeholder:text-ink-3";

/** 流入元の登録フォーム（T-M8-423）。表示名と、URLに入る短い名前（slug）の2つだけ。 */
export function TrafficSourceForm() {
  const [state, formAction, isPending] = useActionState(
    createTrafficSource,
    INITIAL_TRAFFIC_SOURCE_FORM_STATE,
  );
  const [slug, setSlug] = useState("");
  return (
    <form action={formAction} className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
      {state.status !== "idle" ? (
        <div className="md:col-span-3">
          <Notice
            role={state.status === "error" ? "alert" : "status"}
            tone={state.status === "success" ? "success" : "danger"}
          >
            {state.message}
          </Notice>
        </div>
      ) : null}
      <div className="space-y-1">
        <label className="text-xs text-ink-2" htmlFor="traffic-source-label">
          表示名（例: Xのプロフィール）
        </label>
        <input className={INPUT} id="traffic-source-label" maxLength={60} name="label" required />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-ink-2" htmlFor="traffic-source-slug">
          URLに入る名前（小文字英数字・_・-）
        </label>
        <input
          className={INPUT}
          id="traffic-source-slug"
          maxLength={32}
          name="slug"
          onChange={(e) => setSlug(e.target.value)}
          pattern="[a-z0-9_-]{1,32}"
          placeholder="x_bio"
          required
          value={slug}
        />
      </div>
      <Button disabled={isPending} type="submit">
        {isPending ? "登録中…" : "追跡URLを発行"}
      </Button>
    </form>
  );
}
