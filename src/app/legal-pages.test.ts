import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/legal";

/**
 * 法務3ページが**本番運用に必要な項目を落とさない**ことを機械で守る（T-M8-72）。
 *
 * 法務文書は一度書いたら読み返されないため、リファクタや文言整理のついでに法定事項が
 * 消えても誰も気付かない。特定商取引法11条の表示項目・個人情報保護法上の記載事項・
 * 消費者向けに必要な条項の見出しが**存在すること**を検査する（内容の妥当性は検査できないので、
 * 「項目が消えていないこと」に絞る）。
 *
 * また、`-draft` の内部値や「暫定版」の開発中表示が本番へ出ないことも止める。
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const TERMS = read("src/app/terms/page.tsx");
const PRIVACY = read("src/app/privacy/page.tsx");
const TOKUSHOHO = read("src/app/legal/commercial-transactions/page.tsx");
const ENTITY = read("src/lib/legal-entity.ts");
const SEED = read("scripts/seed-review-account.mjs");

describe("法務3ページに開発中の表示が残っていない", () => {
  it("「暫定版」「法務確認を行います」等が無い", () => {
    for (const [name, source] of [
      ["terms", TERMS],
      ["privacy", PRIVACY],
      ["特商法", TOKUSHOHO],
    ] as const) {
      expect(source, `${name}: 開発中の断り書きが残っている`).not.toContain("暫定版");
      expect(source, `${name}: 開発中の断り書きが残っている`).not.toContain("開発中");
      expect(source, `${name}: 開発中の断り書きが残っている`).not.toContain("法務確認");
    }
  });

  it("同意versionに内部向けの接尾辞が付いていない（利用者に露出する）", () => {
    expect(CURRENT_TERMS_VERSION).not.toContain("draft");
    expect(CURRENT_PRIVACY_VERSION).not.toContain("draft");
    // `consentVersionLabel` が日付表記へ変換できる形式であること。
    expect(CURRENT_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CURRENT_PRIVACY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("レビュー用アカウントのseedが現行versionを書き込む（古いと再同意ガードで弾かれる）", () => {
    expect(SEED).toContain(`export const LEGAL_VERSION = "${CURRENT_TERMS_VERSION}"`);
  });
});

describe("特定商取引法11条の表示項目が揃っている", () => {
  // 法11条＋消費者庁の運用（電話番号は請求時の遅滞ない開示で足りる）に対応する項目。
  const REQUIRED = [
    "販売事業者",
    "運営責任者",
    "所在地",
    "お問い合わせ先",
    "電話番号",
    "販売価格",
    "商品代金以外に必要な費用", // 法11条「その他負担すべき金銭」＝BYOKのAPI費用
    "支払方法",
    "支払時期",
    "サービスの提供時期",
    "自動更新",
    "販売条件", // 数量の制限（Xアカウント数・月間利用枠）
    "お申し込みの有効期限",
    "解約の方法",
    "返品", // 返品特約
    "動作環境",
  ];

  for (const term of REQUIRED) {
    it(`「${term}」の項目がある`, () => {
      expect(TOKUSHOHO).toContain(term);
    });
  }

  it("事業者情報は単一の正本（legal-entity.ts）から描画している", () => {
    expect(TOKUSHOHO).toContain("LEGAL_ENTITY");
    // 氏名・住所・連絡先をページへ直書きしていない（2箇所で管理すると片方が古くなる）。
    expect(TOKUSHOHO).not.toContain("神奈川県");
    expect(TOKUSHOHO).not.toContain("@gmail.com");
  });

  it("金額・上限はPLANSから描画している（数字を書き写さない）", () => {
    expect(TOKUSHOHO).toContain("PLANS");
    expect(TOKUSHOHO).not.toMatch(/2,?980円/);
  });
});

describe("利用規約に消費者向けの必須条項がある", () => {
  const REQUIRED = [
    "アカウント登録",
    "費用のご負担", // BYOKの別途課金
    "無料トライアル",
    "自動更新",
    "解約",
    "返金",
    "退会", // 削除の依頼方法（セルフ削除が無いことの説明）
    "投稿の責任", // 生成物とXへの投稿の責任の所在
    "自動投稿",
    "学習ソース", // 第三者の投稿を扱うことの責任
    "禁止事項",
    "終了", // サービスの中断・変更・終了
    "本規約の変更",
    "免責",
    "管轄",
  ];
  for (const term of REQUIRED) {
    it(`「${term}」に触れている`, () => {
      expect(TERMS).toContain(term);
    });
  }

  it("免責は消費者契約法により無効となる全部免責にしていない", () => {
    // 「いかなる場合も責任を負わない」型の条項を置かない。上限つきの責任制限にする。
    expect(TERMS).not.toContain("いかなる場合も一切の責任を負いません");
    expect(TERMS).toContain("消費者契約法");
  });
});

describe("プライバシーポリシーに個人情報保護法上の記載事項がある", () => {
  const REQUIRED = [
    "事業者の情報", // 取扱事業者の氏名・住所・責任者
    "取得する情報",
    "利用目的",
    "第三者への提供",
    "業務の委託", // 委託先の一覧
    "外国にある第三者への提供", // 法28条
    "Cookie",
    "外部送信", // 電気通信事業法の外部送信に関する説明
    "保存期間",
    "安全管理",
    "開示・訂正・削除", // 法33条以下の請求
    "苦情の申出先",
    "本ポリシーの変更",
  ];
  for (const term of REQUIRED) {
    it(`「${term}」に触れている`, () => {
      expect(PRIVACY).toContain(term);
    });
  }

  it("委託先・Cookie・外部送信は単一の正本から描画している", () => {
    for (const symbol of ["PROCESSORS", "COOKIES", "BROWSER_TRANSMISSIONS", "LEGAL_ENTITY"]) {
      expect(PRIVACY, `${symbol} を使っていない`).toContain(symbol);
    }
  });

  it("委託先一覧に実装で使っている外部サービスが漏れていない", () => {
    // env/アダプタ/CSPから確認した送信先。増やしたらここへも足す（漏れると告知義務違反になる）。
    for (const provider of [
      "Vercel",
      "Supabase",
      "Stripe",
      "Anthropic",
      "OpenAI",
      "Google",
      "X Corp",
      "Cloudflare",
      "Sentry",
    ]) {
      expect(ENTITY, `${provider} が委託先一覧に無い`).toContain(provider);
    }
  });

  it("移転先の国名を示している（法28条の情報提供）", () => {
    expect(ENTITY).toContain("米国");
  });
});
