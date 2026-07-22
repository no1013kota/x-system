import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/app-shell/feature-placeholder";

export const metadata: Metadata = { title: "投稿 | Space AI" };

export default function PostsPage() {
  return <FeaturePlaceholder description="投稿作成と下書き管理はM3で追加します。" title="投稿" />;
}
