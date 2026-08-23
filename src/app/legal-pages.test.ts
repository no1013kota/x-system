import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CURRENT_AUTOMATION_CONSENT_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";
import { PROCESSORS } from "@/lib/legal-entity";

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
    expect(SEED).toContain(
      `export const AUTOMATION_CONSENT_VERSION = "${CURRENT_AUTOMATION_CONSENT_VERSION}"`,
    );
  });

  it("レビュー用アカウントのseedが現行の投稿パターンFKを使う", () => {
    expect(SEED).toContain("pattern_id");
    expect(SEED).not.toContain("::post_pattern");
    expect(SEED).not.toContain("(x_account_id, pattern,");
  });
});

describe("特定商取引法11条の表示項目が揃っている", () => {
  // 法11条＋消費者庁の運用（電話番号は請求時の遅滞ない開示で足りる）に対応する項目。
  const REQUIRED = [
    "屋号",
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

  it("屋号だけでなく氏名も表示している（個人事業者の法定表示）", () => {
    // 特商法11条「販売業者の氏名（名称）」は、個人事業者では**氏名**の表示が要る。
    // 屋号（Exos AI）へ置き換えてしまうと表示義務を満たさなくなるので、両方あることを固定する。
    expect(TOKUSHOHO, "屋号の行が消えている").toContain("LEGAL_ENTITY.tradeName");
    expect(TOKUSHOHO, "氏名（販売事業者）の行が消えている").toContain("LEGAL_ENTITY.name");
    const entity = read("src/lib/legal-entity.ts");
    expect(entity, "屋号と氏名は別々に持つ").toMatch(/tradeName:\s*"[^"]+"/);
    expect(entity).toMatch(/\n\s*name:\s*"[^"]+"/);
  });

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
    "利用資格", // 18歳以上・反社排除（T-M8-75）
    "18歳",
    "反社会的勢力",
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
    "知的財産権", // サービス自体のIPの帰属（T-M8-75）
    "損害の賠償", // 利用者の規約違反・第三者紛争の求償（T-M8-75）
    "権利義務の譲渡", // 譲渡禁止と事業譲渡時の承継（T-M8-75）
    "終了", // サービスの中断・変更・終了
    "本規約の変更",
    "免責",
    "専属的合意管轄", // 横浜地裁（T-M8-75）
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

  /**
   * **値そのものを検査する**（R33）。
   *
   * 以前は `legal-entity.ts` の**ファイル本文**に対する `toContain` だった。そのため
   * 委託先を1件足して `country` を書き忘れても、他8件の「米国」が本文に在るせいでテストは緑に
   * なった。**委託先の追加はまさにこの検査が想定している場面**なのに、そのときの抜けを
   * 検出できない。事業者名の検査も本文一致なので、`PROCESSORS` から外して別の定数へ移しても通った。
   * 法28条の情報提供に関わるため、値を直接見る。
   */
  it("委託先一覧に実装で使っている外部サービスが漏れていない", () => {
    // env/アダプタ/CSPから確認した送信先。増やしたらここへも足す（漏れると告知義務違反になる）。
    const providers = PROCESSORS.map((p) => p.provider);
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
      expect(
        providers.some((name) => name.includes(provider)),
        `${provider} が委託先一覧（PROCESSORS）に無い`,
      ).toBe(true);
    }
  });

  it("すべての委託先が移転先の国名を持つ（法28条の情報提供）", () => {
    // 1件でも空だと、その委託先だけ移転先が示されないまま公開される。
    const missing = PROCESSORS.filter((p) => !p.country.trim()).map((p) => p.provider);
    expect(missing, "移転先の国名が空の委託先").toEqual([]);
  });

  it("委託先の各項目が埋まっている（表に空欄を出さない）", () => {
    for (const processor of PROCESSORS) {
      for (const field of ["provider", "service", "use", "data"] as const) {
        expect(
          processor[field].trim().length,
          `${processor.provider || "(名称なし)"} の ${field} が空`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * 利用枠は契約期間ごと（T-M8-258）。法務ページがアプリの数え方と食い違うと、
 * 「月間」と書いてあるのに更新日でリセットされる説明になる（T-M8-259）。
 */
describe("利用枠の数え方が「契約期間ごと」で統一されている（T-M8-259）", () => {
  it("利用規約・特商法に「月間利用枠」が残っていない", () => {
    for (const [name, src] of [["利用規約", TERMS], ["特商法", TOKUSHOHO]] as const) {
      expect(src, `${name}に「月間」の利用枠表記が残っている`).not.toMatch(/月間(の)?利用枠/);
      expect(src, `${name}が契約期間ごとの利用枠を説明していない`).toContain("契約期間");
      expect(src, `${name}が繰り越しの扱いを説明していない`).toContain("繰り越");
    }
  });

  it("改定は同意versionを上げずに見出しへ残す（利用者に不利益のない変更・要決定D-35 案A）", () => {
    // 版を上げると全利用者に再同意を要求する（legal.ts）。不利益のない改定は版を据え置き、
    // 改定した事実だけを updatedLabel で示す。
    expect(TERMS).toContain("updatedLabel=");
    expect(TERMS).toMatch(/updatedLabel="[^"]*契約期間[^"]*"/);
  });
});
