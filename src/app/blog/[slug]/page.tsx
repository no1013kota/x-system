import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { BlogPostMeta } from "../blog-post-meta";

import { BlogMarkdown } from "@/components/blog/blog-markdown";
import { PublicPageShell } from "@/components/public-page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { APP_NAME } from "@/lib/app-config";
import { findPublishedPost } from "@/lib/blog/blog-files";
import { cn } from "@/lib/utils";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

/** generateMetadata と本文で同じ記事を読むので、1リクエスト内では1回だけ読む。 */
const getPost = cache((slug: string) => findPublishedPost(slug));

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: `記事が見つかりません | ${APP_NAME}` };
  return {
    title: `${post.title} | ${APP_NAME}`,
    description: post.description,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
    },
  };
}

/**
 * ブログ記事（T-M8-184）。`blog/<slug>.md` の本文を Markdown として描画する。
 * 下書き・front matter の不備・存在しない slug はすべて 404（公開側では区別しない。
 * 理由は一覧ページの診断表示と `npm run blog:check` が出す）。
 */
export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return (
    <PublicPageShell current="/blog">
      <article className="mx-auto max-w-3xl">
        <nav aria-label="パンくず" className="mb-6">
          <Link
            className="inline-flex min-h-6 items-center gap-1 text-body font-medium text-ink-2 transition-colors hover:text-brand"
            href="/blog"
          >
            <Icon aria-hidden="true" name="chevron_right" className="rotate-180" size={16} />
            ブログ一覧へ
          </Link>
        </nav>
        <header className="space-y-3 border-b border-hairline pb-6">
          <h1 className="text-[26px] font-bold tracking-tight text-balance text-ink sm:text-[32px]">
            {post.title}
          </h1>
          <p className="text-sm text-ink-2">{post.description}</p>
          <BlogPostMeta post={post} />
        </header>
        <div className="pt-2">
          <BlogMarkdown source={post.body} />
        </div>
        <footer className="mt-12 rounded-card border border-hairline bg-surface px-6 py-6 text-center">
          <p className="text-sm font-bold text-ink">{APP_NAME} でX運用を自動化する</p>
          <p className="mt-1 text-body text-ink-2">
            学習・生成・投稿・分析までを1つのアプリで。7日間は無料でお試しいただけます。
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2.5">
            <Link
              className={cn(buttonVariants({ variant: "brand" }), "h-10 px-5 text-body font-bold")}
              href="/signup"
            >
              無料で始める
            </Link>
            <Link
              className={cn(buttonVariants({ variant: "ghost" }), "h-10 px-4 text-body font-medium")}
              href="/prompt-templates"
            >
              プロンプト集を見る
            </Link>
          </div>
        </footer>
      </article>
    </PublicPageShell>
  );
}
