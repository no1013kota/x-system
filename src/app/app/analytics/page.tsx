import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/app-shell/feature-placeholder";

export const metadata: Metadata = { title: "分析 | Space AI" };

export default function AnalyticsPage() {
  return <FeaturePlaceholder description="投稿実績と改善提案はM5で追加します。" title="分析" />;
}
