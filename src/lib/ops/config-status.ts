import type { Check } from "./check";

/**
 * **デプロイ先が実際に使っている設定**を運営者向けに判定する（T-M8-147）。
 *
 * 既存の診断は「データとつながっている外部サービスの状態」を見ていたが、
 * **環境変数そのもの**は誰も見ていなかった。必須の値は起動時検証（`env-schema.ts`）が
 * 落とすので気付けるが、**既定値を持つ設定は欠けても起動する**。
 *
 * 2026-08-18、本番の `X_POSTING_MODE` が既定の `dry_run` のままで、
 * **Xへ1件も投稿されないのに全部の画面が正常に見える**状態だった。全テストは緑で、
 * `release:check` も `doctor` も緑だった（どちらも env を見ていない）。
 * 運営者が気付けたのは投稿されないことに手で気付いたときだけ。
 *
 * ここは**判定だけ**を行う純粋関数で、実際の値の読み出しは呼び出し側（route）が行う。
 * **秘密値は入力に取らない**（種別・有無だけを受け取る）。診断はHTTPでも返るため、
 * 鍵そのものが応答へ混ざる経路を作らない。
 */
export interface ConfigFacts {
  /** 動いている環境（`APP_ENV`）。 */
  appEnv: string;
  /** `X_POSTING_MODE`。`dry_run` は「Xへ送らず記録だけ」。 */
  postingMode: "dry_run" | "live";
  /** `APP_BASE_URL`。メールのリンクとX連携の戻り先に使われる。 */
  appBaseUrl: string | null;
  /** いま実際にこの応答を返しているURLのオリジン。`appBaseUrl` と一致すべき。 */
  actualOrigin: string | null;
  /** 決済鍵の種別。`live` は実課金、`test` は課金されない。 */
  stripeKeyKind: "live" | "test" | null;
  /**
   * エラー記録（Sentry）のDSNの種別（T-M8-162）。**値そのものは受け取らない**。
   *
   * - `usable`: http(s) のURLとして妥当＝`Sentry.init` が有効になる
   * - `placeholder`: `__TODO_…` のような未設定の目印が入っている
   * - `invalid`: 何か入っているがURLとして読めない
   * - `missing`: 未設定
   */
  sentryDsnKind: SentryDsnKind;
  /** ブラウザ側（`NEXT_PUBLIC_SENTRY_DSN`）の同じ判定。 */
  sentryPublicDsnKind: SentryDsnKind;
  /** DSNのホスト名（データの受け先＝リージョンの手がかり）。秘密ではない。 */
  sentryHost: string | null;
}

export type SentryDsnKind = "usable" | "placeholder" | "invalid" | "missing";

/**
 * DSNの文字列を**種別へ落とす**（T-M8-162）。判定は `initServerSentry` と同じ条件にする
 * （`src/lib/observability/sentry.ts` の `isUsableDsn`）——ここが緩いと
 * 「doctorは緑なのにSentryは無効」という食い違いができる。
 *
 * **戻り値に値そのものを含めない。** 診断はHTTPでも返るため、鍵が応答へ混ざる経路を作らない。
 */
export function classifySentryDsn(
  dsn: string | null | undefined,
): { kind: SentryDsnKind; host: string | null } {
  if (!dsn) return { kind: "missing", host: null };
  if (dsn.includes("__TODO") || dsn.includes("TODO_")) {
    return { kind: "placeholder", host: null };
  }
  try {
    const { protocol, host } = new URL(dsn);
    if (protocol !== "http:" && protocol !== "https:") {
      return { kind: "invalid", host: null };
    }
    return { kind: "usable", host };
  // eslint-disable-next-line no-restricted-syntax -- DSNがURLとして読めないこと自体が判定結果（invalid）。呼び出し側がdoctorへ出す
  } catch {
    return { kind: "invalid", host: null };
  }
}

/**
 * エラー記録が実際に有効か（T-M8-162）。
 *
 * **記録先が沈黙していても、それまでは誰も気付けなかった。** `initServerSentry` は不正・未設定のDSNを
 * no-op＋`console.warn` だけで黙って無効化するため、**本番のDSNがプレースホルダのままでも
 * 全画面が正常に見え、全テストが緑になる**（`X_POSTING_MODE` が既定のままだったT-M8-147と同じ型）。
 * proxyのprofile取得失敗（T-M8-159）・Stripe webhook・cronの例外はここへ送っているので、
 * 無効なら**それらの「記録する」という約束が成立しない**（原則1）。
 */
function sentryCheck(facts: ConfigFacts): Check {
  const isProd = facts.appEnv === "production";
  const name = "エラーの記録（Sentry）";
  const REASON: Record<SentryDsnKind, string> = {
    usable: "",
    placeholder: "設定欄に仮の値（__TODO…）が入ったままです",
    invalid: "設定された値がURLとして読めません",
    missing: "設定されていません",
  };

  const worst: SentryDsnKind =
    facts.sentryDsnKind !== "usable" ? facts.sentryDsnKind : facts.sentryPublicDsnKind;

  if (worst !== "usable") {
    const which =
      facts.sentryDsnKind !== "usable" ? "SENTRY_DSN" : "NEXT_PUBLIC_SENTRY_DSN";
    if (!isProd) {
      return {
        name,
        level: "ok",
        detail: `記録しません（${facts.appEnv}。${REASON[worst]}）`,
      };
    }
    return {
      name,
      level: "error",
      detail: `本番なのにエラーが1件も記録されません。${REASON[worst]}`,
      nextAction: `Sentryのプロジェクト設定からDSNを取得し、Vercel の環境変数 ${which} へ入れて本番を再デプロイしてください`,
    };
  }

  return {
    name,
    level: "ok",
    detail: facts.sentryHost
      ? `記録します（受け先: ${facts.sentryHost}）`
      : "記録します",
  };
}

/** production で live 以外＝実運用として成立しない組み合わせ。 */
function postingModeCheck(facts: ConfigFacts): Check {
  const isProd = facts.appEnv === "production";
  if (isProd && facts.postingMode !== "live") {
    return {
      name: "Xへの投稿",
      level: "error",
      detail:
        "「送信しない」設定（dry_run）のままです。投稿は作られますが、Xへは1件も送られません",
      nextAction:
        "Vercel の環境変数 X_POSTING_MODE を live にして、本番を再デプロイしてください",
    };
  }
  if (!isProd && facts.postingMode === "live") {
    return {
      name: "Xへの投稿",
      level: "error",
      detail: `本番以外（${facts.appEnv}）で実投稿の設定になっています`,
      nextAction: "X_POSTING_MODE を dry_run に戻してください",
    };
  }
  return {
    name: "Xへの投稿",
    level: "ok",
    detail: isProd
      ? "実際にXへ投稿します（live）"
      : `Xへは送らず記録だけします（dry_run・${facts.appEnv}）`,
  };
}

/**
 * `APP_BASE_URL` と実際の配信元の一致。
 *
 * ここがずれると**メールのリンクとX連携の戻り先が別のドメインを指す**。画面は普通に動くので、
 * 押した利用者だけが行き止まりになる（URLを叩く検査では見えない）。
 */
function baseUrlCheck(facts: ConfigFacts): Check {
  if (!facts.appBaseUrl) {
    return {
      name: "アプリのURL設定",
      level: "error",
      detail: "APP_BASE_URL が設定されていません",
      nextAction: "Vercel の環境変数へ公開URLを設定してください",
    };
  }
  if (!facts.actualOrigin) {
    return {
      name: "アプリのURL設定",
      level: "warn",
      detail: `設定は ${facts.appBaseUrl} ですが、実際の配信元を判定できませんでした`,
    };
  }
  /*
    末尾スラッシュと大文字小文字は無視する。**`localhost` と `127.0.0.1` も同一視する**——
    同じホストで、ローカル開発ではX OAuthの制約で `127.0.0.1` を、状態確認では `localhost` を
    使っているため、そのままでは開発環境で必ず赤くなる（常に赤い表示は読まれなくなる）。
    本番のドメインではこの読み替えは起こらない。
  */
  const norm = (v: string) =>
    v
      .replace(/\/+$/, "")
      .toLowerCase()
      .replace("//127.0.0.1", "//localhost");
  if (norm(facts.appBaseUrl) !== norm(facts.actualOrigin)) {
    return {
      name: "アプリのURL設定",
      level: "error",
      detail:
        `設定は ${facts.appBaseUrl} ですが、実際は ${facts.actualOrigin} で動いています。` +
        "メール内のリンクとX連携の戻り先が別のドメインを指します",
      nextAction: `APP_BASE_URL を ${facts.actualOrigin} に直して再デプロイしてください`,
    };
  }
  return {
    name: "アプリのURL設定",
    level: "ok",
    detail: `${facts.appBaseUrl}（実際の配信元と一致）`,
  };
}

/**
 * 決済鍵の種別。
 *
 * `env-schema.ts` は「本番以外に live キーを置く」方向だけを禁じている。**逆向き
 * （本番にテストキー）は起動する**ため、契約画面は動くのに1円も請求されない状態が起こりうる。
 */
function stripeKeyCheck(facts: ConfigFacts): Check {
  const isProd = facts.appEnv === "production";
  if (!facts.stripeKeyKind) {
    return {
      name: "決済（Stripe）の接続先",
      level: isProd ? "error" : "warn",
      detail: "決済の鍵が設定されていません",
      nextAction: isProd ? "Vercel の環境変数へ本番の決済キーを設定してください" : undefined,
    };
  }
  if (isProd && facts.stripeKeyKind === "test") {
    return {
      name: "決済（Stripe）の接続先",
      level: "error",
      detail:
        "本番がテスト用の決済に繋がっています。契約の操作はできますが、実際には請求されません",
      nextAction: "Vercel の環境変数 STRIPE_SECRET_KEY を本番キーに差し替えてください",
    };
  }
  return {
    name: "決済（Stripe）の接続先",
    level: "ok",
    detail:
      facts.stripeKeyKind === "live"
        ? "実際に請求される本番の決済に繋がっています"
        : `テスト用の決済に繋がっています（${facts.appEnv}・請求は発生しません）`,
  };
}

/** 設定の反映状況をまとめて判定する。 */
export function judgeConfig(facts: ConfigFacts): Check[] {
  return [postingModeCheck(facts), baseUrlCheck(facts), stripeKeyCheck(facts), sentryCheck(facts)];
}

/**
 * Gmail の同一視規則で正規化する（`a.b+x@gmail.com` と `ab@gmail.com` は同じ受信箱）。
 * gmail 以外はドットに意味があるため、小文字化と `+` 以降の除去だけにする。
 */
function normalizeAddress(address: string): string {
  const [rawLocal = "", domain = ""] = address.trim().toLowerCase().split("@");
  const local = rawLocal.split("+")[0] ?? "";
  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  return `${isGmail ? local.replaceAll(".", "") : local}@${domain}`;
}

export interface PendingConfirmationInput {
  /** 確認メールの送信元アドレス（`SMTP_USER`）。不明なら null。 */
  senderEmail: string | null;
  /** 直近に登録したがメール確認が終わっていない利用者のアドレス。 */
  unconfirmedEmails: string[];
}

/**
 * **メール確認が終わっていない登録**と、その中に「送信元と同じアドレス」が混ざっていないか。
 *
 * 2026-08-18、運営者が本番の動作確認で登録したところ、コード入力画面までは進むのに
 * メールが届かなかった。原因は**登録したアドレスが確認メールの送信元と同じGmailだった**こと。
 * Gmail は自分のSMTPで自分宛に送った控えを Message-ID で重複排除するため、
 * **受信トレイに入らず「送信済み」にだけ残る**。
 *
 * この経路はどこにも記録が出ない——Supabase は送信成功、SMTPエラーも無く、
 * アプリのログにも何も出ない。**利用者から見ると「届かない」だけ**なので、
 * 状態確認の画面で名指しする（原則1・2）。
 *
 * 未確認の登録そのものは正常に起こる（途中でやめた利用者）ので、件数だけなら ok に留める。
 * 常に黄色い表示にすると読まれなくなる。
 */
export function judgePendingConfirmations(input: PendingConfirmationInput): Check {
  const name = "メール確認が終わっていない登録";
  const count = input.unconfirmedEmails.length;
  if (count === 0) {
    return { name, level: "ok", detail: "ありません" };
  }
  const sender = input.senderEmail ? normalizeAddress(input.senderEmail) : null;
  const selfAddressed = sender
    ? input.unconfirmedEmails.filter((e) => normalizeAddress(e) === sender)
    : [];
  if (selfAddressed.length > 0) {
    return {
      name,
      level: "warn",
      detail:
        `${count} 件あります。うち ${selfAddressed.length} 件は確認メールの送信元と同じアドレスです。` +
        "Gmailは自分から自分へ送ったメールを受信トレイに入れないため、この登録では確認コードが届きません",
      nextAction:
        "Gmailの「送信済み」または「すべてのメール」で確認コードを見てください。動作確認は送信元とは別のアドレスで行ってください",
    };
  }
  return {
    name,
    level: "ok",
    detail: `${count} 件あります（登録の途中でやめた利用者。異常ではありません）`,
  };
}
