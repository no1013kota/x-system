import "server-only";

import { AppError } from "@/lib/observability/errors";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";
import { pooledQueryable } from "@/lib/db/pool";

import { LEGAL_CONSENT_SELECT_POOLED, requiredLegalConsents } from "./legal-consent";

/** 再同意が必要なときの誘導先（同意画面）。 */
export const LEGAL_CONSENT_PATH = "/app/consent";

/**
 * 生成・投稿・自動実行の前に、現行版の利用規約・プライバシーポリシーへの同意を確認する（T-M8-73）。
 *
 * **利用規約が「効力発生後に生成・投稿・自動実行を行う前に、変更後の内容への同意を改めて
 * お願いします」と約束しているため、この確認が動いていないと規約の記載が虚偽になる。**
 * `requireExecutionAccess`（契約状態＋法務同意の複合ガード）は以前から実装されていたが、
 * どこからも呼ばれておらず、`/app/consent` への導線も無かった（要件06 §1.3が未実装だった）。
 *
 * 契約状態の判定は `execution-prereqs` 側が「何が足りないか」を列挙する形で既に行っているため、
 * ここでは**法務同意だけ**を見る（同じ条件で別のエラーを返して表示が二重になるのを避ける）。
 * 法務同意の判定式は `requiredLegalConsents` を共有し、同意画面と食い違わないようにする。
 */
export async function requireLegalConsent(userId: string): Promise<void> {
  // Supabase adminクライアントではなくpooled接続を使う（T-M8-73）。admin clientは
  // import時に `@/lib/env` の検証を走らせるため、この helper を読むだけで環境変数が要る
  // モジュールグラフになり、環境変数を渡さない単体テストが落ちる（実際に落ちた）。
  const { rows } = await pooledQueryable().query<{
    privacy_acknowledged_at: string | null;
    privacy_version: string | null;
    terms_accepted_at: string | null;
    terms_version: string | null;
  }>(
    `select ${LEGAL_CONSENT_SELECT_POOLED} from profiles where id = $1`,
    [userId],
  );
  const data = rows[0];
  // プロフィールが読めない場合は素通しにする（ここで新種のエラーを作ると、
  // 本来の前提不足の説明が出なくなる。プロフィール不在は他のガードが扱う）。
  if (!data) return;

  const required = requiredLegalConsents(data);
  if (!required.terms && !required.privacy) return;

  const missing: string[] = [];
  if (required.terms) missing.push("terms_consent");
  if (required.privacy) missing.push("privacy_acknowledgement");
  throw new AppError("legal_consent_required", {
    details: {
      currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
      currentTermsVersion: CURRENT_TERMS_VERSION,
      missing,
      settingsPath: LEGAL_CONSENT_PATH,
    },
  });
}
