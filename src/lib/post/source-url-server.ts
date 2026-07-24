import "server-only";

import { lookup } from "node:dns/promises";

import { validateSourceUrl } from "./source-url";

/**
 * 出典URLのSSRF検証の server-only 配線（要件05 §12, T-M3-06）。node dns.lookup({all}) と global fetch を
 * 注入して純粋層 validateSourceUrl を実値で使う。通過（https・非private・redirect先も検証）でtrue。
 */
export async function validateSourceUrlServer(url: string): Promise<boolean> {
  const result = await validateSourceUrl(url, {
    resolve: async (hostname) =>
      (await lookup(hostname, { all: true })).map((a) => ({
        address: a.address,
        family: a.family,
      })),
    fetch: (u, init) =>
      fetch(u, { method: init.method, redirect: init.redirect, signal: init.signal }),
  });
  return result.ok;
}
