import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { APP_NAME } from "@/lib/app-config";
import { requireCurrentUser } from "@/lib/auth/session";
import { requiredLegalConsents } from "@/lib/auth/legal-consent";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { LegalConsentForm } from "./legal-consent-form";
import { cardClassName } from "@/components/ui/card";

export const metadata: Metadata = {
  title: `更新内容の確認 | ${APP_NAME}`,
};

export default async function LegalConsentPage() {
  const user = await requireCurrentUser();
  const admin = createSupabaseAdminClient();
  const result = await admin
    .from("profiles")
    .select(
      "terms_version, terms_accepted_at, privacy_version, privacy_acknowledged_at",
    )
    .eq("id", user.id)
    .single();
  if (result.error || !result.data) throw new Error("Legal profile could not be loaded.");
  const required = requiredLegalConsents(result.data);
  if (!required.terms && !required.privacy) redirect("/app");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <section className={`${cardClassName} p-6 sm:p-8`}>
        <h1 className="text-2xl font-bold">更新内容をご確認ください</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          重要な変更があるため、生成・投稿・自動実行を続ける前に更新内容への同意が必要です。これまでの下書きや投稿履歴は引き続き閲覧できます。
        </p>
        <div className="mt-7">
          <LegalConsentForm
            requirePrivacy={required.privacy}
            requireTerms={required.terms}
          />
        </div>
      </section>
    </main>
  );
}
