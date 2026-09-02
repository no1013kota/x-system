import { redirect } from "next/navigation";

/**
 * 旧「AI設定」（T-M8-104で「設定」へ統合）。
 *
 * このルート自体は**リダイレクトのためだけに残す**——DBに保存済みの通知リンク・利用者の
 * ブックマーク・外部からの導線が `/app/ai-settings?tab=...` のまま届くため、消すと
 * 「押しても何も出ないリンク」が残る（原則1）。旧タブは統合後の対応タブへ送る。
 */

const TAB_MAP: Record<string, string> = {
  // アカウント設定（参考アカウント＋5項目）は プロンプト＞アカウント.md へ（T-M8-396/T-M8-400）。
  persona: "/app/prompts?sec=account-md",
  learning: "/app/prompts?sec=account-md",
  purposes: "/app/prompts?sec=ai-models", // AIモデル設定はプロンプト画面へ（T-M8-401）
  "base-md": "/app/prompts?sec=account-md",
  prompts: "/app/prompts?sec=post-prompt",
};

interface AiSettingsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function AiSettingsPage({ searchParams }: AiSettingsPageProps) {
  const params = await searchParams;
  redirect(TAB_MAP[params.tab ?? ""] ?? "/app/prompts?sec=account-md");
}
