import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../x/token-refresh";
import {
  canSendViaSmtp,
  EmailSendError,
  notificationEmailHeaders,
  sendQueuedNotificationEmail,
  withSenderName,
  type EmailTransport,
  type NotificationEmailDeps,
} from "./notification-email";

const LOAD = /select n\.id, n\.title/;
const SENT = /set email_status = 'sent'/;
const REQUEUE = /email_available_at = now\(\)/;
const FAIL = /set email_status = 'failed'/;

type Row = Record<string, unknown>;

function mockDb(
  queuedRow: Row | null,
  updateRowCount = 1,
) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      if (LOAD.test(sql)) {
        return { rows: (queuedRow ? [queuedRow] : []) as T[], rowCount: queuedRow ? 1 : 0 };
      }
      return { rows: [] as T[], rowCount: updateRowCount };
    },
  };
  return { db, writes };
}

const row = (over: Row = {}): Row => ({
  id: "n1",
  title: "件名",
  body: "本文",
  link: "/app/news",
  email_attempts: 0,
  recipient: "user@example.com",
  ...over,
});

function okTransport(providerId = "prov-1"): { transport: EmailTransport; sent: ReturnType<typeof vi.fn> } {
  const sent = vi.fn(async () => ({ providerId }));
  return { transport: { sendMail: sent }, sent };
}

function failTransport(err: unknown): EmailTransport {
  return {
    sendMail: async () => {
      throw err;
    },
  };
}

function deps(db: Queryable, transport: EmailTransport): NotificationEmailDeps {
  return {
    db,
    transport,
    from: "Exos AI <noreply@space.example>",
    replyTo: "support@space.example",
    appBaseUrl: "https://app.space.example",
    domain: "space.example",
    rng: () => 0,
  };
}

describe("sendQueuedNotificationEmail", () => {
  it("sends and marks sent with provider id (subject/text/messageId built)", async () => {
    const { db, writes } = mockDb(row());
    const { transport, sent } = okTransport("prov-9");
    const res = await sendQueuedNotificationEmail(deps(db, transport), "n1");
    expect(res.outcome).toBe("sent");
    const msg = sent.mock.calls[0][0];
    expect(msg.to).toBe("user@example.com");
    expect(msg.subject).toBe("件名");
    expect(msg.text).toContain("https://app.space.example/app/news"); // absolute link
    expect(msg.messageId).toBe("<notification:n1@space.example>");
    const upd = writes.find((w) => SENT.test(w.sql))!;
    expect(upd.params[1]).toBe("prov-9");
  });

  it("skips when the row is not queued/due (idempotent — no duplicate send)", async () => {
    const { db, writes } = mockDb(null);
    const { transport, sent } = okTransport();
    const res = await sendQueuedNotificationEmail(deps(db, transport), "n1");
    expect(res.outcome).toBe("skipped");
    expect(sent).not.toHaveBeenCalled();
    expect(writes.some((w) => SENT.test(w.sql))).toBe(false);
  });

  it("skips when the sent-guard updates 0 rows (concurrent send won)", async () => {
    const { db } = mockDb(row(), 0);
    const { transport } = okTransport();
    const res = await sendQueuedNotificationEmail(deps(db, transport), "n1");
    expect(res.outcome).toBe("skipped");
  });

  it("requeues with backoff on a retryable error while attempts < 3", async () => {
    const { db, writes } = mockDb(row({ email_attempts: 0 }));
    const res = await sendQueuedNotificationEmail(
      deps(db, failTransport(new EmailSendError("server", "smtp:err:451"))),
      "n1",
    );
    expect(res).toEqual({ outcome: "requeued", attempts: 1 });
    const upd = writes.find((w) => REQUEUE.test(w.sql))!;
    expect(upd.params[1]).toBe(1); // email_attempts
    expect(upd.params[2]).toBe("smtp:err:451"); // sanitized summary
  });

  it("fails after the 3rd attempt on a retryable error", async () => {
    const { db, writes } = mockDb(row({ email_attempts: 2 }));
    const res = await sendQueuedNotificationEmail(
      deps(db, failTransport(new EmailSendError("network", "smtp:ETIMEDOUT"))),
      "n1",
    );
    expect(res).toEqual({ outcome: "failed", attempts: 3 });
    expect(writes.some((w) => FAIL.test(w.sql))).toBe(true);
    expect(writes.some((w) => REQUEUE.test(w.sql))).toBe(false);
  });

  it("fails immediately on an auth error (401/403 equivalent, not retryable)", async () => {
    const { db, writes } = mockDb(row({ email_attempts: 0 }));
    const res = await sendQueuedNotificationEmail(
      deps(db, failTransport(new EmailSendError("auth", "smtp:EAUTH:535"))),
      "n1",
    );
    expect(res).toEqual({ outcome: "failed", attempts: 1 });
    const upd = writes.find((w) => FAIL.test(w.sql))!;
    expect(upd.params[2]).toBe("smtp:EAUTH:535");
  });

  it("stores a generic summary for an unclassified error (no secrets)", async () => {
    const { db, writes } = mockDb(row());
    const res = await sendQueuedNotificationEmail(
      deps(db, failTransport(new Error("connect to user@secret.example failed"))),
      "n1",
    );
    expect(res.outcome).toBe("failed"); // unknown → terminal
    const upd = writes.find((w) => FAIL.test(w.sql))!;
    expect(upd.params[2]).toBe("send_failed");
  });
});

describe("canSendViaSmtp（環境による実送信の抑止）", () => {
  it("productionは外部SMTPへ送れる", () => {
    expect(canSendViaSmtp({ appEnv: "production", host: "smtp.gmail.com" })).toBe(true);
  });

  it("development/previewから外部SMTPへは送らない", () => {
    // .env.local に実Gmailの認証情報が入っていると tick が溜まった通知を実送信してしまう
    // （2026-07-27 に98通送信）。環境で機械的に止める。
    for (const appEnv of ["development", "preview"]) {
      expect(canSendViaSmtp({ appEnv, host: "smtp.gmail.com" })).toBe(false);
      expect(canSendViaSmtp({ appEnv, host: "smtp.sendgrid.net" })).toBe(false);
    }
  });

  it("ローカル宛（Mailpit等）は非productionでも許す", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", "  LOCALHOST  "]) {
      expect(canSendViaSmtp({ appEnv: "development", host })).toBe(true);
    }
  });
});

/**
 * T-M8-136（運営者の質問・2026-08-18）
 * 「メールは『Exos AI』から届きますか／迷惑メールに入りにくい形ですか」
 */
describe("差出人と迷惑メール対策（T-M8-136）", () => {
  it("素のアドレスには「Exos AI」の表示名を付ける", () => {
    expect(withSenderName("noreply@exosai.net", "Exos AI")).toBe("Exos AI <noreply@exosai.net>");
    // **envの書式に委ねない**のが要点（個人アドレスがそのまま受信箱に並ぶのを防ぐ）。
    expect(withSenderName("  matsubuz.10@gmail.com  ", "Exos AI")).toBe(
      "Exos AI <matsubuz.10@gmail.com>",
    );
  });

  it("すでに表示名が付いていれば尊重する（二重に付けない）", () => {
    expect(withSenderName("Exos AI <a@b.com>", "Exos AI")).toBe("Exos AI <a@b.com>");
    expect(withSenderName("別名 <a@b.com>", "Exos AI")).toBe("別名 <a@b.com>");
  });

  it("自動送信と1クリック購読解除のヘッダを付ける", () => {
    const h = notificationEmailHeaders("https://exosai.net");
    // RFC 3834: 自動応答を止める。
    expect(h["Auto-Submitted"]).toBe("auto-generated");
    // RFC 8058: Gmail/Yahooが要求。無いと迷惑メール判定が厳しくなる。
    expect(h["List-Unsubscribe"]).toBe("<https://exosai.net/app/settings?tab=notifications>");
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("末尾スラッシュを二重にしない", () => {
    expect(notificationEmailHeaders("https://exosai.net/")["List-Unsubscribe"]).toBe(
      "<https://exosai.net/app/settings?tab=notifications>",
    );
  });

  it("URLが分からないときは購読解除ヘッダを付けない（壊れたリンクを送らない）", () => {
    const h = notificationEmailHeaders(undefined);
    expect(h["Auto-Submitted"]).toBe("auto-generated");
    expect(h["List-Unsubscribe"]).toBeUndefined();
  });
});
