/**
 * 外向き副作用チャネルの一覧（T-M7-28）。**この一覧がテストの正本**。
 *
 * 2026-07-27、X投稿は `X_POSTING_MODE` で守られていたのに SMTP は素通りで、動作確認の
 * `scheduler_tick` が実際に98通を送信した（T-M7-23）。個別にガードを足すだけでは
 * **次に増えたチャネル**を守れない。そこで「どのファイルが外へ出るか」を一覧として持ち、
 * 一覧に無いファイルが外向き呼び出しを持ったらテストを落とす（`outbound-channels.test.ts`）。
 *
 * 新しく外部へ出る処理を書いたら、ここへ追記してガードを書く。**追記せずに済ませられない**のが目的。
 */

export interface OutboundChannel {
  /** 内部ID。 */
  id: string;
  /** 何が外へ出るか（日本語）。 */
  label: string;
  /** 非productionで実害が出ないようにしている仕組み。 */
  guard: string;
  /**
   * このチャネルの外向き呼び出しを含むファイル（`src/` からの相対パス）。
   * ここに挙げたファイルだけが外向き呼び出しを持てる。
   */
  files: readonly string[];
}

/**
 * 外向き呼び出しの目印。これを含むファイルは、必ずどれかのチャネルへ登録されていなければならない。
 *
 * `fetch(` は最も広く、HTTPで外へ出る全経路を捕まえる（AI provider・X API・Turnstile・Stripe）。
 */
export const OUTBOUND_MARKERS: readonly { id: string; pattern: RegExp }[] = [
  { id: "http", pattern: /(?<![.\w])fetch\s*\(/ },
  { id: "smtp", pattern: /createTransport|nodemailer/ },
  { id: "storage_remove", pattern: /\.storage\b[\s\S]{0,80}?\.remove\s*\(/ },
  { id: "ai_sdk", pattern: /from "@anthropic-ai\/sdk"|from "openai"|from "@google\/genai"/ },
  { id: "stripe_sdk", pattern: /from "stripe"|new Stripe\(/ },
];

/** 検査から外すファイル（この一覧そのもの。目印の正規表現を含むため自己一致する）。 */
export const OUTBOUND_SCAN_EXCLUDED = ["lib/ops/outbound-channels.ts"] as const;

export const OUTBOUND_CHANNELS: readonly OutboundChannel[] = [
  {
    id: "x_api",
    label: "X（Twitter）への投稿・削除・メディアアップロード・読み取り・OAuth",
    guard:
      "`X_POSTING_MODE=dry_run`（既定）では投稿・削除・media uploadのHTTPを一切呼ばず擬似結果を返す。" +
      "`live` は production 以外では起動時のenv検証で弾かれる（要件01 §3.1）。読み取り・OAuthは" +
      "利用者が連携したアカウントの範囲に限られる。",
    files: [
      "lib/x/client-server.ts",
      "lib/x/token-refresh-server.ts",
      "lib/x/account-actions-server.ts",
      "app/api/x/oauth/callback/route.ts",
    ],
  },
  {
    id: "smtp",
    label: "運営者への状態メールの送信（利用者向け通知メールはT-M8-222で廃止）",
    guard:
      "`canSendViaSmtp` が production 以外ではループバック宛（localhost/127.0.0.1）以外を拒否し、" +
      "transport を作らない。2026-07-27に98通の誤送信を起こした経路（T-M7-23）。",
    files: ["lib/email/operator-mail-server.ts"],
  },
  {
    id: "ai_provider",
    label: "AI provider（Anthropic / OpenAI / Google）への生成・検索・キー検証",
    guard:
      "副作用は無く費用のみ発生する。自動実行は要決定D-10（差分が ai/jobs/prompts に触れたときだけ・" +
      "1周上限$0.50）で抑え、テストでは provider を注入して実HTTPを出さない。",
    files: [
      "lib/ai/anthropic-client.ts",
      "lib/ai/openai-client.ts",
      "lib/ai/gemini-client.ts",
      "lib/ai/image-client.ts",
      "lib/api-key-verifiers-server.ts",
    ],
  },
  {
    id: "stripe",
    label: "Stripe（Checkout・Customer Portal・購読同期・webhook検証）",
    guard:
      "production 以外では `sk_live_` を**起動時のenv検証で弾く**（T-M7-51。文章の方針だけでは" +
      "貼れてしまい、実際に課金される状態だった）。webhookは署名検証が必須で、" +
      "非productionのキーでは本番イベントを受け付けられない。",
    files: [
      "lib/stripe/client.ts",
      "lib/stripe/checkout.ts",
      "lib/stripe/portal.ts",
      "lib/stripe/resume.ts",
      "lib/stripe/resume-browser.ts",
      "lib/stripe/subscription-sync.ts",
      "lib/stripe/billing-return.ts",
      "lib/stripe/billing-redirect.ts",
      "lib/stripe/webhook.ts",
      // 契約期間の補完（Stripe を読むだけ・T-M8-258）と、プラン変更後の日割り差額の下見
      // （読むだけ・T-M8-270）。予約の取り消し（scheduled-plan-change.ts）は gateway 注入で
      // Stripe SDK を直接呼ばないため一覧の検出対象外。
      "lib/stripe/period-backfill.ts",
      "lib/stripe/proration-preview.ts",
      // トライアル中の下位変更を即時へ畳む（T-M8-299）。gateway注入で呼ぶので直接の送信は
      // しないが、型を SDK から取るため検出される。Stripe の面の一部として登録しておく。
      "lib/stripe/trial-plan-change.ts",
    ],
  },
  {
    id: "storage_delete",
    label: "Supabase Storage の画像削除",
    guard:
      "接続先bucketは環境変数で環境ごとに分離される。削除は「現行draftから参照されていないobject」" +
      "または自分が今作ったobjectに限定し、参照確認を通らないpathは消さない。",
    files: [
      // schedule-cleanup.ts は削除関数を注入されるだけで自分では呼ばない（純粋に保つ設計）。
      "lib/jobs/image-generation-server.ts",
      "app/actions/drafts.ts",
      "app/api/cron/scheduler-tick/route.ts",
    ],
  },
  {
    id: "api_key_deletion",
    label: "利用者APIキーの失効要求（provider側の削除）",
    guard: "利用者が自分で登録したキーに対する操作のみ。環境をまたいで他者のキーへ触れる経路は無い。",
    files: ["lib/api-key-deletion-server.ts"],
  },
  {
    id: "source_url_check",
    label: "出典URLの検証（SSRF対策のためのHTTPアクセス）",
    guard:
      "https・public network・redirect先を検証する読み取り専用のアクセス。private IPやloopbackへは" +
      "到達させない（プロンプト設計書 §7-8）。外部状態を変えない。",
    files: ["lib/post/source-url-server.ts"],
  },
  {
    id: "captcha_status",
    label: "人間確認が有効かの確認（自分のSupabaseプロジェクトへの読み取り試行）",
    guard:
      "存在しない資格情報（`@example.invalid`）でログインを試すだけで、**副作用が無い**" +
      "（アカウントを作らない・メールを送らない・実在ユーザーに触れない）。宛先は自分の" +
      "Supabaseプロジェクトに固定される（T-M7-53）。",
    files: ["lib/ops/captcha-status.ts"],
  },
  {
    id: "self_worker",
    label: "自分のアプリのworker route呼び出し（jobのdispatch）",
    guard:
      "外部サービスではなく `APP_BASE_URL` 配下の自分自身を叩く。CRON_SECRET相当の内部認証を通し、" +
      "宛先は自アプリに固定される。",
    files: ["lib/jobs/dispatch.ts"],
  },
];

/** 一覧に登録済みのファイル（`src/` 相対）。 */
export function registeredOutboundFiles(): Set<string> {
  return new Set(OUTBOUND_CHANNELS.flatMap((c) => c.files));
}
