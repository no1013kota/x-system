import type { Metadata } from "next";
import Link from "next/link";

import { LegalFooter } from "@/components/legal-footer";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { APP_NAME } from "@/lib/app-config";
import { galleryTemplates, type GalleryTemplate } from "@/lib/prompt-template-gallery";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: `プロンプト集 | ${APP_NAME}`,
  description:
    "Exos AIが実際に使うプロンプトテンプレートの一覧。アカウント.md（発信定義書）、投稿の型6種、画像生成のプロンプト全文を確認できます。",
};

/**
 * 公開プロンプトテンプレート集（T-M8-173・運営者の指示 2026-08-21）。
 *
 * アプリが実際に使うテンプレート（アカウント.md・投稿の型6種・画像生成）を全文公開する。
 * 「中でどんな指示が動くか」を申込前に確認でき、各テンプレートの「このプロンプトを利用する」は
 * 新規登録へつなぐ。**本文は正本（`prompt-template-gallery.ts` 経由）から描画し、
 * このページへ書き写さない。** 実ユーザーの作成物は載せない（公開許諾の仕組みが無い・要決定D-32）。
 */

const GROUP_LABELS: Record<GalleryTemplate["group"], { title: string; lead: string }> = {
  "account-md": {
    title: "アカウント.md（発信定義書）",
    lead: "全投稿の土台になる1枚。登録後は自分の言葉で自由に編集でき、学習と改善提案で育ちます。",
  },
  post: {
    title: "投稿プロンプト（6種類の型）",
    lead: "投稿の型ごとの生成指示。登録後はそのまま使うことも、1行ずつ書き換えることもできます。",
  },
  image: {
    title: "画像生成プロンプト",
    lead: "投稿に添える画像の生成指示。文章と同じく、直接確認・編集できます。",
  },
};

function TemplateCard({ template }: { template: GalleryTemplate }) {
  const headingId = `template-${template.id}`;
  return (
    <Card aria-labelledby={headingId} as="article" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-ink" id={headingId}>
            {template.name}
          </h3>
          <p className="mt-1 text-caption text-ink-2">{template.description}</p>
        </div>
        <Link
          className={cn(buttonVariants({ variant: "brand" }), "h-9 px-4 text-body font-bold")}
          href="/signup"
        >
          このプロンプトを利用する
        </Link>
      </div>
      {/* 全文。折りたたまず、長いものはこの枠の中でスクロールさせる（ページを縦に伸ばしすぎない）。 */}
      <pre className="mx-5 mt-3.5 mb-5 max-h-[420px] overflow-auto rounded-card border border-hairline bg-page px-4 py-3.5 text-caption leading-[1.8] whitespace-pre-wrap text-ink-2">
        {template.content}
      </pre>
    </Card>
  );
}

export default function PromptTemplatesPage() {
  const templates = galleryTemplates();
  const groups: GalleryTemplate["group"][] = ["account-md", "post", "image"];
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <Link className="text-sm font-semibold tracking-wide" href="/">
            {APP_NAME}
          </Link>
          <div className="flex items-center gap-2.5">
            <Link
              className={cn(buttonVariants({ variant: "ghost" }), "h-9 px-3.5 text-body font-medium")}
              href="/login"
            >
              ログイン
            </Link>
            <Link
              className={cn(buttonVariants({ variant: "brand" }), "h-9 px-4 text-body font-bold")}
              href="/signup"
            >
              無料で始める
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-10 sm:py-14">
        <div className="mx-auto max-w-5xl space-y-10">
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
              が投稿を作るときに実際に使うテンプレートです。登録するとこのまま使え、すべて自分の言葉に書き換えられます。
            </p>
          </header>
          {groups.map((group) => (
            <section aria-label={GROUP_LABELS[group].title} key={group}>
              <h2 className="text-[20px] font-bold tracking-tight text-ink">
                {GROUP_LABELS[group].title}
              </h2>
              <p className="mt-1.5 text-sm text-ink-2">{GROUP_LABELS[group].lead}</p>
              <div className="mt-4 grid gap-4">
                {templates
                  .filter((template) => template.group === group)
                  .map((template) => (
                    <TemplateCard key={template.id} template={template} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
