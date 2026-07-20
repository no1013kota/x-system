import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as followerSnapshot } from "./follower-snapshot/route";
import { GET as metricsCollector } from "./metrics-collector/route";
import { GET as newsFetch } from "./news-fetch/route";
import { GET as schedulerTick } from "./scheduler-tick/route";

/**
 * All 4 cron routes must reject requests without the CRON_SECRET bearer (401)
 * before doing any work. Auth is checked first, so no DB is touched here.
 */
describe("cron route auth", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  const routes = [
    ["news-fetch", newsFetch],
    ["scheduler-tick", schedulerTick],
    ["metrics-collector", metricsCollector],
    ["follower-snapshot", followerSnapshot],
  ] as const;

  for (const [name, handler] of routes) {
    it(`${name} returns 401 without a valid bearer`, async () => {
      const noAuth = await handler(new Request("http://localhost/api/cron/x"));
      expect(noAuth.status).toBe(401);
      const wrong = await handler(
        new Request("http://localhost/api/cron/x", {
          headers: { authorization: "Bearer wrong" },
        }),
      );
      expect(wrong.status).toBe(401);
    });
  }
});
