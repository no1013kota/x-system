import type { ComponentProps } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * ブログ本文の Markdown 描画（T-M8-184）。
 *
 * - **生HTMLは描画しない**（`skipHtml`）。記事はリポジトリ管理で書き手は運営者だが、
 *   CSP（nonce付き script-src）と XSS の観点で React 要素だけを出す。`dangerouslySetInnerHTML` は使わない。
 * - GFM（表・打ち消し線・タスクリスト・自動リンク）を有効にする。
 * - 本文の `#`（h1）はページの h1（front matter の title）と重複するので h2 に落とす。
 * - 外部リンクは新しいタブ（`rel="noopener noreferrer"`）、サイト内リンクは同じタブ。
 * - 見た目は各要素に Tailwind を当てる（typography プラグインは入れていない。デザイントークンに揃える）。
 */

const PROSE_HEADING = "font-bold tracking-tight text-ink [text-wrap:balance]";

/**
 * react-markdown は各要素に `node`（hast ノード）を渡す。そのまま DOM へ spread すると
 * `node="[object Object]"` 属性として出力されるので外す。
 */
function domProps<T extends object>(props: T & ExtraProps): T {
  const { node: _node, ...rest } = props;
  void _node;
  return rest as T;
}

function isExternalHref(href: string | undefined): boolean {
  return Boolean(href && /^https?:\/\//i.test(href));
}

const components: Components = {
  // 本文中の h1 は h2 として描く（ページの h1 は記事タイトル）。
  h1: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <h2 className={cn(PROSE_HEADING, "mt-10 text-[22px] leading-snug", className)} {...props} />
    );
  },
  h2: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <h2 className={cn(PROSE_HEADING, "mt-10 text-[22px] leading-snug", className)} {...props} />
    );
  },
  h3: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <h3 className={cn(PROSE_HEADING, "mt-8 text-[18px] leading-snug", className)} {...props} />
    );
  },
  h4: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <h4 className={cn(PROSE_HEADING, "mt-6 text-[16px]", className)} {...props} />
    );
  },
  p: (raw) => {
    const { className, ...props } = domProps(raw);
    return <p className={cn("my-4", className)} {...props} />;
  },
  a: (raw) => {
    const { className, href, ...props } = domProps(raw);
    const external = isExternalHref(href);
    return (
      <a
        className={cn("text-brand underline underline-offset-4 hover:text-brand-hover", className)}
        href={href}
        rel={external ? "noopener noreferrer" : undefined}
        target={external ? "_blank" : undefined}
        {...props}
      />
    );
  },
  ul: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <ul className={cn("my-4 list-disc space-y-1.5 pl-6", className)} {...props} />
    );
  },
  ol: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <ol className={cn("my-4 list-decimal space-y-1.5 pl-6", className)} {...props} />
    );
  },
  li: (raw) => {
    const { className, ...props } = domProps(raw);
    return <li className={cn("pl-1", className)} {...props} />;
  },
  blockquote: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <blockquote
        className={cn("my-5 border-l-4 border-brand/40 pl-4 text-ink-2 [&_p]:my-2", className)}
        {...props}
      />
    );
  },
  hr: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <hr className={cn("my-10 border-hairline", className)} {...props} />
    );
  },
  strong: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <strong className={cn("font-bold text-ink", className)} {...props} />
    );
  },
  // インラインコードとコードブロック。`pre > code` は親の pre が枠を持つので塗らない。
  pre: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <pre
        className={cn(
          "my-5 overflow-x-auto rounded-card border border-hairline bg-page px-4 py-3.5 text-caption leading-[1.8] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit",
          className,
        )}
        {...props}
      />
    );
  },
  code: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <code
        className={cn("rounded bg-black/[0.05] px-1.5 py-0.5 font-mono text-[0.92em] text-ink", className)}
        {...props}
      />
    );
  },
  // 表は幅が足りないとページを横に伸ばすので、枠の中でスクロールさせる。
  table: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <div className="my-5 overflow-x-auto">
        <table className={cn("w-full border-collapse text-body", className)} {...props} />
      </div>
    );
  },
  th: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <th
        className={cn("border-b-2 border-hairline bg-page px-3 py-2 text-left font-bold text-ink", className)}
        {...props}
      />
    );
  },
  td: (raw) => {
    const { className, ...props } = domProps(raw);
    return (
      <td className={cn("border-b border-hairline px-3 py-2 align-top", className)} {...props} />
    );
  },
  img: (raw) => {
    const { className, alt, ...props } = domProps(raw);
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 記事内の画像は任意ホスト・サイズ未知のため next/image を使わない
      <img
        alt={alt ?? ""}
        className={cn("my-5 h-auto max-w-full rounded-card border border-hairline", className)}
        loading="lazy"
        {...props}
      />
    );
  },
  // GFM のタスクリスト。編集できない表示専用。
  input: (raw: ComponentProps<"input"> & ExtraProps) => (
    <input {...domProps(raw)} className="mr-1.5 align-middle" disabled readOnly />
  ),
};

export function BlogMarkdown({ source }: { source: string }) {
  return (
    <div className="text-[15px] leading-[1.9] text-ink">
      <Markdown components={components} remarkPlugins={[remarkGfm]} skipHtml>
        {source}
      </Markdown>
    </div>
  );
}
