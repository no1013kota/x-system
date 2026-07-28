import { describe, expect, it } from "vitest";

import { InvalidProviderOutputError } from "../ai/pipeline";
import { emptyUsage, type TextGen, type TextGenRequest } from "../ai/types";
import type { Queryable } from "../x/token-refresh";
import {
  jstHourOf,
  newsLookbackHours,
  researchNews,
  type NewsResearchDeps,
  pickValidItems,
  formatDropReasons,
  normalizePublishedAt,
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
    provider: "anthropic",
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

  it("規定を外れたitemは落とし、他のitemと分野そのものは残す（修復callも呼ばない）", async () => {
    // 2026-07-28 まではここで応答全体を捨てて例外にしていた。英語ソース中心の分野（web3）は
    // title/summary が上限を超えやすく、修復callも空配列を返すため**常に0件**になっていた。
    const mixed = JSON.stringify({
      items: [
        { title: "あ".repeat(31), summary: "s", source_url: "https://e.com/x", impact: "high" },
        { title: "短いタイトル", summary: "要約", source_url: "https://e.com/y", impact: "mid" },
      ],
    });
    const { gen, requests } = mockTextGen([mixed]);
    const { db } = mockDb([]);
    const res = await researchNews("ai", makeDeps({ db, textGen: gen }));
    expect(res.items).toHaveLength(1);
    expect(res.items[0].source_url).toBe("https://e.com/y");
    expect(requests).toHaveLength(1); // 器は妥当なので修復callは不要
  });

  it("JSONとして壊れている場合は従来どおり修復call→例外", async () => {
    const broken = "これはJSONではありません";
    const { gen, requests } = mockTextGen([broken, broken]);
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

describe("pickValidItems（item単位の選別）", () => {
  const valid = {
    title: "GPT-5.6が一般提供開始",
    summary: "OpenAIがGPT-5.6を一般提供開始した。",
    source_url: "https://example.com/a",
    impact: "high" as const,
  };

  it("規定を満たすitemだけを残し、落とした件数を返す", () => {
    // 2026-07-28 web3 実測: 英語ソースで title 38〜56字・summary 210〜293字。
    const tooLong = {
      ...valid,
      title: "Storj Labs files Chapter 11 bankruptcy protection",
      summary: "x".repeat(220),
      source_url: "https://example.com/b",
    };
    const r = pickValidItems([valid, tooLong, { ...valid, source_url: "https://example.com/c" }]);
    expect(r.items).toHaveLength(2);
    expect(r.dropped).toBe(1);
  });

  it("1件でも規定外なら全部捨てる、という挙動にはしない", () => {
    const r = pickValidItems([{ nonsense: true }, valid]);
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });

  it("最大件数で打ち切る", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...valid,
      source_url: `https://example.com/${i}`,
    }));
    expect(pickValidItems(many).items.length).toBeLessThanOrEqual(5);
  });

  it("空配列はそのまま0件（落とした件数も理由も0）", () => {
    expect(pickValidItems([])).toEqual({ items: [], dropped: 0, reasons: {} });
  });

  it("除外理由を内訳で返す（0件の原因を説明できるように）", () => {
    const tooLongSummary = {
      title: "短いタイトル",
      summary: "x".repeat(220),
      source_url: "https://example.com/a",
      impact: "high" as const,
    };
    const r = pickValidItems([tooLongSummary, { ...tooLongSummary, source_url: "https://example.com/b" }]);
    expect(r.dropped).toBe(2);
    expect(r.reasons["summary:too_big"]).toBe(2);
    expect(formatDropReasons(r.reasons)).toBe("summary:too_big×2");
  });
});

describe("summary の上限（D-12 案B: 200字）", () => {
  const base = {
    title: "短いタイトル",
    source_url: "https://example.com/a",
    impact: "high" as const,
  };

  it("200字ちょうどは通る", () => {
    const r = pickValidItems([{ ...base, summary: "あ".repeat(200) }]);
    expect(r.items).toHaveLength(1);
  });

  it("201字は落とす（上限そのものは残す）", () => {
    const r = pickValidItems([{ ...base, summary: "あ".repeat(201) }]);
    expect(r.dropped).toBe(1);
    expect(r.reasons["summary:too_big"]).toBe(1);
  });

  it("旧上限（120字）超でも200字以内なら通る＝全滅の原因が解消している", () => {
    const r = pickValidItems([{ ...base, summary: "あ".repeat(160) }]);
    expect(r.items).toHaveLength(1);
  });
});

describe("normalizePublishedAt（任意項目でitemを失わない）", () => {
  it("日付のみは00:00 UTCとして受ける", () => {
    expect(normalizePublishedAt("2026-07-28")).toBe("2026-07-28T00:00:00Z");
  });

  it("タイムゾーン無しはUTCとみなす", () => {
    expect(normalizePublishedAt("2026-07-28T09:43:00")).toBe("2026-07-28T09:43:00Z");
    expect(normalizePublishedAt("2026-07-28 09:43:00")).toBe("2026-07-28T09:43:00Z");
  });

  it("既にISO（Z・オフセット付き）ならそのまま通る", () => {
    for (const v of ["2026-07-28T09:43:00Z", "2026-07-28T09:43:00+09:00"]) {
      expect(normalizePublishedAt(v)).toBeTruthy();
    }
  });

  it("解釈できない値・欠落は undefined（itemは残す）", () => {
    for (const v of ["", "  ", "先週", undefined, null, 123]) {
      expect(normalizePublishedAt(v)).toBeUndefined();
    }
  });

  it("published_at が壊れていても item は採用される（0件化させない）", () => {
    const r = pickValidItems([
      {
        title: "短いタイトル",
        summary: "要約",
        source_url: "https://example.com/a",
        impact: "high",
        published_at: "先週ごろ",
      },
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].published_at).toBeUndefined();
  });

  it("日付のみで届いても item は採用される（D-12検証時に5件すべて失っていた形）", () => {
    const r = pickValidItems([
      {
        title: "短いタイトル",
        summary: "要約",
        source_url: "https://example.com/a",
        impact: "high",
        published_at: "2026-07-28",
      },
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].published_at).toBe("2026-07-28T00:00:00Z");
  });
});
