import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/app-shell/feature-placeholder";

export const metadata: Metadata = { title: "ニュース | Space AI" };

export default function NewsPage() {
  return <FeaturePlaceholder description="ニュース収集機能はM4で追加します。" title="ニュース" />;
}
