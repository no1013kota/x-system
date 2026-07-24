import { describe, expect, it } from "vitest";

import {
  isBlockedIp,
  validateSourceUrl,
  type SourceUrlDeps,
} from "./source-url";

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

/** Build deps from a host→IP map and a url→response map. */
function deps(
  hostIps: Record<string, string[]>,
  responses: Record<string, { status: number; location?: string }>,
): SourceUrlDeps {
  return {
    resolve: async (hostname: string) => {
      const ips = hostIps[hostname];
      if (!ips) throw new Error("ENOTFOUND");
      return ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
    fetch: async (url) => {
      const r = responses[url] ?? responses[url.replace(/\/$/, "")];
      if (!r) return { status: 200, headers: headers({}) };
      return {
        status: r.status,
        headers: headers(r.location ? { location: r.location } : {}),
      };
    },
  };
}

describe("isBlockedIp", () => {
  it("blocks loopback / private / link-local / reserved", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.5",
      "192.168.1.1",
      "169.254.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "203.0.113.9", "2606:4700:4700::1111"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });
});

describe("validateSourceUrl", () => {
  it("accepts an https URL resolving to a public IP with 200", async () => {
    const res = await validateSourceUrl(
      "https://example.com/article",
      deps({ "example.com": ["93.184.216.34"] }, {
        "https://example.com/article": { status: 200 },
      }),
    );
    expect(res).toEqual({ ok: true, finalUrl: "https://example.com/article" });
  });

  it("rejects non-https", async () => {
    const res = await validateSourceUrl("http://example.com/", deps({ "example.com": ["8.8.8.8"] }, {}));
    expect(res).toEqual({ ok: false, reason: "not_https" });
  });

  it("rejects a host resolving to a private IP", async () => {
    const res = await validateSourceUrl(
      "https://internal.corp/",
      deps({ "internal.corp": ["10.1.2.3"] }, {}),
    );
    expect(res).toEqual({ ok: false, reason: "blocked_ip" });
  });

  it("rejects DNS rebinding (any resolved IP private)", async () => {
    const res = await validateSourceUrl(
      "https://mixed.example/",
      deps({ "mixed.example": ["93.184.216.34", "127.0.0.1"] }, {}),
    );
    expect(res.reason).toBe("blocked_ip");
  });

  it("re-validates redirect targets and blocks private hops", async () => {
    const res = await validateSourceUrl(
      "https://public.example/",
      deps(
        { "public.example": ["93.184.216.34"], "internal.example": ["10.0.0.9"] },
        { "https://public.example/": { status: 302, location: "https://internal.example/" } },
      ),
    );
    expect(res.reason).toBe("blocked_ip");
  });

  it("follows redirects to a public 200 and returns the final URL", async () => {
    const res = await validateSourceUrl(
      "https://a.example/",
      deps(
        { "a.example": ["93.184.216.34"], "b.example": ["1.1.1.1"] },
        {
          "https://a.example/": { status: 301, location: "https://b.example/final" },
          "https://b.example/final": { status: 200 },
        },
      ),
    );
    expect(res).toEqual({ ok: true, finalUrl: "https://b.example/final" });
  });

  it("rejects a redirect without a Location header", async () => {
    const res = await validateSourceUrl(
      "https://a.example/",
      deps({ "a.example": ["8.8.8.8"] }, { "https://a.example/": { status: 302 } }),
    );
    expect(res.reason).toBe("redirect_no_location");
  });

  it("rejects when DNS fails", async () => {
    const res = await validateSourceUrl("https://nope.example/", deps({}, {}));
    expect(res.reason).toBe("dns_failed");
  });

  it("stops after too many redirects", async () => {
    const res = await validateSourceUrl(
      "https://loop.example/",
      deps({ "loop.example": ["8.8.8.8"] }, {
        "https://loop.example/": { status: 302, location: "https://loop.example/" },
      }),
      );
    expect(res.reason).toBe("too_many_redirects");
  });

  it("aborts and reports timeout via the injected signal", async () => {
    const slowDeps: SourceUrlDeps = {
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      timeoutMs: 5,
    };
    const res = await validateSourceUrl("https://slow.example/", slowDeps);
    expect(res.reason).toBe("timeout");
  });
});
