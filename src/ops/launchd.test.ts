import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { NEWS_FETCH_JST_HOURS } from "../lib/jobs/news-research";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * launchd 定時トリガー資産の検証（T-M4-18, 要件04 §6, 運用メモ §1/§2）。
 * plist の妥当性・スケジュール本数、cron-call.sh の 2xx/401/redirect/5xx再試行/timeout/log を確認する。
 * plutil / bash / curl が無い環境ではskip。
 */

const execFileAsync = promisify(execFile);
const OPS_DIR = join(process.cwd(), "ops", "launchd");
const SCRIPT = join(OPS_DIR, "cron-call.sh");

const PLISTS = [
  { file: "com.spaceai.news-fetch.plist", label: "com.spaceai.news-fetch" },
  { file: "com.spaceai.scheduler-tick.plist", label: "com.spaceai.scheduler-tick" },
  { file: "com.spaceai.metrics-collector.plist", label: "com.spaceai.metrics-collector" },
  { file: "com.spaceai.follower-snapshot.plist", label: "com.spaceai.follower-snapshot" },
];

async function have(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

async function plistJson(file: string): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync("plutil", ["-convert", "json", "-o", "-", join(OPS_DIR, file)]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe("launchd plists", () => {
  let plutilOk = false;
  beforeAll(async () => {
    plutilOk = await have("plutil");
  });

  it("all four plists pass plutil -lint", async (ctx) => {
    if (!plutilOk) return ctx.skip();
    for (const { file } of PLISTS) {
      const { stdout } = await execFileAsync("plutil", ["-lint", join(OPS_DIR, file)]);
      expect(stdout).toMatch(/OK$/m);
    }
  });

  it("encode the correct StartCalendarInterval schedules and labels", async (ctx) => {
    if (!plutilOk) return ctx.skip();
    const news = await plistJson("com.spaceai.news-fetch.plist");
    expect(news.Label).toBe("com.spaceai.news-fetch");
    const newsSched = news.StartCalendarInterval as { Hour: number; Minute: number }[];
    // 起動時刻は費用に直結する。**コード側の定義（NEWS_FETCH_JST_HOURS）と一致すること**を検査し、
    // 片方だけ変えて取りこぼす／余計に課金される状態を防ぐ（T-M7-55）。
    expect(newsSched.map((e) => e.Hour)).toEqual([...NEWS_FETCH_JST_HOURS]);
    expect(newsSched.every((e) => e.Minute === 0)).toBe(true);

    const tick = await plistJson("com.spaceai.scheduler-tick.plist");
    const tickSched = tick.StartCalendarInterval as { Minute: number }[];
    expect(tickSched).toHaveLength(12);
    expect(tickSched.map((e) => e.Minute)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);

    const metrics = await plistJson("com.spaceai.metrics-collector.plist");
    expect((metrics.StartCalendarInterval as { Minute: number }).Minute).toBe(0);

    const follower = await plistJson("com.spaceai.follower-snapshot.plist");
    expect((follower.StartCalendarInterval as { Minute: number }).Minute).toBe(10);
  });

  it("never embed the secret in a plist", async (ctx) => {
    if (!plutilOk) return ctx.skip();
    for (const { file } of PLISTS) {
      const raw = readFileSync(join(OPS_DIR, file), "utf8");
      expect(raw).not.toMatch(/CRON_SECRET<\/key>/);
      expect(raw.toLowerCase()).not.toContain("bearer ");
    }
  });
});

interface Handler {
  (req: IncomingMessage, res: ServerResponse): void;
}

describe("cron-call.sh", () => {
  let server: Server;
  let baseUrl = "";
  let handler: Handler = (_req, res) => res.end();
  let requests: { url: string; auth: string | undefined }[] = [];
  let toolsOk = false;
  let tmp = "";

  beforeAll(async () => {
    toolsOk = (await have("bash")) && (await have("curl"));
    tmp = mkdtempSync(join(tmpdir(), "exosai-cron-"));
    writeFileSync(join(tmp, "secret"), "test-secret\n");
    server = createServer((req, res) => {
      requests.push({ url: req.url ?? "", auth: req.headers.authorization });
      handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tmp, { recursive: true, force: true });
  });

  async function run(
    endpoint: string,
    h: Handler,
    extraEnv: Record<string, string> = {},
  ): Promise<{ code: number; requests: typeof requests; logPath: string }> {
    handler = h;
    requests = [];
    const logPath = join(tmp, `log-${Math.round(performance.now())}-${endpoint}.log`);
    const code = await new Promise<number>((resolve) => {
      execFile(
        "bash",
        [SCRIPT, endpoint],
        {
          env: {
            ...process.env,
            HOME: tmp,
            APP_BASE_URL: baseUrl,
            CRON_SECRET_FILE: join(tmp, "secret"),
            CRON_RETRY_DELAYS: "0 0",
            CRON_CONNECT_TIMEOUT: "2",
            CRON_MAX_TIME: "2",
            CRON_LOG: logPath,
            ...extraEnv,
          },
        },
        (err) => {
          const c = (err as { code?: unknown } | null)?.code;
          resolve(typeof c === "number" ? c : err ? 1 : 0);
        },
      );
    });
    return { code, requests, logPath };
  }

  const readLog = (p: string): string => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };

  it("returns 0 on 2xx and sends the Bearer secret to the right path", async (ctx) => {
    if (!toolsOk) return ctx.skip();
    const res = await run("scheduler-tick", (_req, r) => {
      r.writeHead(200);
      r.end("ok");
    });
    expect(res.code).toBe(0);
    expect(res.requests).toHaveLength(1);
    expect(res.requests[0].url).toBe("/api/cron/scheduler-tick");
    expect(res.requests[0].auth).toBe("Bearer test-secret");
  });

  it("fails without retry on 401 (secret mismatch)", async (ctx) => {
    if (!toolsOk) return ctx.skip();
    const res = await run("news-fetch", (_req, r) => {
      r.writeHead(401);
      r.end("unauthorized");
    });
    expect(res.code).not.toBe(0);
    expect(res.requests).toHaveLength(1); // no retry
  });

  it("treats a redirect as non-success without retry", async (ctx) => {
    if (!toolsOk) return ctx.skip();
    const res = await run("news-fetch", (_req, r) => {
      r.writeHead(302, { Location: "https://example.com/" });
      r.end();
    });
    expect(res.code).not.toBe(0);
    expect(res.requests).toHaveLength(1); // 3xx is not retryable
  });

  it("retries a 5xx up to 3 attempts then logs the failure", async (ctx) => {
    if (!toolsOk) return ctx.skip();
    const res = await run("scheduler-tick", (_req, r) => {
      r.writeHead(500);
      r.end("boom");
    });
    expect(res.code).not.toBe(0);
    expect(res.requests).toHaveLength(3); // initial + 2 retries
    expect(readLog(res.logPath)).toMatch(/scheduler-tick FAILED/);
  });

  it("retries on timeout (no response) and logs after exhausting attempts", async (ctx) => {
    if (!toolsOk) return ctx.skip();
    const res = await run("news-fetch", () => {
      /* never respond → curl --max-time trips */
    });
    expect(res.code).not.toBe(0);
    expect(res.requests.length).toBe(3);
    expect(readLog(res.logPath)).toMatch(/news-fetch FAILED/);
  }, 20_000);
});
