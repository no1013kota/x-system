import { redirect } from "next/navigation";

/**
 * 旧「AI設定」（T-M8-104で「設定」へ統合）。
 *
 * このルート自体は**リダイレクトのためだけに残す**——DBに保存済みの通知リンク・利用者の
 * ブックマーク・外部からの導線が `/app/ai-settings?tab=...` のまま届くため、消すと
 * 「押しても何も出ないリンク」が残る（原則1）。旧タブは統合後の対応タブへ送る。
 */

const TAB_MAP: Record<string, string> = {
  persona: "/app/settings?tab=account",
  learning: "/app/settings?tab=account", // 学習ソースタブは廃止（T-M8-103）
  purposes: "/app/settings?tab=purposes",
  "base-md": "/app/settings?tab=prompts&sec=account-md",
  prompts: "/app/settings?tab=prompts&sec=post-prompt",
};

interface AiSettingsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function AiSettingsPage({ searchParams }: AiSettingsPageProps) {
  const params = await searchParams;
  redirect(TAB_MAP[params.tab ?? ""] ?? "/app/settings?tab=account");
}
