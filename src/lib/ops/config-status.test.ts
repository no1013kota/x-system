import { describe, expect, it } from "vitest";

import {
  classifySentryDsn,
  judgeConfig,
  judgePendingConfirmations,
  type ConfigFacts,
} from "./config-status";

/**
 * T-M8-147。**「設定が本番へ反映されていない」を検出する。**
 *
 * 必須の環境変数は起動時検証（`env-schema.ts`）が落とすので気付けるが、**既定値を持つ設定は
 * 欠けても起動する**。2026-08-18、本番の `X_POSTING_MODE` が既定の `dry_run` のままで、
 * **Xへ1件も投稿されないのに全画面が正常に見える**状態だった。単体テスト・`release:check`・
 * `doctor` はいずれも env を見ておらず、運営者が手で気付くまで分からなかった。
 */
function facts(over: Partial<ConfigFacts> = {}): ConfigFacts {
  return {
    appEnv: "production",
    postingMode: "live",
    appBaseUrl: "https://exosai.net",
    actualOrigin: "https://exosai.net",
    stripeKeyKind: "live",
    sentryDsnKind: "usable",
    sentryPublicDsnKind: "usable",
    sentryHost: "o1.ingest.us.sentry.io",
    ...over,
  };
}

const find = (input: ConfigFacts, name: string) => {
  const check = judgeConfig(input).find((c) => c.name === name);
  if (!check) throw new Error(`検査項目が見つかりません: ${name}`);
  return check;
};

describe("judgeConfig", () => {
  /**
   * **項目名で固定する**（件数だけだと1本消えて別の1本が増えたときに気付けない）。
   * 検査が黙って減るのを防ぐのがこのテストの役目。
   */
  it("本番が正しく設定されていれば、検査項目が揃っていてすべて正常", () => {
    const checks = judgeConfig(facts());

    expect(checks.map((c) => c.name)).toEqual([
      "Xへの投稿",
      "アプリのURL設定",
      "決済（Stripe）の接続先",
      "エラーの記録（Sentry）",
    ]);
    expect(checks.every((c) => c.level === "ok")).toBe(true);
  });

  it("本番が dry_run のままなら異常として次の一手を出す（2026-08-18の実例）", () => {
    const check = find(facts({ postingMode: "dry_run" }), "Xへの投稿");
    expect(check.level).toBe("error");
    expect(check.detail).toContain("Xへは1件も送られません");
    expect(check.nextAction).toContain("X_POSTING_MODE");
  });

  it("本番以外で live なら異常（実投稿してしまう）", () => {
    const check = find(facts({ appEnv: "preview", postingMode: "live" }), "Xへの投稿");
    expect(check.level).toBe("error");
  });

  it("本番以外の dry_run は正常（常に赤い表示にしない）", () => {
    expect(find(facts({ appEnv: "development", postingMode: "dry_run" }), "Xへの投稿").level).toBe(
      "ok",
    );
  });

  it("APP_BASE_URL が実際の配信元と違えば異常（メールのリンクが別ドメインを指す）", () => {
    const check = find(
      facts({ appBaseUrl: "https://x-system.vercel.app" }),
      "アプリのURL設定",
    );
    expect(check.level).toBe("error");
    expect(check.nextAction).toContain("https://exosai.net");
  });

  it("末尾スラッシュと大文字小文字の違いは同一とみなす", () => {
    expect(
      find(facts({ appBaseUrl: "https://ExosAI.net/" }), "アプリのURL設定").level,
    ).toBe("ok");
  });

  it("localhost と 127.0.0.1 は同一ホストとして扱う（開発環境で常に赤くしない）", () => {
    expect(
      find(
        facts({
          appEnv: "development",
          postingMode: "dry_run",
          stripeKeyKind: "test",
          appBaseUrl: "http://127.0.0.1:3000",
          actualOrigin: "http://localhost:3000",
        }),
        "アプリのURL設定",
      ).level,
    ).toBe("ok");
  });

  it("ポートが違えば別として扱う", () => {
    expect(
      find(
        facts({ appBaseUrl: "https://exosai.net", actualOrigin: "https://exosai.net:8080" }),
        "アプリのURL設定",
      ).level,
    ).toBe("error");
  });

  it("APP_BASE_URL 未設定は異常", () => {
    expect(find(facts({ appBaseUrl: null }), "アプリのURL設定").level).toBe("error");
  });

  it("配信元が判定できないときは異常ではなく注意に留める", () => {
    expect(find(facts({ actualOrigin: null }), "アプリのURL設定").level).toBe("warn");
  });

  it("本番にテストの決済キーが入っていれば異常（請求されない）", () => {
    const check = find(facts({ stripeKeyKind: "test" }), "決済（Stripe）の接続先");
    expect(check.level).toBe("error");
    expect(check.detail).toContain("実際には請求されません");
  });

  it("本番以外のテストキーは正常", () => {
    expect(
      find(facts({ appEnv: "preview", postingMode: "dry_run", stripeKeyKind: "test" }), "決済（Stripe）の接続先")
        .level,
    ).toBe("ok");
  });

  it("決済キーが無いとき、本番は異常・それ以外は注意", () => {
    expect(find(facts({ stripeKeyKind: null }), "決済（Stripe）の接続先").level).toBe("error");
    expect(
      find(facts({ appEnv: "development", postingMode: "dry_run", stripeKeyKind: null }), "決済（Stripe）の接続先")
        .level,
    ).toBe("warn");
  });

  it("秘密値を応答へ載せない（鍵の種別だけを扱う型である）", () => {
    const serialized = JSON.stringify(judgeConfig(facts()));
    expect(serialized).not.toContain("sk_live_");
    expect(serialized).not.toContain("sk_test_");
  });
});

/**
 * 2026-08-18 に運営者が踏んだ罠。**送信元と同じGmailアドレスで登録すると、確認コードは
 * 受信トレイに入らず「送信済み」にだけ残る**（Gmailが Message-ID で重複排除する）。
 * Supabaseは送信成功・SMTPエラーも無し・アプリのログにも何も出ないため、
 * 状態確認の画面で名指しする以外に気付く経路が無い。
 */
describe("judgePendingConfirmations", () => {
  const sender = "owner@gmail.com";

  it("未確認の登録が無ければ正常", () => {
    const check = judgePendingConfirmations({ senderEmail: sender, unconfirmedEmails: [] });
    expect(check.level).toBe("ok");
    expect(check.detail).toBe("ありません");
  });

  it("送信元と無関係な未確認は正常（途中でやめた利用者を黄色くしない）", () => {
    const check = judgePendingConfirmations({
      senderEmail: sender,
      unconfirmedEmails: ["a@example.com", "b@example.com"],
    });
    expect(check.level).toBe("ok");
    expect(check.detail).toContain("2 件");
  });

  it("送信元と同じアドレスの未確認があれば注意として理由と次の一手を出す", () => {
    const check = judgePendingConfirmations({
      senderEmail: sender,
      unconfirmedEmails: ["other@example.com", sender],
    });
    expect(check.level).toBe("warn");
    expect(check.detail).toContain("受信トレイに入れない");
    expect(check.nextAction).toContain("送信済み");
  });

  it("Gmailのドットと+付きは同じ受信箱として扱う", () => {
    const check = judgePendingConfirmations({
      senderEmail: "ow.ner@gmail.com",
      unconfirmedEmails: ["owner+test@gmail.com"],
    });
    expect(check.level).toBe("warn");
  });

  it("gmail以外はドットを別アドレスとして扱う", () => {
    const check = judgePendingConfirmations({
      senderEmail: "ow.ner@example.com",
      unconfirmedEmails: ["owner@example.com"],
    });
    expect(check.level).toBe("ok");
  });

  it("送信元が不明なら件数だけを出す（判定できないことを異常にしない）", () => {
    const check = judgePendingConfirmations({
      senderEmail: null,
      unconfirmedEmails: ["owner@gmail.com"],
    });
    expect(check.level).toBe("ok");
  });
});

/**
 * エラー記録の宛先（T-M8-162）。**記録先が沈黙していても気付けなかった**ので、
 * doctorがそこを見るようにした分の検査。DSNの値そのものは扱わない（種別とホストだけ）。
 */
describe("classifySentryDsn", () => {
  it("http(s) のDSNは usable、ホストを返す", () => {
    expect(classifySentryDsn("https://abc@o1.ingest.us.sentry.io/42")).toEqual({
      kind: "usable",
      host: "o1.ingest.us.sentry.io",
    });
  });

  it("未設定は missing", () => {
    expect(classifySentryDsn(undefined)).toEqual({ kind: "missing", host: null });
    expect(classifySentryDsn("")).toEqual({ kind: "missing", host: null });
  });

  /** 手元の `.env.local` が実際にこの形だった。空でないので「設定済み」に見えてしまう。 */
  it("仮の値（__TODO…）は placeholder として区別する", () => {
    expect(classifySentryDsn("__TODO_sentry_dsn__")).toEqual({
      kind: "placeholder",
      host: null,
    });
  });

  it("URLとして読めない値は invalid", () => {
    expect(classifySentryDsn("not a url")).toEqual({ kind: "invalid", host: null });
  });

  it("http(s) 以外のスキームは invalid（Sentryは初期化されない）", () => {
    expect(classifySentryDsn("ftp://host/1")).toEqual({ kind: "invalid", host: null });
  });
});

describe("judgeConfig のエラー記録", () => {
  const NAME = "エラーの記録（Sentry）";

  it("本番でDSNが仮の値なら error にし、直し方を出す", () => {
    const check = find(facts({ sentryDsnKind: "placeholder", sentryHost: null }), NAME);

    expect(check.level).toBe("error");
    expect(check.detail).toContain("1件も記録されません");
    expect(check.nextAction).toContain("SENTRY_DSN");
  });

  it("本番でブラウザ側だけ未設定でも error にする（片方だけでは足りない）", () => {
    const check = find(facts({ sentryPublicDsnKind: "missing" }), NAME);

    expect(check.level).toBe("error");
    expect(check.nextAction).toContain("NEXT_PUBLIC_SENTRY_DSN");
  });

  /** ローカルでDSNが無いのは正常系。ここを error にすると開発中ずっと赤くなり読まれなくなる。 */
  it("production以外でDSNが無いのは ok", () => {
    const check = find(
      facts({
        appEnv: "development",
        postingMode: "dry_run",
        sentryDsnKind: "placeholder",
        sentryPublicDsnKind: "placeholder",
        sentryHost: null,
      }),
      NAME,
    );

    expect(check.level).toBe("ok");
  });

  /** 受け先ホストを出す（データリージョンの手がかり＝要決定D-18/D-19の判断材料）。 */
  it("有効なら受け先ホストを detail に出す", () => {
    expect(find(facts(), NAME).detail).toContain("o1.ingest.us.sentry.io");
  });
});
