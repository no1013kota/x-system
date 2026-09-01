import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { APP_NAME } from "@/lib/app-config";
import { AppLockedNotice, AppLockedPage } from "@/components/app-shell/plan-required";
import { appLockFor } from "@/lib/auth/subscription-access";
import { getCurrentUser } from "@/lib/auth/session";
import { yen } from "@/lib/format";
import { serverNowMs } from "@/lib/time/server-now";
import { EmptyState } from "@/components/app-shell/page-state";
import { TabNav } from "@/components/app-shell/tab-nav";
import { XOAuthErrorNotice } from "@/components/app-shell/x-oauth-error-notice";
import { PortalButton } from "@/components/billing/portal-button";
import { ResumePlanButton } from "@/components/billing/resume-plan-button";
import type { AiKeyProvider } from "@/lib/api-keys";
import type { ApiKeyViewState } from "@/lib/api-key-view";
import { listApiKeyViewsForUser } from "@/lib/api-key-view-server";
import { operatorImageProviders } from "@/lib/ai-purpose-config-server";
import type { LearningSourceView } from "@/lib/learning-sources";
import { listLearningSourcesForUser } from "@/lib/learning-sources-server";
import {
  DEFAULT_TONE_SETTINGS,
  baseMdSettingsDiffer,
  extractBaseMdSection,
  personaSettingsSchema,
  type PersonaSettings,
} from "@/lib/persona-settings";
import { isOperatorManagedPlan, PLANS, type PlanId } from "@/lib/plans";
import { getSettingsForUser } from "@/lib/settings-server";
import { pooledQueryable } from "@/lib/db/pool";
import type { UserSettings } from "@/lib/settings";
import { UsageSummaryCard } from "@/components/app-shell/usage-summary-card";
import { usageResetLabel, type UsageSummary } from "@/lib/usage/usage-summary";
import { loadRequestProfile } from "@/lib/profile/request-profile-server";
import { usageSummaryFrom } from "@/lib/usage/usage-summary";
import { readSingleRow } from "@/lib/supabase/single-row";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  listXAccounts,
  type XAccountListItem,
} from "@/lib/x/account-actions-server";

import { AiPurposeSettings } from "./ai-purpose-settings";
import { ApiKeySettings } from "./api-key-settings";
import { LearningSourcesManager } from "./learning-sources-manager";
import { PersonaSettingsForm } from "./persona-settings-form";
import { SettingsPreferences } from "./settings-preferences";
import {
  SETTINGS_TABS,
  normalizeSettingsTab,
} from "./tabs";
import { XAccountsSettings } from "./x-accounts-settings";
import { Card, CardTitle, cardClassName, pageTitleClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { planChangeEffects } from "@/lib/billing/plan-change-effects";
import { cancellationEffects } from "@/lib/billing/cancellation-reasons";
import { discountLabel } from "@/lib/billing/discount-label";
import { scheduledPlanChangeLabel, scheduledPlanChangeNote } from "@/lib/billing/scheduled-plan-change";
import { stripe } from "@/lib/stripe/client";
import {
  loadPendingProration,
  loadRecentProrationCharge,
  prorationChargedNotice,
  prorationNotice,
} from "@/lib/stripe/proration-preview";
import { xRedirectUri } from "@/lib/x/oauth-server";

/**
 * 設定（T-M8-104で旧「設定」と旧「AI設定」を統合）。タブ構成:
 * 設定（Xアカウント＋APIキー＋通知）／課金・プラン／アカウント設定（＋参考ソース）／
 * AIモデル設定／プロンプト（アカウント.md・投稿作成・画像生成）。
 * 問い合わせタブは廃止（2026-08-15 運営者の指示）。旧slugは tabs.ts のエイリアスが受ける。
 */

const pooledDb = pooledQueryable();

export const metadata: Metadata = {
  title: `設定 | ${APP_NAME}`,
};

const EMPTY_SETTINGS: PersonaSettings = {
  ng: { rules: [], topics: [], words: [] },
  persona: { audience: "", speaker: "", value: "" },
  themes: { free_text: "", primary: [], secondary: [] },
  tone: { ...DEFAULT_TONE_SETTINGS },
  volume: { free_text: "" },
};

interface SettingsPageProps {
  searchParams: Promise<{
    portal?: string;
    sec?: string;
    tab?: string;
    x_connected?: string;
    x_oauth_error?: string;
    x_oauth_reason?: string;
  }>;
}


interface AccountRow {
  base_md: string;
  base_md_version: number;
  handle: string;
  id: string;
  settings: unknown;
  /** 参考ソースから作った保存前の提案（T-M8-349）。無ければ null。 */
  settings_proposal: unknown;
}

const STATUS_LABELS: Record<string, string> = {
  incomplete: "お申し込み未完了",
  incomplete_expired: "お申し込み期限切れ",
  trialing: "無料トライアル中",
  active: "有効",
  past_due: "お支払い確認中",
  unpaid: "お支払い停止",
  paused: "一時停止",
  canceled: "解約済み",
};

function formatPeriodEnd(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

/** アカウント設定・プロンプトタブの共通前提: 操作対象のXアカウント。無ければ連携導線を出す。 */
function NoAccountState() {
  return (
    <EmptyState
      actionHref="/app/settings?tab=general"
      actionLabel="Xアカウント設定へ"
      description="アカウント設定は連携済みのXアカウントごとに保存されます。"
      title="Xアカウントを選択してください"
    />
  );
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login?next=/app/settings");

  const tab = normalizeSettingsTab(params.tab);
  const admin = createSupabaseAdminClient();
  // profile取得と、planに依存しないタブ別データは1波にまとめる（T-M8-67。以前は最大4段直列）。
  /*
    **profiles は1リクエストにつき1回だけ読む**（T-M8-286→T-M8-361）。以前はここで
    PostgREST経由の別クエリを投げていたが、App Shell がすでに同じ行をpooled接続で読んでいる。
    往復が1つ丸ごと無駄で、**実測でいちばん遅い画面**がこの設定タブだった。
  */
  const [profile, xAccounts, userSettings] = await Promise.all([
    loadRequestProfile(user.id),
    tab === "general" ? listXAccounts(user.id) : Promise.resolve([] as XAccountListItem[]),
    tab === "general"
      ? getSettingsForUser(user.id)
      : Promise.resolve(null as UserSettings | null),
  ]);
  // 行が無い（profile未作成）と取得の失敗は `loadRequestProfile` が区別する（失敗はthrow）。
  if (!profile) {
    throw new Error("Billing profile could not be loaded.");
  }
  // 課金・プラン以外のタブを開けるか（T-M8-269→T-M8-273）。同じ profile から判定し、追加のDB往復を作らない。
  const lock = appLockFor(profile.subscription_status);
  /*
    未契約(null)は route-guard により billing タブ以外へ来ない。以前は `?? "standard"` で
    最も権限の狭いプランへ倒していたが、新standardは編集権限を持つ（T-M8-168）ため
    null のまま扱い、各判定関数（promptEditablePlan / isOperatorManagedPlan）が false を返す。
  */
  const plan: PlanId | null = profile.plan;
  /*
    **プラン未登録なら設定画面ごとロックする**（T-M8-295・運営者の指示 2026-08-25）。
    以前はタブを出したまま中身だけを差し替えていたが、一度も契約していない人にとっては
    設定画面のどこにも触れるものが無く、タブだけが並ぶ意味の無い画面になっていた。

    **解約済み・支払い滞りはここへ入れない**。課金・プランのタブに「プランを再開」（T-M8-264）と
    お支払い情報の更新（T-M8-273）があり、ここを塞ぐと**戻る手段ごと消える**。
    未登録（`plan` が無い＝一度も契約していない）だけを対象にする。
  */
  if (lock && !plan) {
    return (
      <AppLockedPage
        description="Xアカウントの連携やAIの設定がご利用いただけます。"
        reason={lock}
        title="設定"
      />
    );
  }
  // Portalセッションを作れるか。無いあいだは `/plans` へ送る（T-M8-89）。
  const hasStripeCustomer = Boolean(profile.stripe_customer_id);
  const scheduledChange = scheduledPlanChangeLabel(profile);
  const scheduledChangeNote = scheduledPlanChangeNote(profile);
  // 割引はプラン名のすぐ下に出す（「次にいくら払うのか」が契約者の関心・T-M8-279）。
  const discount = discountLabel(profile);
  /*
    この先に起きる1件（解約予定 > プラン変更の予約）。解約が予約されていればそちらが重要なので先に出す
    （両方が同時に付くことはStripe側の挙動では起きないが、順序を決めておく）。
  */
  /*
    解約日は `current_period_end` で表す——**この行のすぐ下に出す「現在の期間終了日」と同じ値**にする。
    トライアル中もStripeは期間末＝トライアル終了日にするので（実測・T-M8-258）別扱いにしない。
  */
  const cancelAtLabel = formatPeriodEnd(profile.current_period_end);
  /*
    解約後も**残っている無料トライアル**があるか（T-M8-278）。トライアル中の解約はその場で終了するが、
    期限内なら残りの期間で再開できる。期限切れなら通常の有料再開になる。
  */
  const trialEndsAt = profile.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const remainingTrialLabel =
    trialEndsAt && !Number.isNaN(trialEndsAt.getTime()) && trialEndsAt > new Date()
      ? formatPeriodEnd(profile.trial_ends_at)
      : null;
  const upcomingChange = profile.cancel_at_period_end
    ? `${cancelAtLabel}に解約されます（それまでは今までどおりご利用いただけます）`
    : scheduledChangeNote;
  /*
    Stripeの確認画面には独自の文章を書けない（T-M8-270）。上位プランへの変更は即時に切り替わるので
    Stripeは「次回からのお支払い」しか出さず、**日割りの説明がどこにも出ない**。
    「確定」直後に戻ってくるここで、実際の差額と加算先の請求日を出す（運営者の指示 2026-08-23）。
  */
  const billingReturn =
    params.portal === "return" && profile.stripe_customer_id && profile.stripe_subscription_id
      ? { customerId: profile.stripe_customer_id, subscriptionId: profile.stripe_subscription_id }
      : null;
  /*
    **まず「その場で払った差額」を見る**（T-M8-296）。Portalを `always_invoice` にした（T-M8-275）ので、
    上位変更の差額は即時に請求・決済され、次回請求の下見には1行も出ない。
    `loadPendingProration` だけを見ていたため、**この説明がどの経路でも出なくなっていた**。
    未請求の差額（設定を変える前に発生して残っているもの）は、その次に、別の文言で出す。
  */
  const prorationCharge = billingReturn
    ? await loadRecentProrationCharge(stripe, {
        ...billingReturn,
        nowSec: Math.floor((await serverNowMs()) / 1000),
      })
    : null;
  const pendingProration =
    billingReturn && !prorationCharge ? await loadPendingProration(stripe, billingReturn) : null;

  // planに依存する第2波。
  // - APIキー: BYOK（standard/md）はX APIキーの登録がX連携の前提なので、設定タブで一緒に読む
  //   （前提未達のまま「追加」を押して無言で戻される事故を防ぐ・要件06 §1.2.1）。
  // - 利用枠: premium の利用枠（契約期間ごと）の残量（設定タブ・課金タブ, 要件03 §8・T-M6-12/T-M8-25）。
  // - アカウント行: アカウント設定／プロンプトタブの対象Xアカウント。
  const [apiKeys, usage, accountResult, purposeKeys] = await Promise.all([
    tab === "general" && !isOperatorManagedPlan(plan)
      ? listApiKeyViewsForUser(user.id)
      : Promise.resolve([] as ApiKeyViewState[]),
    // 利用枠は App Shell と同じ1行から作る（T-M8-295。専用クエリを持つと往復が1本増える）。
    tab === "billing" || tab === "general"
      ? loadRequestProfile(user.id).then((bundle) =>
          usageSummaryFrom(bundle, plan ?? "", bundle?.usage_resets_at ?? null),
        )
      : Promise.resolve(null as UsageSummary | null),
    tab === "account" && profile.active_x_account_id
      ? admin
          .from("x_accounts")
          .select("id, handle, settings, settings_proposal, base_md, base_md_version")
          .eq("id", profile.active_x_account_id)
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle<AccountRow>()
      : Promise.resolve(null),
    tab === "purposes" && !isOperatorManagedPlan(plan)
      ? listApiKeyViewsForUser(user.id)
      : Promise.resolve(null),
  ]);
  // 取得失敗を「未選択」にしない（T-M8-158）。null へ潰すと、連携済み・選択済みの利用者へ
  // 「Xアカウントを選択してください」の空状態が出て行き止まりになる。
  const account: AccountRow | null = accountResult
    ? readSingleRow(accountResult, "settings x_account")
    : null;
  // 参考ソースの滞留判定に使う基準時刻（T-M8-113）。サーバーとブラウザで同じ値を使わないと
  // ちょうど60秒あたりで判定が割れ、表示が食い違って描き直しになる。
  const nowMs = await serverNowMs();

  // アカウント設定タブ: 保存済み設定と、アカウント.mdとの差分有無・参考ソース。
  const parsedSettings = account ? personaSettingsSchema.safeParse(account.settings) : null;
  const initialSettings = parsedSettings?.success ? parsedSettings.data : EMPTY_SETTINGS;
  /*
    保存前の提案（T-M8-349）。**読めない提案は無かったことにする**——形が変わった古い提案で
    フォームを埋めると、利用者は自分が書いた覚えのない値を保存することになる。
  */
  const parsedProposal =
    account && account.settings_proposal
      ? personaSettingsSchema.safeParse(account.settings_proposal)
      : null;
  const settingsProposal = parsedProposal?.success ? parsedProposal.data : null;
  /*
    フォームを作り直す合図（T-M8-356/357）。**中身が変わったら作り直す**——
    「提案があるか」だけを見ていると、保存せずに2回続けて反映したとき
    （2回目の提案で欄が更新されない）に、また「押しても入らない」に戻る。
    文字列そのものをkeyにすると長くなるので、長さと文字コードの畳み込みで十分。
  */
  const proposalKey = settingsProposal
    ? `p${[...JSON.stringify(settingsProposal)].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1_000_000_007, 7)}`
    : "saved";
  let initialDifference = false;
  if (account && account.base_md_version >= 1 && parsedSettings?.success) {
    try {
      initialDifference = baseMdSettingsDiffer(account.base_md, parsedSettings.data);
    } catch {
      initialDifference = true;
    }
  }
  // 参考ソースはアカウント設定タブの**先頭**に置く（T-M8-344。設定を作る入口だから）。
  let learningSources: LearningSourceView[] = [];
  /** 反映のjobが動いているか（再訪しても「書き換え中」を出すため・T-M8-344）。 */
  let learningApplying = false;
  /*
    **設定が未保存でも読む**（T-M8-349）。以前は `base_md_version >= 1` を条件にしていたため、
    参考ソースを登録しても一覧が空のままで、「登録できたのか」が画面から分からなかった
    ——参考ソースはアカウント設定を作る入口なので、未保存のときこそ要る（原則1）。
  */
  if (tab === "account" && account) {
    /*
      **2本を同時に投げる**（T-M8-355）。互いに依存しないので直列にすると往復が2回ぶん
      待ち時間に乗る。片方が失敗したときにもう片方だけで描かないよう、Promise.all で揃える。
    */
    const [sources, running] = await Promise.all([
      listLearningSourcesForUser(user.id, account.id),
      pooledDb.query<{ n: number }>(
        `select count(*)::int as n from generation_jobs
          where x_account_id = $1 and kind in ('md_merge', 'learning_analysis')
            and status in ('queued', 'running')`,
        [account.id],
      ),
    ]);
    learningSources = sources;
    learningApplying = (running.rows[0]?.n ?? 0) > 0;
  }

  // プロンプトタブ: アカウント.md（履歴・学習中表示）とテンプレート。
  /* プロンプト関連の読み込みは `/app/prompts` へ移設（T-M8-328）。 */
  let validUserProviders: AiKeyProvider[] = [];
  if (purposeKeys) {
    validUserProviders = purposeKeys
      .filter(
        (key): key is typeof key & { provider: AiKeyProvider } =>
          key.provider !== "x" && key.status === "valid",
      )
      .map((key) => key.provider);
  }

  return (
    <main className="px-4 py-[26px] lg:px-8">
      <div className="mx-auto max-w-[1180px] space-y-3.5">
        <header>
          <h1 className={pageTitleClassName}>設定</h1>
        </header>

        <TabNav
          active={tab}
          className="gap-1 overflow-x-auto"
          hrefFor={(slug) => `/app/settings?tab=${slug}`}
          items={SETTINGS_TABS.map(([value, label]) => ({ value, label }))}
          label="設定タブ"
          linkClassName="shrink-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        />

        {/* X連携の失敗は戻り先が設定タブになるため、タブに依らず先頭で表示する。 */}
        {params.x_oauth_error ? (
          <XOAuthErrorNotice
            code={params.x_oauth_error}
            reason={params.x_oauth_reason ?? null}
          />
        ) : null}

        {/*
          **プラン未登録・解約中は課金・プラン以外のタブを開けない**（T-M8-269・運営者の指示
          2026-08-23）。タブ自体は残す——ここを消すと登録・再開の入口（課金・プラン）へ
          辿り着けなくなる。中身だけをロック表示に差し替える。
        */}
        {lock && tab !== "billing" ? (
          <AppLockedNotice
            description="Xアカウントの連携やAIの設定がご利用いただけます。"
            reason={lock}
          />
        ) : tab === "general" ? (
          <div className="space-y-8">
            {/* どのアカウントでログインしているか（T-M8-95→T-M8-109で設定タブ先頭へ移動・運営者の指示）。
                確認メール・領収書の宛先でもある。 */}
            <p className="text-body text-ink-2">
              ログイン中のアカウント:{" "}
              <span className="font-medium text-ink">{profile.email ?? user.email ?? "不明"}</span>
            </p>
            {/* 旧・Xアカウント／APIキー／通知タブを1タブへ（T-M8-104）。
                各部品が自前の見出しを持つため、ここでは見出しを重ねない（重複headingはE2EのstrictモードとAT読み上げの両方を壊す）。 */}
            <XAccountsSettings
                accounts={xAccounts}
                connected={params.x_connected === "1"}
                oauthStartPath={`/api/x/oauth/start?return=${encodeURIComponent(
                  "/app/settings?tab=general",
                )}`}
                plan={plan}
                xApiKeyRegistered={
                  isOperatorManagedPlan(plan) || apiKeys.some((key) => key.provider === "x")
                }
              />
            <ApiKeySettings
                // **OAuthが実際に送る値と同じ関数から取る**（T-M8-58）。式を二重に書くと、片方だけ
                // 変えたときに「Consoleへ登録した表示値」と「実送信値」が食い違い、Xは完全一致で
                // 照合するため連携が全滅する——この画面が防ごうとしている事故そのもの。
                callbackUrl={xRedirectUri()}
                initialKeys={apiKeys}
                plan={plan}
                usage={usage}
                usageResetLabel={usage ? usageResetLabel(usage) : "次回の更新日"}
              />
            {userSettings ? (
              <SettingsPreferences
                newsConfig={userSettings.newsConfig}
                notificationConfig={userSettings.notificationConfig}
              />
            ) : null}
          </div>
        ) : tab === "billing" ? (
          <section className="space-y-6" aria-labelledby="billing-heading">
            <Card as="div" className="px-5 py-4">
              <CardTitle id="billing-heading">
                現在のご契約
              </CardTitle>
              {params.portal === "return" ? (
                // 反映待ちの説明は「実際に待ちが起きるこの瞬間」だけに出す（T-M8-66）。
                <Notice className="mt-4" tone="success"
                  role="status">
                  お支払い管理画面から戻りました。変更は数十秒ほどでこの画面に反映されます。
                  {prorationCharge ? ` ${prorationChargedNotice(prorationCharge)}` : null}
                  {pendingProration ? ` ${prorationNotice(pendingProration)}` : null}
                </Notice>
              ) : null}
              <dl className="mt-6 grid gap-5 sm:grid-cols-2">
                <div>
                  <dt className="text-caption text-ink-3">プラン</dt>
                  {/* 月額はプラン名の真横（右側）に出し、キャンペーン終了後の併記は置かない
                      （運営者の指示 2026-08-22）。 */}
                  <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 text-body font-bold">
                    {profile.plan ? PLANS[profile.plan].displayName : "未選択"}
                    {profile.plan ? (
                      <span className="text-caption font-normal text-ink-3">
                        月額 ¥{yen(PLANS[profile.plan].monthlyPriceJpy)}（税込）
                      </span>
                    ) : null}
                    {discount ? (
                      <span className="basis-full text-caption font-normal text-brand">{discount}</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-ink-3">契約状態</dt>
                  <dd className="mt-1 text-body font-bold">
                    {STATUS_LABELS[profile.subscription_status] ??
                      profile.subscription_status}
                  </dd>
                </div>
                {/*
                  **解約・下位プランへの切り替えは「プラン」の下・「現在の期間終了日」の上に出す**
                  （運営者の指示 2026-08-23・T-M8-273）。別行に離すと、プラン名だけ見た人は
                  今のプランがそのまま続くと思ってしまう。予定が無いときは行ごと出さない。
                */}
                {upcomingChange ? (
                  <div className="sm:col-span-2">
                    <dt className="text-caption text-ink-3">この先の予定</dt>
                    <dd className="mt-1 text-body font-bold text-ink">{upcomingChange}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-caption text-ink-3">現在の期間終了日</dt>
                  <dd className="mt-1 text-body font-bold">
                    {formatPeriodEnd(profile.current_period_end)}
                  </dd>
                </div>
              </dl>
              {/*
                導線は1つにする（T-M8-29）。`PortalButton` が契約状態で行き先を変える
                （契約中→Stripeのプラン管理／契約前→料金プラン）ので、`/plans` への
                別リンクを並べると同じ行き先が2つ出る。
                **解約済み（canceled）だけは `ResumePlanButton`**（T-M8-264）——Portalの
                flow_dataは canceled の契約に入れないため、「プランを変更」が行き止まりになる。
              */}
              <div className="mt-7">
                {profile.subscription_status === "canceled" && profile.plan && hasStripeCustomer ? (
                  <ResumePlanButton
                    planLabel={PLANS[profile.plan].displayName}
                    remainingTrialLabel={remainingTrialLabel}
                  />
                ) : (
                  <PortalButton
                    cancelAtPeriodEnd={Boolean(profile.cancel_at_period_end)}
                      cancelAtLabel={cancelAtLabel}
                    cancellation={cancellationEffects({
                      plan: profile.plan,
                      endsAtLabel: cancelAtLabel,
                      trialing: profile.subscription_status === "trialing",
                    })}
                    trialing={profile.subscription_status === "trialing"}
                    effects={planChangeEffects({
                      cancelAtPeriodEnd: Boolean(profile.cancel_at_period_end),
                      currentPeriodEnd: profile.current_period_end,
                      subscriptionStatus: profile.subscription_status,
                    })}
                    enabled={hasStripeCustomer}
                    scheduledChange={scheduledChange}
                  />
                )}
              </div>
            </Card>
            {usage ? (
              <UsageSummaryCard nextResetLabel={usageResetLabel(usage)} summary={usage} />
            ) : null}
          </section>
        ) : tab === "account" ? (
          !account ? (
            <NoAccountState />
          ) : (
            <div className="space-y-8">
              {/*
                **どのアカウントを直しているかを最初に言う**（T-M8-349・運営者の指示 2026-08-28）。
                アカウント切替を使う人にとっては、編集を始める前に見えている必要がある。
              */}
              <p className="text-caption text-ink-3">
                対象アカウント: <strong className="text-ink-2">@{account.handle}</strong>
                {account.base_md_version >= 1
                  ? "（保存すると次の生成から反映されます）"
                  : "（まだ保存されていません）"}
              </p>

              {/*
                **1枚のカードに「参考ソース → アカウント設定」の順で入れる**
                （T-M8-356・運営者の指示 2026-08-28）。参考ソースはペルソナの上に置く——
                材料を入れてから中身を確認する流れが、上から下へ一直線になる。
                設定が未保存でも使える（T-M8-344。真似したいアカウントを挙げるところから始められる）。
              */}
              <div className={`${cardClassName} space-y-6 p-5 sm:p-6`}>
                <LearningSourcesManager
                  initialApplying={learningApplying}
                  initialNowMs={nowMs}
                  initialSources={learningSources}
                  key={`sources:${account.id}`}
                  settingsMissing={account.base_md_version < 1}
                  xAccountId={account.id}
                />
                <PersonaSettingsForm
                  baseMdVersion={account.base_md_version}
                  initialDifference={initialDifference}
                  initialSettings={initialSettings}
                  /*
                    **提案が届いたら作り直す**（T-M8-356）。フォームの初期値は
                    `useState` なので、`router.refresh()` で新しい提案を渡しても
                    **すでにmountされた画面は古い値のまま**だった——反映を押しても
                    欄に何も入らない、という形で静かに壊れていた（運営者の報告 2026-08-28）。
                    アカウント切替でもstateを捨てる（前アカウントの内容を新アカウントへ
                    保存させない・T-M8-196）。
                  */
                  key={`${account.id}:${proposalKey}`}
                  proposal={settingsProposal}
                  xAccountId={account.id}
                />
              </div>
            </div>
          )
        ) : tab === "purposes" ? (
          <AiPurposeSettings
            initialConfig={
              (profile.ai_purpose_config as { image: string | null; text: string | null } | null) ?? {
                image: null,
                text: null,
              }
            }
            operatorImageProviders={[...operatorImageProviders()]}
            plan={plan}
            validUserProviders={validUserProviders}
          />
        ) : null}
      </div>
    </main>
  );
}
