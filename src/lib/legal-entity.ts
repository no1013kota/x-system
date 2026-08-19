/**
 * 事業者情報と外部委託先の**単一の正本**（T-M8-72）。
 *
 * 以前は特定商取引法ページに事業者情報がハードコードされ、問い合わせ先だけが
 * 「法務ページは `matsubuz.10@gmail.com` を直書き・アプリは `env.SUPPORT_EMAIL`」の二重管理に
 * なっていた。片方を直すともう片方が古くなる（法務文書としては致命的）ので、ここへ集約する。
 *
 * **法務文書に出る値なので、変更したら3ページすべての表示を確認する**
 * （`legal-pages.test.ts` が必須項目の存在を機械検査する）。
 */

/** 販売事業者・個人情報の取扱事業者。特定商取引法11条とプライバシーポリシーの両方で使う。 */
export const LEGAL_ENTITY = {
  /**
   * 屋号（T-M8-81）。サービス名（`APP_NAME`）と同じ文字列だが**別の項目**なので分けて持つ。
   * サービス名を変えても屋号は変わらない（逆も同じ）。
   *
   * **屋号だけを表示してはいけない。** 特定商取引法11条の「販売業者の氏名（名称）」は、
   * 個人事業者の場合は**氏名の表示が必要**で、屋号のみでは足りない。表示は必ず `name` と併記する。
   */
  tradeName: "Exos AI",
  /** 販売事業者名（個人事業主のため氏名）。屋号だけに置き換えないこと（上の注記）。 */
  name: "松本洸太",
  /** 運営責任者。 */
  representative: "松本洸太",
  /** 所在地。特定商取引法上、表示が必要。 */
  address: "神奈川県川崎市川崎区池田1-8-10-101",
  /**
   * 問い合わせ窓口。**アプリ内の問い合わせ導線もこの値を使う**
   * （`SUPPORT_EMAIL` が未設定でも法務上の窓口が消えないように、こちらを既定とする）。
   */
  email: "matsubuz.10@gmail.com",
  /**
   * 電話番号。消費者庁の運用では「請求があった場合に遅滞なく開示する」旨の表示で足りる
   * （通信販売の広告表示。氏名・住所は省略できない）。
   */
  phoneDisclosure: "請求があった場合には遅滞なく開示します",
} as const;

/** 委託先の分類。プライバシーポリシーの表で用途を示す。 */
export type ProcessorPurpose =
  | "infrastructure"
  | "payment"
  | "ai"
  | "posting"
  | "security"
  | "email";

export interface Processor {
  /** 事業者の正式名称。 */
  provider: string;
  /** 所在国（事業者の所在。データの物理的所在は各社の公表情報による）。 */
  country: string;
  /** サービス名。 */
  service: string;
  purpose: ProcessorPurpose;
  /** 何のために使うか（利用者向けの説明）。 */
  use: string;
  /** 提供・送信される情報。**実装で確認できた範囲だけを書く**。 */
  data: string;
}

/**
 * 外部委託先の一覧。**実装（環境変数・アダプタ・CSP）から確認できたものだけ**を載せている。
 *
 * 個人情報保護法27条5項1号の委託に当たるが、いずれも外国にある第三者のため28条の対象になる。
 * 移転先の国・事業者名をここで示し、当該国の制度と移転先の措置についてはプライバシーポリシー本文で
 * 各社の公表情報を参照する形にしている（実装からデータの物理的所在を確定できないため、
 * 「米国等の国外で取り扱われる場合がある」以上の断定はしない）。
 */
export const PROCESSORS: readonly Processor[] = [
  {
    provider: "Vercel Inc.",
    country: "米国",
    service: "Vercel",
    purpose: "infrastructure",
    use: "本サービスのホスティングと配信",
    data: "アクセス時の通信情報（IPアドレス、ブラウザの種類、リクエスト内容）",
  },
  {
    provider: "Supabase Inc.",
    country: "米国",
    service: "Supabase",
    purpose: "infrastructure",
    use: "データベース・会員認証・生成画像の保管",
    data: "メールアドレス、認証情報、設定内容、発信定義書、下書き・投稿履歴、生成画像、暗号化したAPIキー・連携トークン",
  },
  {
    provider: "Stripe, Inc.",
    country: "米国",
    service: "Stripe",
    purpose: "payment",
    use: "クレジットカード決済とプラン管理",
    data: "メールアドレス、契約プラン・課金状態（カード番号等の決済情報は当社を経由せず、Stripeが直接取得・管理します）",
  },
  {
    provider: "Anthropic PBC",
    country: "米国",
    service: "Claude API",
    purpose: "ai",
    use: "文章の生成、学習内容の分析、改善提案の作成、ニュースの要約",
    data: "発信定義書、投稿の下書きと入力内容、学習対象として指定された投稿、ニュースの検索クエリ",
  },
  {
    provider: "OpenAI, L.L.C.",
    country: "米国",
    service: "OpenAI API",
    purpose: "ai",
    use: "文章と画像の生成",
    data: "発信定義書、投稿の下書きと入力内容、学習対象として指定された投稿、画像生成用の指示文",
  },
  {
    provider: "Google LLC",
    country: "米国",
    service: "Gemini API / Gmail",
    purpose: "ai",
    use: "文章と画像の生成、通知メールの送信",
    data: "発信定義書、投稿の下書きと入力内容、学習対象として指定された投稿、画像生成用の指示文、通知メールの宛先と本文",
  },
  {
    provider: "X Corp.",
    country: "米国",
    service: "X API",
    purpose: "posting",
    use: "Xへの投稿、連携アカウント情報と投稿実績の取得",
    data: "投稿本文、添付画像、連携アカウントの識別情報",
  },
  {
    provider: "Cloudflare, Inc.",
    country: "米国",
    service: "Cloudflare Turnstile",
    purpose: "security",
    use: "ログイン・会員登録時の自動プログラム対策（人間確認）",
    data: "IPアドレス、ブラウザの種類などの接続情報",
  },
  {
    provider: "Functional Software, Inc. (Sentry)",
    country: "米国",
    service: "Sentry",
    purpose: "security",
    use: "不具合の検知と原因調査",
    data: "エラー発生時の技術情報（APIキー・トークン・プロンプト・投稿前の入力内容は送信前にマスクします）",
  },
] as const;

/**
 * ブラウザから外部へ直接通信が発生するもの（電気通信事業法の外部送信に関する説明用）。
 * CSPの許可先（`script-src` / `connect-src` / `frame-src` / `img-src`）が根拠。
 */
export const BROWSER_TRANSMISSIONS: readonly { to: string; when: string; data: string }[] = [
  {
    to: "Stripe, Inc.（決済・契約管理）",
    when: "決済画面または契約管理画面を開くボタンを押したとき",
    data: "IPアドレス、ブラウザの種類などの接続情報",
  },
  {
    to: "Cloudflare, Inc.（人間確認）",
    when: "ログイン・会員登録・パスワード再設定の画面を表示したとき",
    data: "IPアドレス、ブラウザの種類などの接続情報",
  },
  {
    to: "Functional Software, Inc.（Sentry・不具合検知）",
    when: "画面で不具合が発生したとき",
    data: "エラーの技術情報（秘密情報と投稿前の入力内容はマスク済み）",
  },
  {
    to: "X Corp.",
    when: "連携済みXアカウントのプロフィール画像を表示したとき",
    data: "IPアドレス、ブラウザの種類などの接続情報",
  },
];

/** Cookieの一覧（名前・用途・保存期間）。実装で確認できたものだけ。 */
export const COOKIES: readonly { name: string; use: string; lifetime: string }[] = [
  {
    name: "会員認証用のCookie（Supabase Authが発行）",
    use: "ログイン状態の保持",
    lifetime: "ログアウトまで（アクセストークンは1時間ごとに更新）",
  },
  {
    name: "exos-ai-recovery",
    use: "パスワード再設定の手続き中であることの保持",
    lifetime: "15分",
  },
  {
    name: "x_oauth_tx",
    use: "Xアカウント連携の手続き中の改ざん防止",
    lifetime: "10分",
  },
  {
    name: "billing_return_tx",
    use: "決済画面から戻ったことの判定",
    lifetime: "30分",
  },
];
