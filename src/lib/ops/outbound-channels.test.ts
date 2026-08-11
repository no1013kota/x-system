import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canSendViaSmtp } from "../email/notification-email";
import {
  OUTBOUND_CHANNELS,
  OUTBOUND_MARKERS,
  OUTBOUND_SCAN_EXCLUDED,
  registeredOutboundFiles,
} from "./outbound-channels";

/**
 * 外向き副作用チャネルのガード網羅（T-M7-28）。
 *
 * 2026-07-27、X投稿は守られていたのにSMTPは素通りで、動作確認の `scheduler_tick` が98通を
 * 実送信した。個別にガードを足すだけでは**次に増えたチャネル**を守れないため、
 * 「どのファイルが外へ出るか」の一覧をテストとして持つ。一覧に無いファイルが外向き呼び出しを
 * 持ったらこのテストが落ちる。
 */

// 実行時のカレントディレクトリに依存させない（T-M8-51・R19）。
const SRC = join(fileURLToPath(new URL("../../../", import.meta.url)), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.tsx?$|\.db\.test\.ts$|\.live\.test\.ts$|\.local\.test\.ts$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/** 外向き呼び出しの目印を含むファイル（`src/` 相対パス）→ 目印ID。 */
function filesWithOutboundCalls(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(SRC, file).replaceAll("\\", "/");
    if ((OUTBOUND_SCAN_EXCLUDED as readonly string[]).includes(rel)) continue;
    const ids = OUTBOUND_MARKERS.filter((m) => m.pattern.test(text)).map((m) => m.id);
    if (ids.length > 0) found.set(rel, ids);
  }
  return found;
}

describe("外向きチャネルの一覧（新しいチャネルを足したら落ちる）", () => {
  it("外向き呼び出しを持つファイルはすべて一覧へ登録されている", () => {
    const registered = registeredOutboundFiles();
    const unregistered = [...filesWithOutboundCalls().entries()]
      .filter(([file]) => !registered.has(file))
      .map(([file, ids]) => `${file}（${ids.join(",")}）`);
    expect(
      unregistered,
      "外部へ出る処理を追加したら src/lib/ops/outbound-channels.ts へ登録し、" +
        "非productionで実害が出ないガードを書いてください（T-M7-28）",
    ).toEqual([]);
  });

  it("一覧に挙げたファイルは実在し、実際に外向き呼び出しを含む（腐った登録を残さない）", () => {
    const actual = filesWithOutboundCalls();
    const stale = [...registeredOutboundFiles()].filter((file) => !actual.has(file));
    expect(stale, "外向き呼び出しが無くなったファイルは一覧から外してください").toEqual([]);
  });

  it("各チャネルに日本語の説明とガードの説明がある", () => {
    for (const channel of OUTBOUND_CHANNELS) {
      expect(channel.label.length, `${channel.id} の説明が短すぎる`).toBeGreaterThan(5);
      expect(channel.guard.length, `${channel.id} のガード説明が短すぎる`).toBeGreaterThan(20);
      expect(channel.files.length, `${channel.id} にファイルが無い`).toBeGreaterThan(0);
    }
  });
});

describe("各ガードの振る舞い", () => {
  it("SMTP: production以外はループバック宛しか送らない（98通誤送信の再発防止）", () => {
    expect(canSendViaSmtp({ appEnv: "development", host: "smtp.gmail.com" })).toBe(false);
    expect(canSendViaSmtp({ appEnv: "preview", host: "smtp.sendgrid.net" })).toBe(false);
    expect(canSendViaSmtp({ appEnv: "development", host: "127.0.0.1" })).toBe(true);
    expect(canSendViaSmtp({ appEnv: "development", host: "localhost" })).toBe(true);
    expect(canSendViaSmtp({ appEnv: "production", host: "smtp.gmail.com" })).toBe(true);
  });

  it("X投稿: dry_run では投稿・削除のHTTPを呼ばない", async () => {
    const { createPost, deletePost } = await import("../x/client");
    let httpCalls = 0;
    const deps = {
      mode: "dry_run" as const,
      http: async () => {
        httpCalls += 1;
        throw new Error("dry_run でHTTPを呼んではいけない");
      },
    };
    const posted = await createPost("token", { text: "本文" }, deps as never);
    const deleted = await deletePost("token", "123", deps as never);
    expect(httpCalls, "HTTPは1度も呼ばれない").toBe(0);
    expect(posted.dryRun).toBe(true);
    expect(deleted.dryRun).toBe(true);
  });

  it("X投稿: live は production 以外では起動時のenv検証で弾かれる", async () => {
    const { buildServerEnv } = await import("../env-schema");
    const base = {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      APP_BASE_URL: "http://127.0.0.1:3000",
      APP_ENV: "development",
      X_POSTING_MODE: "live",
    };
    // development で live を指定すると起動時に落ちる（要件01 §3.1）。
    // 他の必須値の不足とは別の理由であることを、メッセージで確かめる。
    expect(() => buildServerEnv(base as never)).toThrow(/X_POSTING_MODE/);
    let dryRunError = "";
    try {
      buildServerEnv({ ...base, X_POSTING_MODE: "dry_run" } as never);
    } catch (err) {
      dryRunError = err instanceof Error ? err.message : String(err);
    }
    expect(dryRunError, "dry_run では X_POSTING_MODE が理由にならない").not.toContain(
      "X_POSTING_MODE",
    );
  });
});
