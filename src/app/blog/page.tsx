import type { Metadata } from "next";
import Link from "next/link";

import { BlogPostMeta } from "./blog-post-meta";

import { PublicPageShell } from "@/components/public-page-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { APP_NAME } from "@/lib/app-config";
import { publishedPosts } from "@/lib/blog/blog-content";
import { readBlogCollection } from "@/lib/blog/blog-files";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: `ブログ | ${APP_NAME}`,
  description:
    "Exos AIのブログ。X（旧Twitter）運用・プロンプト設計・AI活用について、運営者が学んだことを記事にしています。",
};

/**
 * 公開ブログの一覧（T-M8-184）。記事はリポジトリの `blog/published/*.md`（front matter 付き・T-M8-193）で、
 * `/prompt-templates` と同じ器（`PublicPageShell`）に新しい順で並べる。
 *
 * 「記事が無い」を2種類に分ける（CLAUDE.md 原則1）: 公開記事0件は「準備中」、
 * front matter の不備で出せなかったファイルは**本番以外の環境では画面に理由を出す**
 * （運営者がローカル／stagingで気付ける。本番には出さない。`npm run blog:check` でも同じ判定）。
 */
export default function BlogIndexPage() {
  const collection = readBlogCollection();
  const posts = publishedPosts(collection.posts);
  // 不備の理由を画面に出すのは**開発環境だけ**。staging（preview）は未ログインでも開けるため、
  // ファイル名や front matter の生の行を訪問者に見せない。staging/本番は doctor と blog:check が担う。
  const showDiagnostics = env.APP_ENV === "development";

  return (
    <PublicPageShell current="/blog">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3 text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-caption font-bold text-ink-2">
            <Icon aria-hidden="true" className="text-brand" name="article" size={14} />
            X運用とAI活用の記録
          </p>
          <h1 className="text-[28px] font-bold tracking-tight text-balance text-ink sm:text-[34px]">
            ブログ
          </h1>
          <p className="text-sm text-ink-2">
            {APP_NAME}
            の運営者が、X運用・プロンプト設計・AIの使い方について学んだことを書いています。
          </p>
        </header>

        {showDiagnostics && !collection.directoryExists ? (
          <p
            className="rounded-card border border-warn-fg/40 bg-warn-bg px-4 py-3 text-body text-ink"
            role="status"
          >
            記事ディレクトリ <code>blog/</code> が見つかりません（開発環境のみ表示）。
            デプロイに同梱されていない可能性があります。
          </p>
        ) : null}
        {showDiagnostics && collection.invalid.length > 0 ? (
          <div
            className="rounded-card border border-warn-fg/40 bg-warn-bg px-4 py-3 text-body text-ink"
            role="status"
          >
            <p className="font-bold">
              不備があり公開されていない記事が {collection.invalid.length} 件あります
              （開発環境のみ表示。<code>npm run blog:check</code> で同じ内容を確認できます）
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5" role="list">
              {collection.invalid.map(({ file, errors }) => (
                <li key={file}>
                  <code>{file}</code>: {errors.join(" / ")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {posts.length === 0 ? (
          <Card as="section" className="px-6 py-10 text-center">
            <p className="text-sm font-bold text-ink">準備中です</p>
            <p className="mt-1.5 text-body text-ink-2">
              最初の記事を用意しています。それまでは
              <Link className="text-brand underline underline-offset-4" href="/prompt-templates">
                プロンプト集
              </Link>
              をご覧ください。
            </p>
          </Card>
        ) : (
          <ul className="space-y-4" role="list">
            {posts.map((post) => {
              const headingId = `post-${post.slug}`;
              return (
                <li key={post.slug}>
                  {/*
                    カードのどこを押しても記事へ行く（運営者の指示 2026-08-23・T-M8-232）。
                    リンクは**題名の1本だけ**に保ち、その中の透明な span（`absolute inset-0`）で
                    当たり判定だけをカード全体へ広げる（リンクをもう1本重ねると、読み上げと
                    タブ移動で同じ記事が2回出る）。カード側の `relative` が広がる基準。
                  */}
                  <Card
                    aria-labelledby={headingId}
                    as="article"
                    className="group relative px-6 py-5 transition-colors hover:border-brand/40 focus-within:border-brand/40"
                  >
                    <CardTitle as="h2" className="text-[17px] leading-snug" id={headingId}>
                      <Link
                        className="text-ink group-hover:text-brand focus-visible:underline focus-visible:outline-none"
                        href={`/blog/${post.slug}`}
                      >
                        <span aria-hidden="true" className="absolute inset-0" />
                        {post.title}
                      </Link>
                    </CardTitle>
                    <p className="mt-1.5 text-body leading-relaxed text-ink-2">{post.description}</p>
                    <div className="mt-3">
                      <BlogPostMeta post={post} />
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PublicPageShell>
  );
}
