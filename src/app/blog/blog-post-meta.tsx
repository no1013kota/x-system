import { Badge } from "@/components/ui/badge";
import { formatBlogDate, type BlogPost } from "@/lib/blog/blog-content";

/** 記事の日付とタグ。一覧カードと記事ヘッダで同じ形に出す。 */
export function BlogPostMeta({ post }: { post: Pick<BlogPost, "date" | "updated" | "tags"> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-ink-3">
      <time dateTime={post.date}>{formatBlogDate(post.date)}</time>
      {post.updated && post.updated !== post.date ? (
        <span>
          更新 <time dateTime={post.updated}>{formatBlogDate(post.updated)}</time>
        </span>
      ) : null}
      {post.tags.length > 0 ? (
        <ul aria-label="タグ" className="flex flex-wrap gap-1.5">
          {post.tags.map((tag) => (
            <li key={tag}>
              <Badge tone="neutral">{tag}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
