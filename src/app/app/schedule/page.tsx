import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/app-shell/feature-placeholder";

export const metadata: Metadata = { title: "スケジュール | Space AI" };

export default function SchedulePage() {
  return <FeaturePlaceholder description="投稿スケジュール機能はM4で追加します。" title="スケジュール" />;
}
