import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `vercel.json` の cron と要件04 §6 の表が一致していることを検査する（T-M8-88）。
 *
 * 定時トリガーは**壊れても画面に何も出ない**。止まると予約投稿・通知メール・ニュース取得・
 * 実績収集・日次サマリが黙って動かなくなる（2026-08-14、本番で4本とも未設定だったことを
 * `npm run doctor` で初めて検出した）。schedule は文字列1つの違いで意味が変わるので、
 * 正本（要件04 §6）とコード（`vercel.json`）の突き合わせを人の目に任せない。
 *
 * **UTCとJSTの取り違えが一番効く**。`news_fetch` は JST 9〜21時の3時間おき＝UTC 0〜12時で、
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

const crons: Cron[] = JSON.parse(readRoot("vercel.json")).crons;
const requirements = readRoot("docs/requirements/04_jobs_and_automation.md");

/** `/api/cron/news-fetch` → `news_fetch`（正本の表はjob名で書かれている）。 */
function jobName(path: string): string {
  return path.replace("/api/cron/", "").replace(/-/g, "_");
}

describe("vercel.json の定時実行", () => {
  it("3本ある（要件04 §6「定時トリガー3本」。follower-snapshot は T-M8-255 で廃止）", () => {
    // 減っていても増えていても落とす。1本消えると、その処理だけが黙って止まる。
    expect(crons.map((c) => c.path).sort()).toEqual([
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

  it("ニュース取得は JST 9〜21時の3時間おき（UTCで書かれている・T-M8-195）", () => {
    const news = crons.find((c) => c.path === "/api/cron/news-fetch");
    expect(news?.schedule).toBe("0 0-12/3 * * *");
    // schedule の意味を数字で固定する。JSTのまま書く取り違えをここで落とす。
    const utcHours = [0, 3, 6, 9, 12];
    expect(utcHours.map((h) => (h + 9) % 24)).toEqual([9, 12, 15, 18, 21]);
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
