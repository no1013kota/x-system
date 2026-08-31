import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NEWS_FETCH_UTC_HOURS } from "./diagnostics";

/**
 * `vercel.json` の cron と要件04 §6 の表が一致していることを検査する（T-M8-88）。
 *
 * 定時トリガーは**壊れても画面に何も出ない**。止まると予約投稿・通知メール・ニュース取得・
 * 実績収集・日次サマリが黙って動かなくなる（2026-08-14、本番で4本とも未設定だったことを
 * `npm run doctor` で初めて検出した）。schedule は文字列1つの違いで意味が変わるので、
 * 正本（要件04 §6）とコード（`vercel.json`）の突き合わせを人の目に任せない。
 *
 * **UTCとJSTの取り違えが一番効く**。`news_fetch` は JST 12時・19時＝UTC 3時・10時で、
 * ここを JST のまま書くと夜中に走って費用だけ出る。時刻の意味も併せて固定する。
 */

const ROOT = new URL("../../../", import.meta.url);

function readRoot(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, ROOT)), "utf8");
}

interface Cron {
  path: string;
  schedule: string;
}

const vercelConfig = JSON.parse(readRoot("vercel.json"));
const crons: Cron[] = vercelConfig.crons;
const requirements = readRoot("docs/requirements/04_jobs_and_automation.md");

/** `/api/cron/news-fetch` → `news_fetch`（正本の表はjob名で書かれている）。 */
function jobName(path: string): string {
  return path.replace("/api/cron/", "").replace(/-/g, "_");
}

describe("vercel.json の定時実行", () => {
  it("4本ある（要件04 §6「定時トリガー4本」。news-batch-collect はT-M8-380で廃止）", () => {
    // 減っていても増えていても落とす。1本消えると、その処理だけが黙って止まる。
    expect(crons.map((c) => c.path).sort()).toEqual([
      "/api/cron/follower-snapshot",
      "/api/cron/metrics-collector",
      "/api/cron/news-fetch",
      "/api/cron/scheduler-tick",
    ]);
  });

  it("各scheduleが要件04 §6 の表に書かれた値と一致する", () => {
    for (const cron of crons) {
      const job = jobName(cron.path);
      const row = requirements
        .split("\n")
        .find((line) => line.includes(`\`${job}\``) && line.includes("|"));
      // 表の行が見つからなければ検査が空振りしている（§11「検出器が何にも当たらない」）。
      expect(row, `要件04 §6 の表に \`${job}\` の行が無い`).toBeTruthy();
      expect(row, `${job} の schedule が正本と違う（vercel.json: ${cron.schedule}）`).toContain(
        `\`${cron.schedule}\``,
      );
    }
  });

  it("ニュース取得（RSS巡回）は10分おき（T-M8-383・運営者の指示。発見は無料なので頻度がコストに響かない）", () => {
    const news = crons.find((c) => c.path === "/api/cron/news-fetch");
    expect(news?.schedule).toBe("*/10 * * * *");
  });

  it("予約投稿の起動は5分間隔（要件04 §6・遅れの回収がこの間隔に依存する）", () => {
    // `*/5` を緩めると、投稿期限（定刻+10分）内の回収機会が2回から減る。
    expect(crons.find((c) => c.path === "/api/cron/scheduler-tick")?.schedule).toBe("*/5 * * * *");
  });

  it("カナリアはcronへ登録しない（D-11・2026-07-28決定。叩くたびにAI費用が出る）", () => {
    expect(crons.map((c) => c.path)).not.toContain("/api/cron/canary");
  });

  it("登録したpathのrouteが実在する", () => {
    for (const cron of crons) {
      // 存在しないpathを登録すると、Vercelは404を叩き続けて「動いているのに何も起きない」。
      expect(() => readRoot(`src/app${cron.path}/route.ts`), `${cron.path} の route が無い`).not.toThrow();
    }
  });
});

/**
 * doctor の停止判定はこのスケジュールを前提にしている（T-M8-310）。
 * **`vercel.json` だけ直して判定を直さないと、毎晩かならず赤くなるか、逆に止まっても気付けない。**
 * cron式から実際の時刻を導き、`diagnostics.ts` の定数と突き合わせる。
 */
describe("news_fetch のスケジュールと doctor の判定が揃っている（T-M8-310）", () => {
  /** `0 0-12/3 * * *` のような「分 時 …」から、走る時（UTC）を展開する。 */
  function utcHoursOf(schedule: string): number[] {
    const hourField = schedule.split(/\s+/)[1];
    const out = new Set<number>();
    for (const part of hourField.split(",")) {
      const [range, stepRaw] = part.split("/");
      const step = stepRaw ? Number(stepRaw) : 1;
      if (range === "*") {
        for (let h = 0; h < 24; h += step) out.add(h);
        continue;
      }
      const [from, to] = range.split("-").map(Number);
      for (let h = from; h <= (to ?? from); h += step) out.add(h);
    }
    return [...out].sort((a, b) => a - b);
  }

  it("cron式の展開が正しい（この展開器自体の確認）", () => {
    expect(utcHoursOf("0 0-12/3 * * *")).toEqual([0, 3, 6, 9, 12]);
    expect(utcHoursOf("0 * * * *")).toHaveLength(24);
    expect(utcHoursOf("*/5 * * * *")).toHaveLength(24);
  });

  it("vercel.json の news_fetch と NEWS_FETCH_UTC_HOURS が一致する", () => {
    const news = crons.find((c) => jobName(c.path) === "news_fetch");
    expect(news, "news_fetch の cron が見つからない").toBeDefined();
    expect(
      utcHoursOf(news!.schedule),
      "vercel.json を変えたら diagnostics.ts の NEWS_FETCH_UTC_HOURS も直すこと（doctorの停止判定が狂う）",
    ).toEqual([...NEWS_FETCH_UTC_HOURS]);
  });
});

/**
 * **アプリを動かす場所は東京に固定する**（T-M8-320）。
 *
 * 指定が無いとVercelの既定＝`iad1`（ワシントンD.C.）になり、**利用者もDBも東京なのに
 * アプリだけアメリカ東海岸**で動く。1回の画面遷移で太平洋を最大4回横断し、
 * ページの大きさに関係なく固定で0.2〜0.35秒かかっていた（2026-08-26 実測。
 * `x-vercel-id: hnd1::iad1::…` の2つ目が実行リージョン）。
 *
 * **Supabaseのリージョンと揃える**のが要点。片方だけ動かすと往復が増える。
 */
describe("実行リージョン（T-M8-320）", () => {
  it("東京（hnd1）に固定されている", () => {
    expect(
      vercelConfig.regions,
      "regions を消すと既定の iad1（ワシントンD.C.）になり、全画面が0.2〜0.35秒遅くなる",
    ).toEqual(["hnd1"]);
  });

  it("Supabaseのリージョン（ap-northeast-1＝東京）と同じ場所にある", () => {
    // 対応表: Vercel hnd1 ↔ AWS ap-northeast-1。どちらかを動かすなら両方を見直す。
    expect(vercelConfig.regions[0]).toBe("hnd1");
  });
});
