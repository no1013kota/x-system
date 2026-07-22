import type { Metadata } from "next";

import { FeaturePlaceholder } from "@/components/app-shell/feature-placeholder";

export const metadata: Metadata = { title: "AI設定 | Space AI" };

export default function AiSettingsPage() {
  return <FeaturePlaceholder description="発信設定とAI用途設定はM2で順次追加します。" title="AI設定" />;
}
