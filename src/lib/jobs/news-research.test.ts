import { describe, expect, it } from "vitest";

import { InvalidProviderOutputError } from "../ai/pipeline";
import { emptyUsage, type TextGen, type TextGenRequest } from "../ai/types";
import type { Queryable } from "../x/token-refresh";
import {
  jstHourOf,
  newsLookbackHours,
  researchNews,
  type NewsResearchDeps,
} from "./news-research";

const KNOWN_URLS = /from news_items/;
const LEDGER = /insert into external_api_usage_events/;

function mockTextGen(responses: string[]): { gen: TextGen; requests: TextGenRequest[] } {
  const requests: TextGenRequest[] = [];
  let i = 0;
  const gen: TextGen = {
    generate: async (req) => {
      requests.push(req);
      const text = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return {
        provider: "anthropic",
        requestId: `req-${i}`,
        text,
        citations: [],
        usage: emptyUsage(),
        stopReason: "end_turn",
      };
    },
  };
  return { gen, requests };
}

function mockDb(knownUrls: string[]) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      if (KNOWN_URLS.test(sql)) {
        return { rows: knownUrls.map((u) => ({ source_url: u })) as T[], rowCount: knownUrls.length };
      }
      return { rows: [] as T[], rowCount: 1 };
    },
  };
  return { db, writes };
}

const validResponse = JSON.stringify({
  items: [
    {
      title: "重要ニュース",
      summary: "事実のみの要約。",
      source_url: "https://example.com/a",
      impact: "high",
      published_at: "2026-07-24T10:00:00+09:00",
    },
  ],
});

function makeDeps(over: Partial<NewsResearchDeps> & Pick<NewsResearchDeps, "db" | "textGen">): NewsResearchDeps {
  return {
    model: "claude-x",
    clock: new Date("2026-07-24T03:00:00Z"), // JST 12:00 → hours 3
    ledgerKeyPrefix: "news:w1:ai",
    now: () => 0,
    makeDeadline: () => ({ remainingMs: () => 90_000, canStartCall: () => true, callTimeoutMs: () => 90_000 }),
    ...over,
  };
}

describe("newsLookbackHours / jstHourOf", () => {
  it("maps JST launch hours to lookback windows (§6.10)", () => {
    expect(newsLookbackHours(9)).toBe(15);
    expect(newsLookbackHours(10)).toBe(16);
    expect(newsLookbackHours(11)).toBe(17);
    expect(newsLookbackHours(12)).toBe(3);
    expect(newsLookbackHours(20)).toBe(3);
  });
  it("derives the JST hour from a UTC instant", () => {
    expect(jstHourOf(new Date("2026-07-24T00:00:00Z"))).toBe(9);
    expect(jstHourOf(new Date("2026-07-24T03:00:00Z"))).toBe(12);
  });
});

describe("researchNews", () => {
  it("fills category_ja / hours / n and passes known_urls in the user message", async () => {
    const { gen, requests } = mockTextGen([validResponse]);
    const { db } = mockDb(["https://known.example/1", "https://known.example/2"]);
    const res = await researchNews("ai", makeDeps({ db, textGen: gen }));

    const req = requests[0];
    expect(req.system[0]).toContain("「AI」分野");
    expect(req.system[0]).toContain("直近3時間"); // JST 12:00 → hours 3
    expect(req.system[0]).toContain("最大5件");
    expect(req.webSearch?.maxUses).toBe(5);
    expect(req.user).toContain("https://known.example/1");
    expect(req.user).toContain("<known_urls>");
    expect(res.hours).toBe(3);
    expect(res.items).toHaveLength(1);
  });

  it("uses a 15h lookback for a 09:00 JST launch", async () => {
    const { gen, requests } = mockTextGen([validResponse]);
    const { db } = mockDb([]);
    const res = await researchNews("web3", makeDeps({ db, textGen: gen, clock: new Date("2026-07-24T00:00:00Z") }));
    expect(requests[0].system[0]).toContain("直近15時間");
    expect(requests[0].system[0]).toContain("「Web3」分野");
    expect(res.hours).toBe(15);
  });

  it("accepts a code-fenced response and an empty items array", async () => {
    const fenced = "```json\n" + JSON.stringify({ items: [] }) + "\n```";
    const { gen } = mockTextGen([fenced]);
    const { db } = mockDb([]);
    const res = await researchNews("ai", makeDeps({ db, textGen: gen }));
    expect(res.items).toEqual([]);
  });

  it("attempts a repair call then throws on persistently invalid output (title > 30 chars)", async () => {
    const tooLong = JSON.stringify({
      items: [{ title: "あ".repeat(31), summary: "s", source_url: "https://e.com/x", impact: "high" }],
    });
    const { gen, requests } = mockTextGen([tooLong, tooLong]);
    const { db } = mockDb([]);
    await expect(researchNews("ai", makeDeps({ db, textGen: gen }))).rejects.toBeInstanceOf(
      InvalidProviderOutputError,
    );
    expect(requests).toHaveLength(2); // 初回 + 修復call
  });

  it("records each provider call to the cost ledger with user_id=null and an idempotent key", async () => {
    const { gen } = mockTextGen([validResponse]);
    const { db, writes } = mockDb([]);
    await researchNews("ai", makeDeps({ db, textGen: gen, ledgerKeyPrefix: "news:w1:ai" }));
    const ledger = writes.filter((w) => LEDGER.test(w.sql));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].params[0]).toBeNull(); // user_id
    expect(ledger[0].params[13]).toBe("news:w1:ai:0"); // idempotency_key
  });
});
