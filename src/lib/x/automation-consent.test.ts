import { describe, expect, it } from "vitest";

import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";

import {
  disableAutomationForAccount,
  disableXAutomation,
  recordXAutomationConsent,
  resumeAutomationForAccount,
  resumeXAutomation,
} from "./automation-consent";
import type { Queryable } from "./token-refresh";

type Row = Record<string, unknown>;

const XID = "44444444-4444-4444-4444-444444444444";

const RECORD = /update x_accounts\s+set automation_consent_version/;
const OWNED = /select 1 from x_accounts where id = \$1 and user_id/;
const DISABLED_AT = /automation_disabled_at = coalesce/;
const SLOTS = /update schedule_slots\s+set enabled = false/;
const RESUME_SLOTS = /update schedule_slots\s+set enabled = true/;
const PENDING = /select coalesce\(bool_or\(mode = 'auto'\), false\) as has_auto/;
const CONSENTED = /select 1 from x_accounts\s+where id = \$1 and automation_consent_version/;
const JOBS = /update generation_jobs set status = 'canceled'/;

function makeDb(handler: (sql: string) => { rows?: Row[]; rowCount: number }) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const r = handler(sql);
      return { rows: (r.rows ?? []) as T[], rowCount: r.rowCount };
    },
  };
  return { db, writes };
}

const consentInput = {
  x_account_id: XID,
  consent_version: CURRENT_AUTOMATION_CONSENT_VERSION,
  confirmed: true,
};

describe("recordXAutomationConsent", () => {
  it("saves consent (version/consented_at) and clears disabled_at", async () => {
    const { db, writes } = makeDb((sql) => ({ rowCount: RECORD.test(sql) ? 1 : 0 }));
    const state = await recordXAutomationConsent(db, "u1", consentInput);
    expect(state).toEqual({
      consentVersion: CURRENT_AUTOMATION_CONSENT_VERSION,
      consented: true,
      disabled: false,
    });
    const upd = writes.find((w) => RECORD.test(w.sql));
    expect(upd?.sql).toContain("automation_disabled_at = null");
    expect(upd?.params).toEqual([XID, "u1", CURRENT_AUTOMATION_CONSENT_VERSION]);
  });

  it("rejects an unchecked confirmation", async () => {
    const { db } = makeDb(() => ({ rowCount: 0 }));
    await expect(
      recordXAutomationConsent(db, "u1", { ...consentInput, confirmed: false }),
    ).rejects.toMatchObject({ code: "validation_error", details: { reason: "consent_not_confirmed" } });
  });

  it("rejects a stale consent version", async () => {
    const { db } = makeDb(() => ({ rowCount: 0 }));
    await expect(
      recordXAutomationConsent(db, "u1", { ...consentInput, consent_version: "old" }),
    ).rejects.toMatchObject({ code: "validation_error", details: { reason: "stale_consent_version" } });
  });

  it("throws not_found when the account is not owned", async () => {
    const { db } = makeDb(() => ({ rowCount: 0 })); // 0 rows updated
    await expect(recordXAutomationConsent(db, "u1", consentInput)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("disableAutomationForAccount", () => {
  it("既定（scope=auto）は自動投稿の枠だけを止める（切断など下書き設定を消さない経路のため）", async () => {
    const { db, writes } = makeDb(() => ({ rowCount: 1 }));
    await disableAutomationForAccount(db, XID);
    expect(writes.find((w) => SLOTS.test(w.sql))?.sql).toContain("mode = 'auto'");
    expect(writes.find((w) => JOBS.test(w.sql))?.sql).toContain("mode = 'auto'");
  });

  it("sets disabled_at, disables slots, cancels queued jobs and returns counts", async () => {
    const { db, writes } = makeDb((sql) => {
      if (SLOTS.test(sql)) return { rowCount: 2 };
      if (JOBS.test(sql)) return { rowCount: 3 };
      return { rowCount: 1 };
    });
    const res = await disableAutomationForAccount(db, XID);
    expect(res).toEqual({ disabledSlots: 2, canceledJobs: 3 });
    expect(writes.some((w) => DISABLED_AT.test(w.sql))).toBe(true);
    const jobs = writes.find((w) => JOBS.test(w.sql));
    expect(jobs?.sql).toContain("kind in ('post_generation', 'post_publish')");
    expect(jobs?.sql).toContain("status = 'queued'");
  });

  /**
   * **下書き作成の枠も止める**（T-M8-233）。以前は `mode = 'auto'` だけを無効化していたため、
   * 「すべて停止」しても下書きは作られ続けた（運営者の指摘 2026-08-23）。
   */
  it("stops draft slots too and marks what it paused so resume can restore exactly those", async () => {
    const { db, writes } = makeDb(() => ({ rowCount: 1 }));
    await disableAutomationForAccount(db, XID, "all");
    const slots = writes.find((w) => SLOTS.test(w.sql));
    expect(slots?.sql, "mode で絞ると下書き枠が止まらない").not.toContain("mode = 'auto'");
    expect(slots?.sql).toContain("paused_by_stop_all_at = now()");
    // すでに止まっていた枠には印を付けない（再開で勝手に復活させないため）。
    expect(slots?.sql).toContain("enabled = true");
    const jobs = writes.find((w) => JOBS.test(w.sql));
    expect(jobs?.sql, "下書き生成のジョブも止める").not.toContain("mode = 'auto'");
  });
});

describe("resumeAutomationForAccount", () => {
  it("restores only the slots paused by stop-all and reports whether auto is included", async () => {
    const { db, writes } = makeDb((sql) =>
      RESUME_SLOTS.test(sql) ? { rowCount: 2, rows: [{ mode: "draft" }, { mode: "auto" }] } : { rowCount: 1 },
    );
    const res = await resumeAutomationForAccount(db, XID);
    expect(res).toEqual({ resumedSlots: 2, includesAuto: true });
    const sql = writes.find((w) => RESUME_SLOTS.test(w.sql))?.sql ?? "";
    expect(sql).toContain("paused_by_stop_all_at is not null");
    expect(sql).toContain("paused_by_stop_all_at = null");
  });

  it("reports includesAuto=false when only draft slots were paused", async () => {
    const { db } = makeDb((sql) =>
      RESUME_SLOTS.test(sql) ? { rowCount: 1, rows: [{ mode: "draft" }] } : { rowCount: 1 },
    );
    expect(await resumeAutomationForAccount(db, XID)).toEqual({
      resumedSlots: 1,
      includesAuto: false,
    });
  });
});

describe("resumeXAutomation", () => {
  const deps = (db: Queryable) => ({ runInTx: <T,>(fn: (tx: Queryable) => Promise<T>) => fn(db) });

  /** 止まっている枠の内訳を返すダミー。`hasAuto` で同意の要否が変わる。 */
  function makeResumeDb(opts: { hasAuto: boolean; alreadyConsented: boolean; owned?: boolean }) {
    return makeDb((sql) => {
      if (OWNED.test(sql)) return { rowCount: opts.owned === false ? 0 : 1 };
      if (PENDING.test(sql)) {
        return { rowCount: 1, rows: [{ has_auto: opts.hasAuto, total: "1" }] };
      }
      if (CONSENTED.test(sql)) return { rowCount: opts.alreadyConsented ? 1 : 0 };
      if (RESUME_SLOTS.test(sql)) {
        return { rowCount: 1, rows: [{ mode: opts.hasAuto ? "auto" : "draft" }] };
      }
      return { rowCount: 1 };
    });
  }

  it("throws not_found for an unowned account", async () => {
    const { db } = makeResumeDb({ hasAuto: false, alreadyConsented: false, owned: false });
    await expect(
      resumeXAutomation("u1", { x_account_id: XID }, deps(db)),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("resumes draft-only schedules without asking for consent", async () => {
    const { db, writes } = makeResumeDb({ hasAuto: false, alreadyConsented: false });
    const res = await resumeXAutomation("u1", { x_account_id: XID }, deps(db));
    expect(res).toEqual({ resumedSlots: 1, includesAuto: false, consentRecorded: false });
    expect(writes.some((w) => RECORD.test(w.sql)), "同意は記録しない").toBe(false);
  });

  /** 停止＝同意の撤回なので、自動投稿を戻すときは黙って再開せず同意を取り直す（PRD §8.1）。 */
  it("requires current-version consent before resuming auto schedules", async () => {
    const { db, writes } = makeResumeDb({ hasAuto: true, alreadyConsented: false });
    await expect(
      resumeXAutomation("u1", { x_account_id: XID }, deps(db)),
    ).rejects.toMatchObject({ code: "automation_consent_required" });
    expect(writes.some((w) => RESUME_SLOTS.test(w.sql)), "同意前に枠を戻さない").toBe(false);

    const stale = makeResumeDb({ hasAuto: true, alreadyConsented: false });
    await expect(
      resumeXAutomation(
        "u1",
        { x_account_id: XID, confirmed: true, consent_version: "v0-old" },
        deps(stale.db),
      ),
    ).rejects.toMatchObject({ code: "automation_consent_required" });

    const unchecked = makeResumeDb({ hasAuto: true, alreadyConsented: false });
    await expect(
      resumeXAutomation(
        "u1",
        { x_account_id: XID, confirmed: false, consent_version: CURRENT_AUTOMATION_CONSENT_VERSION },
        deps(unchecked.db),
      ),
    ).rejects.toMatchObject({ code: "automation_consent_required" });
  });

  it("records consent and resumes when the checkbox and current version are sent", async () => {
    const { db, writes } = makeResumeDb({ hasAuto: true, alreadyConsented: false });
    const res = await resumeXAutomation(
      "u1",
      { x_account_id: XID, confirmed: true, consent_version: CURRENT_AUTOMATION_CONSENT_VERSION },
      deps(db),
    );
    expect(res).toEqual({ resumedSlots: 1, includesAuto: true, consentRecorded: true });
    const record = writes.find((w) => RECORD.test(w.sql));
    expect(record?.sql).toContain("automation_disabled_at = null");
  });

  it("skips re-consent when the account is still consented on the current version", async () => {
    const { db, writes } = makeResumeDb({ hasAuto: true, alreadyConsented: true });
    const res = await resumeXAutomation("u1", { x_account_id: XID }, deps(db));
    expect(res).toEqual({ resumedSlots: 1, includesAuto: true, consentRecorded: false });
    expect(writes.some((w) => RECORD.test(w.sql))).toBe(false);
  });
});

describe("disableXAutomation", () => {
  const deps = (db: Queryable) => ({ runInTx: <T,>(fn: (tx: Queryable) => Promise<T>) => fn(db) });

  it("throws not_found for an unowned account", async () => {
    const { db } = makeDb((sql) => ({ rowCount: OWNED.test(sql) ? 0 : 1 }));
    await expect(disableXAutomation("u1", XID, deps(db))).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("disables automation for an owned account", async () => {
    const { db, writes } = makeDb((sql) => {
      if (OWNED.test(sql)) return { rowCount: 1 };
      if (SLOTS.test(sql)) return { rowCount: 1 };
      if (JOBS.test(sql)) return { rowCount: 0 };
      return { rowCount: 1 };
    });
    const res = await disableXAutomation("u1", XID, deps(db));
    expect(res).toEqual({ disabledSlots: 1, canceledJobs: 0 });
    expect(writes.some((w) => JOBS.test(w.sql))).toBe(true);
  });
});
