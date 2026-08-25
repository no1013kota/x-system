import { describe, expect, it } from "vitest";

import {
  FREE_DB_SIZE_LIMIT_BYTES,
  describeEmptyCategories,
  judgeBlog,
  judgeCost,
  judgeDatabaseSize,
  judgePoolWaits,
  judgeJobs,
  judgeNews,
  judgeRepeatedFailures,
  judgeScheduler,
  judgeStuckJobs,
  judgeSubscriptionSync,
  judgeXAccounts,
  summarize,
  type Check,
  worstLevel,
} from "./diagnostics";

/**
 * 運営者向け診断の判定（T-M7-34）。**運営者がログを読まずに次の一手へ進めること**を守る。
 * 文言そのものではなく「レベルの判定」と「異常時に次の一手が付いていること」を固定する。
 */

const check = (over: Partial<Check> = {}): Check => ({ name: "x", level: "ok", detail: "d", ...over });

describe("worstLevel / summarize", () => {
  it("最も重いレベルを返す", () => {
    expect(worstLevel(["ok", "warn", "error"])).toBe("error");
    expect(worstLevel(["ok", "warn"])).toBe("warn");
    expect(worstLevel(["ok", "ok"])).toBe("ok");
    expect(worstLevel([])).toBe("ok");
  });

  it("まとめには必ず件数が入る（「問題なし」だけで終わらせない）", () => {
    expect(summarize([check(), check()])).toContain("2");
    expect(summarize([check({ level: "warn" })])).toContain("1");
    expect(summarize([check({ level: "error" }), check({ level: "warn" })])).toContain("1");
  });
});

describe("judgeJobs", () => {
  it("実行が無ければ正常", () => {
    expect(judgeJobs({ succeeded: 0, failed: 0 }).level).toBe("ok");
  });

  it("全部成功なら正常", () => {
    expect(judgeJobs({ succeeded: 5, failed: 0 }).level).toBe("ok");
  });

  it("1件でも失敗していれば注意し、次の一手を出す（黙って流さない）", () => {
    const r = judgeJobs({ succeeded: 5, failed: 1 });
    expect(r.level).toBe("warn");
    expect(r.nextAction).toBeTruthy();
    expect(r.detail).toContain("1");
  });

  it("失敗が成功より多ければ異常", () => {
    expect(judgeJobs({ succeeded: 1, failed: 3 }).level).toBe("error");
  });
});

describe("judgeNews（定時実行が動かない環境で赤くしない）", () => {
  it("本番以外では止まっていても正常扱い（常に赤い表示は読まれなくなる）", () => {
    const r = judgeNews({ itemsLast48h: 0, hoursSinceLastRun: 73, schedulerExpected: false });
    expect(r.level).toBe("ok");
    expect(r.detail).toContain("自動で動きません");
  });

  it("本番で6時間以上止まっていれば異常", () => {
    const r = judgeNews({ itemsLast48h: 10, hoursSinceLastRun: 7, schedulerExpected: true });
    expect(r.level).toBe("error");
    expect(r.nextAction).toBeTruthy();
  });

  it("本番で動いているが0件なら注意（T-M7-24 の再発検知）", () => {
    const r = judgeNews({ itemsLast48h: 0, hoursSinceLastRun: 1, schedulerExpected: true });
    expect(r.level).toBe("warn");
    expect(r.nextAction).toBeTruthy();
  });

  it("本番で動いて取得できていれば正常", () => {
    expect(judgeNews({ itemsLast48h: 12, hoursSinceLastRun: 1, schedulerExpected: true }).level).toBe("ok");
  });

  it("本番で一度も実行されていなければ異常", () => {
    expect(judgeNews({ itemsLast48h: 0, hoursSinceLastRun: null, schedulerExpected: true }).level).toBe("error");
  });
});

describe("テーマごとの0件の意味を運営者へ出す（T-M7-40）", () => {
  const ok = (category: string, fetched: number) => ({
    category,
    ok: true,
    fetched,
    dropped: 0,
    dropReasons: {},
  });
  const allDropped = (category: string, n: number) => ({
    category,
    ok: true,
    fetched: 0,
    dropped: n,
    dropReasons: { "title:too_big": n },
  });

  it("該当なしと全件破棄と失敗を分けて返す", () => {
    const r = describeEmptyCategories([
      ok("ai", 3),
      ok("web3", 0),
      allDropped("sns", 4),
      { category: "business", ok: false, fetched: 0, dropped: 0, dropReasons: {} },
    ]);
    expect(r.noMatch).toEqual(["web3"]);
    expect(r.allDropped).toEqual([{ category: "sns", reasons: "title:too_big×4" }]);
    expect(r.failed).toEqual([
      { category: "business", errorCode: null, failureKind: null },
    ]);
  });

  it("全件破棄は取得件数があっても注意として上げる（テーマが永久に0件になるのを見逃さない）", () => {
    const r = judgeNews({
      itemsLast48h: 10,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [ok("ai", 3), allDropped("web3", 4)],
    });
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("全件破棄されたテーマ: web3");
    expect(r.detail).toContain("title:too_big×4");
    expect(r.nextAction).toContain("失敗記録");
  });

  it("全件破棄で総取得も0件なら異常", () => {
    const r = judgeNews({
      itemsLast48h: 0,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [allDropped("web3", 4)],
    });
    expect(r.level).toBe("error");
  });

  it("「取得窓より古い」だけの除外は該当なし扱い（直せない理由で警告しない・T-M7-44）", () => {
    const r = describeEmptyCategories([
      { category: "ai", ok: true, fetched: 0, dropped: 5, dropReasons: { "published_at:too_old": 5 } },
    ]);
    expect(r.allDropped, "全件破棄には数えない").toEqual([]);
    expect(r.noMatch).toEqual(["ai"]);
  });

  it("契約違反が混じれば全件破棄として扱う", () => {
    const r = describeEmptyCategories([
      {
        category: "ai",
        ok: true,
        fetched: 0,
        dropped: 4,
        dropReasons: { "published_at:too_old": 3, "title:too_big": 1 },
      },
    ]);
    expect(r.allDropped).toHaveLength(1);
    expect(r.noMatch).toEqual([]);
  });

  it("該当なしだけなら正常のまま、どのテーマかは伝える", () => {
    const r = judgeNews({
      itemsLast48h: 10,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [ok("ai", 3), ok("web3", 0)],
    });
    expect(r.level).toBe("ok");
    expect(r.detail).toContain("該当ニュースが無かったテーマ: web3");
  });

  it("定時実行が動かない環境でも全件破棄は注意として上げる", () => {
    const r = judgeNews({
      itemsLast48h: 0,
      hoursSinceLastRun: 2,
      schedulerExpected: false,
      outcomes: [allDropped("web3", 4)],
    });
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("全件破棄されたテーマ: web3");
  });
});

// （judgeQueuedEmails のテストはT-M8-222で削除——メール通知機能ごと廃止）

/**
 * 定時実行の生存（T-M8-51）。旧・お知らせメール検査と同型の見落としで、止まっていても
 * doctor はどこも赤くならなかった。tick が死ぬと予約投稿・アプリ内通知・日次サマリが静かに全部止まる。
 */
describe("judgeScheduler", () => {
  it("本番で15分以内に動いていれば正常", () => {
    expect(judgeScheduler({ minutesSinceLastRun: 4, schedulerExpected: true }).level).toBe("ok");
  });

  it("本番で15分を超えたらエラー（5分間隔で動く想定）", () => {
    const r = judgeScheduler({ minutesSinceLastRun: 40, schedulerExpected: true });
    expect(r.level).toBe("error");
    expect(r.detail).toContain("40");
    expect(r.nextAction).toContain("Vercel Cron");
  });

  it("本番で一度も動いていなければエラー（「実行なし」と正常を混同しない）", () => {
    const r = judgeScheduler({ minutesSinceLastRun: null, schedulerExpected: true });
    expect(r.level).toBe("error");
    expect(r.nextAction).toBeTruthy();
  });

  // ローカル・previewでは動かないのが正しいので赤くしない（judgeNews と同じ扱い）。
  it("定時実行が前提でない環境では赤くしない", () => {
    expect(judgeScheduler({ minutesSinceLastRun: null, schedulerExpected: false }).level).toBe("ok");
    expect(judgeScheduler({ minutesSinceLastRun: 999, schedulerExpected: false }).level).toBe("ok");
  });
});

describe("judgeXAccounts", () => {
  it("連携が無ければ注意して次の一手を出す", () => {
    const r = judgeXAccounts([]);
    expect(r.level).toBe("warn");
    expect(r.nextAction).toBeTruthy();
  });

  it("active でないアカウントがあれば異常（再連携が必要）", () => {
    const r = judgeXAccounts([{ handle: "a", status: "error", expiresInHours: 5 }]);
    expect(r.level).toBe("error");
    expect(r.nextAction).toBeTruthy();
  });

  it("期限切れは注意どまり（次の操作で自動更新される）", () => {
    const r = judgeXAccounts([{ handle: "a", status: "active", expiresInHours: -22 }]);
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("@a");
  });

  it("有効で期限内なら正常", () => {
    expect(judgeXAccounts([{ handle: "a", status: "active", expiresInHours: 3 }]).level).toBe("ok");
  });
});

describe("judgeStuckJobs", () => {
  it("無ければ正常、あれば異常で次の一手を出す", () => {
    expect(judgeStuckJobs({ stuck: 0 }).level).toBe("ok");
    const r = judgeStuckJobs({ stuck: 2 });
    expect(r.level).toBe("error");
    expect(r.nextAction).toBeTruthy();
  });
});

describe("judgeCost（原則4: 費用が見える）", () => {
  it("金額を円換算つきで必ず出す", () => {
    const r = judgeCost({ monthUsd: 14.34, byProvider: [{ provider: "anthropic", usd: 13.15 }] });
    expect(r.level).toBe("ok");
    expect(r.detail).toContain("$14.34");
    expect(r.detail).toContain("円");
    expect(r.detail).toContain("anthropic");
  });

  it("0円でも数字を出す（見えないことが問題なので黙らせない）", () => {
    expect(judgeCost({ monthUsd: 0, byProvider: [] }).detail).toContain("$0.00");
  });
});

/**
 * データベースの使用量（T-M7-43）。2026-08-01、Supabaseの組織が容量超過で停止し、
 * **組織内の全プロジェクトが402になった**。停止すると使用量が0表示になり原因の特定すらできない。
 * 止まる前に気付けるようにするための判定。
 */
describe("judgeDatabaseSize", () => {
  const MB = 1024 * 1024;
  const limit = FREE_DB_SIZE_LIMIT_BYTES;

  it("無料枠の上限は500MB", () => {
    expect(limit).toBe(500 * MB);
  });

  it("余裕があれば正常（数字は必ず出す）", () => {
    const r = judgeDatabaseSize({ bytes: 26 * MB, limitBytes: limit });
    expect(r.level).toBe("ok");
    expect(r.detail).toBe("26 MB / 500 MB（5%）");
  });

  it("80%を超えたら注意", () => {
    const r = judgeDatabaseSize({ bytes: 400 * MB, limitBytes: limit });
    expect(r.level).toBe("warn");
    expect(r.nextAction).toContain("大きいテーブルを調べて");
  });

  it("95%を超えたら異常（超えると組織全体が止まるため手前で赤くする）", () => {
    const r = judgeDatabaseSize({ bytes: 480 * MB, limitBytes: limit });
    expect(r.level).toBe("error");
    expect(r.nextAction).toContain("すべて停止");
  });

  it("境界: ちょうど80%は注意、79%は正常", () => {
    expect(judgeDatabaseSize({ bytes: 400 * MB, limitBytes: limit }).level).toBe("warn");
    expect(judgeDatabaseSize({ bytes: 395 * MB, limitBytes: limit }).level).toBe("ok");
  });

  it("GB単位でも読める表記にする（Proの8GB等）", () => {
    const r = judgeDatabaseSize({ bytes: 2 * 1024 * MB, limitBytes: 8 * 1024 * MB });
    expect(r.detail).toBe("2.00 GB / 8.00 GB（25%）");
    expect(r.level).toBe("ok");
  });

  it("上限0でも壊れない（設定ミス時に例外を出さない）", () => {
    expect(() => judgeDatabaseSize({ bytes: 100, limitBytes: 0 })).not.toThrow();
  });
});

/**
 * providerの失敗を運営者が直せる言葉で出す（T-M8-163）。
 *
 * 2026-08-20、本番は「取得に失敗したテーマ: ai（http_400）」＋「Claudeに聞いてください」だけを出し、
 * 実際の原因（Anthropicのクレジット切れ＝運営者が5分で直せる）へ辿れなかった。
 */
describe("providerの失敗理由を直せる言葉で出す（T-M8-163）", () => {
  const failedOutcome = (category: string, failureKind: string | null) => ({
    category,
    ok: false,
    fetched: 0,
    dropped: 0,
    dropReasons: {},
    errorCode: "http_400",
    failureKind: failureKind as never,
  });

  it("クレジット切れは「残高が不足」と出し、購入の操作を出す（http_400 で終わらせない）", () => {
    const r = judgeNews({
      itemsLast48h: 0,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [
        failedOutcome("ai", "credit_exhausted"),
        failedOutcome("investment", "credit_exhausted"),
      ],
    });

    expect(r.detail).toContain("残高が不足");
    expect(r.detail).not.toContain("http_400");
    expect(r.nextAction).toContain("クレジット");
  });

  /** 待てば直るものと、お金を払わないと直らないものを混同しない。 */
  it("レート制限は待つ案内になる", () => {
    const r = judgeNews({
      itemsLast48h: 0,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [failedOutcome("ai", "rate_limited")],
    });

    expect(r.nextAction).toContain("待つ");
  });

  /** 原因が混ざっているときに片方の操作を勧めると、案内そのものが信用されなくなる。 */
  it("原因が混ざっているときは決めつけず記録を見る案内へ戻す", () => {
    const r = judgeNews({
      itemsLast48h: 0,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [
        failedOutcome("ai", "credit_exhausted"),
        failedOutcome("sns", "invalid_key"),
      ],
    });

    expect(r.nextAction).toContain("失敗記録");
  });

  it("分類できなければ従来どおりコードを出す（勝手に決めつけない）", () => {
    const r = judgeNews({
      itemsLast48h: 0,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [failedOutcome("ai", "unknown")],
    });

    expect(r.detail).toContain("http_400");
    expect(r.nextAction).toContain("失敗記録");
  });

  /**
   * **providerの応答本文を運営者向けの出力へ載せない**（要件01 §8）。
   * 分類のために本文を読むようになったので、漏れないことをここで固定する。
   */
  it("providerの応答本文は detail にも nextAction にも出ない", () => {
    const r = judgeNews({
      itemsLast48h: 0,
      hoursSinceLastRun: 1,
      schedulerExpected: true,
      outcomes: [failedOutcome("ai", "credit_exhausted")],
    });

    const rendered = `${r.detail} ${r.nextAction ?? ""}`;
    for (const leak of ["request_id", "invalid_request_error", "Your credit balance"]) {
      expect(rendered, leak).not.toContain(leak);
    }
  });
});

describe("judgeBlog（ブログ記事の同梱・T-M8-184）", () => {
  it("blog/ が同梱されていなければ error（本番だけ「準備中」になる事故）", () => {
    const check = judgeBlog({ directoryExists: false, published: 0, drafts: 0, invalidFiles: [] });
    expect(check.level).toBe("error");
    expect(check.nextAction).toContain("outputFileTracingIncludes");
  });

  it("不備のある記事があれば warn で blog:check を案内する", () => {
    const check = judgeBlog({
      directoryExists: true,
      published: 2,
      drafts: 1,
      invalidFiles: ["broken.md"],
    });
    expect(check.level).toBe("warn");
    expect(check.detail).toContain("broken.md");
    expect(check.nextAction).toContain("npm run blog:check");
  });

  it("公開0件でもディレクトリがあれば ok（記事が無いのは正常な空）", () => {
    const check = judgeBlog({ directoryExists: true, published: 0, drafts: 0, invalidFiles: [] });
    expect(check.level).toBe("ok");
    expect(check.detail).toBe("公開 0 件・下書き 0 件");
  });
});

describe("judgeSubscriptionSync（契約の同期・T-M8-238）", () => {
  it("イベント0件は warn（契約者がまだいなければ正常）", () => {
    const check = judgeSubscriptionSync({ hoursSinceLastEvent: null, totalEvents: 0 });
    expect(check.level).toBe("warn");
    expect(check.nextAction).toContain("webhook");
  });

  it("最後の受信から時間が経ちすぎていたら warn", () => {
    const check = judgeSubscriptionSync({ hoursSinceLastEvent: 100, totalEvents: 12 });
    expect(check.level).toBe("warn");
    expect(check.detail).toContain("100 時間");
  });

  it("直近に受信していれば ok", () => {
    expect(judgeSubscriptionSync({ hoursSinceLastEvent: 2, totalEvents: 12 })).toMatchObject({
      level: "ok",
    });
  });
});

/**
 * DB接続の待ち行列（T-M8-198）。要件01 §9 の移行条件「pooler接続の枯渇・待ち行列が観測された」を
 * 運営者が画面1つで判断できるようにする。記録は待たされたときだけ入るので、通常は0件。
 */
describe("judgePoolWaits", () => {
  it("待ちが無ければ ok（0件であることを言い切る）", () => {
    const r = judgePoolWaits({ waits24h: 0, maxWaitedMs: 0 });
    expect(r.level).toBe("ok");
    expect(r.detail).toContain("接続の待ちはありません");
    expect(r.nextAction).toBeUndefined();
  });

  it("1件以上なら注意（件数と最長待ち時間を出す）", () => {
    const r = judgePoolWaits({ waits24h: 3, maxWaitedMs: 1_500 });
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("3回");
    expect(r.detail).toContain("1.5秒");
    expect(r.nextAction).toContain("Supabase Pro");
  });

  it("常態化したら異常（移行条件に該当することを名指しする）", () => {
    const r = judgePoolWaits({ waits24h: 20, maxWaitedMs: 5_000 });
    expect(r.level).toBe("error");
    expect(r.nextAction).toContain("要件01 §9");
  });
});

/**
 * 効いている接続上限を必ず出す（要決定D-43・T-M8-303）。
 * `DB_POOL_MAX` はデプロイ先の環境変数なので「設定したつもりで入っていない」が起こる。
 * 回数だけ見せても、運営者は「対策が効いていないのか、対策はしたが足りないのか」を
 * 区別できない（原則2: 原因が開発知識なしで辿れる）。
 */
describe("judgePoolWaits の上限表示（T-M8-303）", () => {
  it("待ちが無くても、いま効いている上限を出す", () => {
    const check = judgePoolWaits({ waits24h: 0, maxWaitedMs: 0, poolMax: 3 });
    expect(check.level).toBe("ok");
    expect(check.detail).toContain("1インスタンスあたり上限 3");
  });

  it("警告のときも上限を添える（対策済みかどうかが読める）", () => {
    const check = judgePoolWaits({ waits24h: 5, maxWaitedMs: 900, poolMax: 10 });
    expect(check.level).toBe("warn");
    expect(check.detail).toContain("1インスタンスあたり上限 10");
  });

  it("上限が分からないときは数字を作らない", () => {
    expect(judgePoolWaits({ waits24h: 0, maxWaitedMs: 0 }).detail).not.toContain("上限");
  });
});

/**
 * 合計だけでは見えない壊れ方を運営者へ届ける（T-M8-307）。
 * 2026-08-25 の不具合は「1人の利用者の実行が全滅、画面には残り満額」という形だった。
 */
describe("judgeRepeatedFailures（誰がどう壊れているかを出す）", () => {
  const group = (message: string, count: number, users = 1) => ({ message, count, users });

  it("失敗が無ければ ok", () => {
    const c = judgeRepeatedFailures({ groups: [], allFailingUsers: 0 });
    expect(c.level).toBe("ok");
    expect(c.detail).toContain("失敗はありません");
  });

  it("ばらけた少数の失敗は ok（毎日赤くしない）", () => {
    const c = judgeRepeatedFailures({
      groups: [group("画像の生成に失敗しました", 2), group("Xへの投稿に失敗しました", 1)],
      allFailingUsers: 0,
    });
    expect(c.level).toBe("ok");
    expect(c.detail).toContain("2");
  });

  it("同じ理由が繰り返していれば warn（仕組みの問題の疑い）", () => {
    const c = judgeRepeatedFailures({
      groups: [group("AIの利用残高が不足しています", 9, 4)],
      allFailingUsers: 0,
    });
    expect(c.level).toBe("warn");
    expect(c.detail).toContain("AIの利用残高が不足しています");
    expect(c.detail).toContain("利用者 4 名");
    expect(c.nextAction).toBeTruthy();
  });

  it("実行が全滅している利用者がいれば error（合計では warn 止まりでも）", () => {
    const c = judgeRepeatedFailures({
      groups: [group("しばらくしてからもう一度お試しください", 3)],
      allFailingUsers: 1,
    });
    expect(c.level).toBe("error");
    expect(c.detail).toContain("1 名");
    // 「次に何をすればよいか」が無いと運営者は動けない（原則2）。
    expect(c.nextAction).toContain("調べて");
  });

  it("運営者向けでも個人が特定できる値は文面に載せない", () => {
    const c = judgeRepeatedFailures({
      groups: [group("AIの利用残高が不足しています", 5, 2)],
      allFailingUsers: 2,
    });
    expect(c.detail).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
