import { describe, expect, it } from "vitest";

import { InvalidProviderOutputError } from "../ai/pipeline";
import { emptyUsage, type TextGen, type TextGenRequest } from "../ai/types";
import type { Queryable } from "../x/token-refresh";
import {
  jstHourOf,
  NEWS_FETCH_JST_HOURS,
  newsLookbackHours,
  researchNews,
  type NewsResearchDeps,
  pickValidItems,
  formatDropReasons,
  applyRecencyPolicy,
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
  it("maps JST launch hours to lookback windows (§6.10・T-M7-55)", () => {
    // 初回は前日の最終回（20:00）からの空白14時間を埋める。
    expect(newsLookbackHours(10)).toBe(14);
    // 以降は間隔2時間＋重なり1時間。
    for (const h of [12, 14, 16, 18, 20]) expect(newsLookbackHours(h)).toBe(3);
  });

  it("**窓は起動間隔より広い**（隣の回と重なり、1回失敗しても欠落しない）", () => {
    const hours = [...NEWS_FETCH_JST_HOURS];
    for (let i = 1; i < hours.length; i++) {
      const gap = hours[i] - hours[i - 1];
      expect(newsLookbackHours(hours[i]), `${hours[i]}時の窓が間隔${gap}hより広い`).toBeGreaterThan(gap);
    }
    // 初回は前日最終回からの空白を覆う。
    const overnightGap = 24 - hours[hours.length - 1] + hours[0];
    expect(newsLookbackHours(hours[0])).toBeGreaterThanOrEqual(overnightGap);
  });

  it("想定外の時刻に起動されても欠落させない側へ倒す", () => {
    for (const h of [0, 3, 9, 11, 23]) expect(newsLookbackHours(h)).toBe(14);
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

  it("初回（10:00 JST）は夜間を埋める14時間の窓で問い合わせる", async () => {
    const { gen, requests } = mockTextGen([validResponse]);
    const { db } = mockDb([]);
    // 01:00Z = 10:00 JST（定時取得の初回）。
    const res = await researchNews("web3", makeDeps({ db, textGen: gen, clock: new Date("2026-07-24T01:00:00Z") }));
    expect(requests[0].system[0]).toContain("直近14時間");
    expect(requests[0].system[0]).toContain("「Web3」分野");
    expect(res.hours).toBe(14);
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
        // 受理上限（60字）を超える見出し。T-M8-47 で30→60へ緩めたので31字では落ちない。
        { title: "あ".repeat(61), summary: "s", source_url: "https://e.com/x", impact: "high" },
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
    // 見出し48字は受理上限（60字）内なので、ここで落ちるのは summary 超過が理由（T-M8-47）。
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

  // T-M8-47: 2026-08-04 の実物スモークで ai テーマの4件中2件が `title:too_big` で落ち、
  // 分野が0件になった。英語ソースの見出しは実測38〜56字で、30字上限では届かない。
  it("英語ソースの見出し（38〜56字）を受理する", () => {
    for (const title of [
      "Storj Labs files Chapter 11 bankruptcy protection", // 48字
      "EU AI Act transparency obligations take effect on August 2", // 57字
    ]) {
      const r = pickValidItems([{ ...valid, title }]);
      expect(r.items, `${title.length}字の見出しを受理すること`).toHaveLength(1);
    }
  });

  it("受理上限（60字）を超える見出しは落とし、理由を返す", () => {
    const r = pickValidItems([{ ...valid, title: "x".repeat(61) }]);
    expect(r.items).toHaveLength(0);
    expect(r.reasons["title:too_big"]).toBe(1);
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


describe("applyRecencyPolicy（取得窓の新しさで選別・T-M7-40）", () => {
  const NOW = new Date("2026-07-31T14:30:00Z");
  const base = { title: "t", summary: "s", source_url: "https://example.com/a", impact: "high" as const };
  const at = (iso: string) => ({ ...base, source_url: `https://example.com/${iso}`, published_at: iso });

  it("窓内の記事はそのまま残す", () => {
    const r = applyRecencyPolicy([at("2026-07-31T13:00:00Z")], { now: NOW, hours: 3 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].published_at).toBe("2026-07-31T13:00:00Z");
    expect(r.dropped).toBe(0);
    expect(r.futureAdjusted).toBe(0);
  });

  it("未来の日時は published_at を落として item は残す（取得時刻扱いへ寄せる）", () => {
    // 2026-07-31、AIが1時間先の日時を返し、ホームの重要ニュース最上位に居座った。
    const r = applyRecencyPolicy([at("2026-07-31T15:30:00Z")], { now: NOW, hours: 3 });
    expect(r.items, "本体は捨てない").toHaveLength(1);
    expect(r.items[0].published_at, "並び順は fetched_at に委ねる").toBeUndefined();
    expect(r.futureAdjusted).toBe(1);
    expect(r.dropped).toBe(0);
  });

  it("時計ずれの範囲（5分以内）の未来は許す", () => {
    const r = applyRecencyPolicy([at("2026-07-31T14:33:00Z")], { now: NOW, hours: 3 });
    expect(r.items[0].published_at).toBe("2026-07-31T14:33:00Z");
    expect(r.futureAdjusted).toBe(0);
  });

  it("窓＋24時間より古い記事は捨て、理由を残す", () => {
    // 3時間窓の指示に対して4か月前の記事が保存された（2026-07-31 実測）。
    const r = applyRecencyPolicy(
      [at("2026-04-01T00:00:00Z"), at("2026-07-31T13:00:00Z")],
      { now: NOW, hours: 3 },
    );
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(1);
    expect(r.reasons["published_at:too_old"]).toBe(1);
  });

  it("窓＋24時間の内側なら残す（日付だけの記事・更新記事を落とさない）", () => {
    // hours=3 なので 27時間前まで許す。26時間前は残る。
    const r = applyRecencyPolicy([at("2026-07-30T12:30:00Z")], { now: NOW, hours: 3 });
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(0);
  });

  it("朝の長い窓（hours=17）では前日夕方の記事も残る", () => {
    const r = applyRecencyPolicy([at("2026-07-30T09:00:00Z")], { now: NOW, hours: 17 });
    expect(r.items).toHaveLength(1);
  });

  it("published_at が無い item は判定材料が無いだけなので残す", () => {
    const r = applyRecencyPolicy([base], { now: NOW, hours: 3 });
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(0);
    expect(r.futureAdjusted).toBe(0);
  });
});

describe("引用タグの除去（T-M8-06）", () => {
  it("**title と summary から <cite> を落とす**（そのまま画面に出ていた）", () => {
    const { items, dropped } = pickValidItems([
      {
        title: '<cite index="43-1">ソニーG、最高益予想</cite>',
        summary: '<cite index="43-1">ソニーグループが31日に決算を発表した。</cite>続報あり。',
        source_url: "https://example.com/a",
        impact: "high",
      },
    ]);
    expect(dropped).toBe(0);
    expect(items[0].title).toBe("ソニーG、最高益予想");
    expect(items[0].summary).toBe("ソニーグループが31日に決算を発表した。続報あり。");
  });

  it("タグを含めた長さで上限判定しない（タグ込みだと30字を超える）", () => {
    // 実体は26字だが、タグを含めると60字を超える。除去前に数えると不当に捨てられる。
    const title = '<cite index="12-3">' + "あ".repeat(26) + "</cite>";
    const { items, dropped } = pickValidItems([
      { title, summary: "要約", source_url: "https://example.com/b", impact: "mid" },
    ]);
    expect(dropped).toBe(0);
    expect(items[0].title).toBe("あ".repeat(26));
  });
});
