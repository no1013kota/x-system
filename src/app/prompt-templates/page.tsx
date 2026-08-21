import type { Metadata } from "next";

import { GalleryExplorer, type GalleryListItem } from "./gallery-explorer";

import { TabNav } from "@/components/app-shell/tab-nav";
import { PublicPageShell } from "@/components/public-page-shell";
import { Icon } from "@/components/ui/icon";
import { APP_NAME } from "@/lib/app-config";
import { loadGalleryItems, type GalleryItem } from "@/lib/prompt-gallery-server";

export const metadata: Metadata = {
  title: `プロンプト集 | ${APP_NAME}`,
  description:
    "Exos AIのプロンプトテンプレート集。公式テンプレートと利用者が作成したアカウント.md・投稿プロンプト・画像生成プロンプトを全文確認できます。",
};

/**
 * 公開プロンプト集（T-M8-173／T-M8-175・運営者の指示 2026-08-21）。
 *
 * 公式テンプレート（正本から描画）に加えて**利用者作成のプロンプトを匿名で掲載**する。
 * 量が増える前提で「アカウント.md／投稿プロンプト／画像プロンプト」の3タブ＋ワード検索。
 * 「このプロンプトを利用する」は新規登録へつなぐ。掲載の開示は利用規約第7条・
 * プライバシーポリシー（掲載停止はお問い合わせ窓口）。
 */

const TABS: { value: GalleryItem["group"]; label: string; lead: string }[] = [
  {
    value: "account-md",
    label: "アカウント.md",
    lead: "全投稿の土台になる1枚。登録後は自分の言葉で自由に編集でき、学習と改善提案で育ちます。",
  },
  {
    value: "post",
    label: "投稿プロンプト",
    lead: "投稿の型ごとの生成指示。公式の6種に加えて、利用者が作成した型も並びます。",
  },
  {
    value: "image",
    label: "画像プロンプト",
    lead: "投稿に添える画像の生成指示。文章と同じく、直接確認・編集できます。",
  },
];

interface PromptTemplatesPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function PromptTemplatesPage({ searchParams }: PromptTemplatesPageProps) {
  const params = await searchParams;
  const activeTab =
    TABS.find((tab) => tab.value === params.tab)?.value ?? "account-md";
  const items = await loadGalleryItems();
  const activeItems: GalleryListItem[] = items
    .filter((item) => item.group === activeTab)
    .map(({ id, name, description, content, source, placeholders }) => ({
      id,
      name,
      description,
      content,
      source,
      placeholders,
    }));
  const active = TABS.find((tab) => tab.value === activeTab)!;

  return (
    <PublicPageShell current="/prompt-templates">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="mx-auto max-w-3xl space-y-3 text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-caption font-bold text-ink-2">
            <Icon aria-hidden="true" className="text-brand" name="edit_square" size={14} />
            実際に使われているプロンプトを全文公開
          </p>
          <h1 className="text-[28px] font-bold tracking-tight text-balance text-ink sm:text-[34px]">
            プロンプト集
          </h1>
          <p className="text-sm text-ink-2">
            {APP_NAME}
            の公式テンプレートと、利用者のみなさんが作成したプロンプトです（利用者作成分は匿名で掲載）。登録するとこのまま使え、すべて自分の言葉に書き換えられます。
          </p>
        </header>

        <div>
          <TabNav
            active={activeTab}
            hrefFor={(slug) => `/prompt-templates?tab=${slug}`}
            items={TABS.map(({ value, label }) => ({ value, label }))}
            label="プロンプトの区分"
          />
          <p className="mt-3 text-sm text-ink-2">{active.lead}</p>
          <div className="mt-4">
            <GalleryExplorer items={activeItems} />
          </div>
        </div>
      </div>
    </PublicPageShell>
  );
}
