import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

/**
 * App Shellの依存方向を固定する（T-M8-155）。判定はコード片の文字列一致なので、
 * **検出器が何にも当たらなくなっても否定形の検査は緑のまま通る**
 * （開発とテストの進め方 §「検出器が死んでいても緑になる」・R19）。
 * したがって検出器ごとに「1件以上当たること」を別に検査する。
 * 先行例は `src/lib/security/server-boundary.test.ts`。
 */

/**
 * Server Actionの直接import。`from"..."`（空白なし）と相対パス、動的importも拾う。
 * ここを `from\s+["']@\/app\/actions` だけにすると、書き方を変えるだけで素通りする。
 */
const ACTION_IMPORT = /(?:from|import)\s*\(?\s*["'](?:@\/app\/actions|(?:\.\.?\/)+app\/actions)/;

/** server adapter（`*-server` モジュール）への依存。 */
const SERVER_ADAPTER = /(?:from|import)\s*\(?\s*["'][^"']*-server["']/;

/**
 * 純粋coreが持ってはいけない、DB・framework・環境への依存。
 * 3列目は**その検出器がいま当たっている実ファイル**（生存確認用）。
 * ここが当たらなくなったら検出器が死んだということなので、検査ごと落とす。
 */
const CORE_FORBIDDEN = [
  ['import "server-only"', /import\s+["']server-only["']/, "lib/app-shell/data-server.ts"],
  ["@/lib/env", /@\/lib\/env/, "lib/app-shell/data-server.ts"],
  ["*-server module", SERVER_ADAPTER, "lib/app-shell/data-server.ts"],
  ["@/lib/db/pool", /@\/lib\/db\/pool/, "lib/app-shell/data-server.ts"],
  // Supabase clientはAuth専用で、データ読み出しはpool経由という分担（T-M8-158）。
  ["@/lib/supabase", /@\/lib\/supabase/, "lib/auth/session.ts"],
  ["next/headers", /next\/headers/, "lib/supabase/server.ts"],
  ["process.env", /process\.env/, "lib/env.ts"],
] as const;

/** `.tsx` を再帰で集める。非再帰にすると、サブディレクトリへ移すだけで検査対象から消える。 */
function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Client Componentかどうか。**先頭のコメントと空行を飛ばしてから見る**。
 * `startsWith('"use client"')` だと、単一引用符・先頭のeslint-disableコメント・空行1つで
 * Next.jsはclientのままなのに検査対象から外れる（実測で確認）。
 */
function isClientComponent(source: string): boolean {
  const body = source
    .replace(/^﻿/, "")
    .replace(/^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*/, "");
  return /^["']use client["']/.test(body);
}

const APP_SHELL_DIR = join(SRC, "components/app-shell");

const appShellTsx = listTsxFiles(APP_SHELL_DIR).map((full) => ({
  rel: relative(SRC, full),
  source: readFileSync(full, "utf8"),
}));
const clientComponents = appShellTsx.filter((file) => isClientComponent(file.source));

describe("App Shell dependency boundaries", () => {
  /**
   * 検出器の生存確認。**合計件数ではなく検出器ごとに見る**（1本が0件でも他が埋め合わせるため）。
   * 肯定側の当たり先は `app/app/layout.tsx`（Actionをlayoutで束ねる）と
   * `lib/app-shell/data-server.ts`（server adapter）で、どちらも本来の依存元。
   */
  it.each([
    ["ACTION_IMPORT", ACTION_IMPORT, "app/app/layout.tsx"],
    ["SERVER_ADAPTER", SERVER_ADAPTER, "lib/app-shell/data-server.ts"],
  ])("%s still matches %s (a detector that matches nothing is dead)", (name, pattern, anchor) => {
    expect(
      pattern.test(read(anchor)),
      `${name} no longer matches ${anchor} — the path or import style it looks for probably changed`,
    ).toBe(true);
  });

  it("the client component scan still reaches the components it must guard", () => {
    const scanned = clientComponents.map((file) => file.rel);
    // 走査が空振りしていないこと。ファイルを移動・改名したらここで落ちる（黙って0件にしない）。
    for (const required of [
      "components/app-shell/notification-bell.tsx",
      "components/app-shell/sign-out-button.tsx",
      "components/app-shell/x-account-switcher.tsx",
    ]) {
      expect(scanned, `${required} is no longer scanned as a client component`).toContain(required);
    }
  });

  it("client components receive Server Actions through props", () => {
    for (const { rel, source } of clientComponents) {
      expect(
        ACTION_IMPORT.test(source),
        `${rel} imports an App Router action instead of receiving its action contract`,
      ).toBe(false);
    }
  });

  it("layout delegates data orchestration to the App Shell adapter", () => {
    const layout = read("app/app/layout.tsx");
    expect(layout).toContain('from "@/lib/app-shell/data-server"');
    for (const adapter of [
      "@/lib/app-banners-server",
      "@/lib/notifications-server",
      "@/lib/supabase/server",
      "@/lib/usage/daily-post-limit-server",
      "@/lib/usage/usage-summary-server",
      "@/lib/x/account-actions-server",
    ]) {
      expect(layout, `layout directly depends on ${adapter}`).not.toContain(adapter);
    }
    for (const binding of [
      "listNotificationsAction",
      "markAllNotificationsReadAction",
      "markNotificationReadAction",
      "retryNotificationEmailAction",
      "setActiveXAccountAction",
      "signOutAction={signOut}",
    ]) {
      expect(layout, `layout does not wire ${binding}`).toContain(binding);
    }
    expect(read("app/plans/page.tsx")).toContain("signOutAction={signOut}");
  });

  /**
   * core は依存を持たず、同じ検出器が実ファイルには**当たる**こと。
   * 肯定側を並べて見ることで、core 側の否定形が空振りしていないと言える。
   */
  it.each(CORE_FORBIDDEN.map(([name]) => name))(
    "the App Shell core has no %s dependency (and the detector still matches)",
    (name) => {
      const [, pattern, anchor] = CORE_FORBIDDEN.find(([label]) => label === name)!;
      expect(pattern.test(read("lib/app-shell/data.ts")), `core depends on ${name}`).toBe(false);
      expect(
        pattern.test(read(anchor)),
        `${name} no longer matches ${anchor} — the detector is dead`,
      ).toBe(true);
    },
  );

  it("shared action styling is owned by the UI layer", () => {
    const billing = read("components/billing/upgrade-plan-button.tsx");
    const pageState = read("components/app-shell/page-state.tsx");
    const linkButton = read("components/ui/link-button.ts");

    expect(billing).not.toContain("@/components/app-shell/page-state");
    expect(pageState).toContain('from "@/components/ui/link-button"');
    expect(linkButton).toContain("export const stateActionClassName");
  });

  it("cross-screen brand components are not owned by App Shell", () => {
    const brand = read("components/brand/brand-logo.tsx");
    expect(brand).toContain("export function BrandLogo");
    expect(brand).toContain("export function LogoTile");
    expect(() => read("components/app-shell/brand-logo.tsx")).toThrow();

    for (const consumer of [
      "app/app/layout.tsx",
      "app/page.tsx",
      "components/auth/auth-page-shell.tsx",
      "components/lp/hero-mock.tsx",
    ]) {
      expect(read(consumer)).toContain("@/components/brand/brand-logo");
    }
  });
});
