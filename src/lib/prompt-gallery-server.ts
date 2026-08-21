import "server-only";

import { pooledQueryable } from "@/lib/db/pool";
import { galleryTemplates, type GalleryTemplate } from "@/lib/prompt-template-gallery";

/**
 * プロンプト集の掲載データ（T-M8-175・運営者の指示 2026-08-21）。
 *
 * 運営テンプレート（正本から・`prompt-template-gallery.ts`）に加えて、
 * **一般ユーザーが作成したプロンプトを匿名で掲載する**（D-32の決定）。
 * ハンドル・氏名・メール等の識別子は一切返さない。掲載停止の申出は
 * お問い合わせ窓口で受ける（利用規約に開示）。
 */

export interface GalleryItem extends GalleryTemplate {
  /** official=運営テンプレート（正本） / community=利用者作成（匿名）。 */
  source: "official" | "community";
}

/** 1タブあたりの利用者作成の上限。ページ全体を重くしない（超過は新しい順に切る）。 */
const COMMUNITY_LIMIT = 50;

/** アカウント.mdの題名・説明を本文から導出する（識別子を使わない）。 */
function accountMdTitle(baseMd: string): { title: string; description: string } {
  const theme = /^- 主テーマ:\s*(.+)$/m.exec(baseMd)?.[1]?.trim();
  const value = /^- 読者が得るもの:\s*(.+)$/m.exec(baseMd)?.[1]?.trim();
  return {
    title: theme ? `${theme}の発信定義書` : "発信定義書（アカウント.md）",
    description: value ?? "利用者が育てているアカウント.mdです。",
  };
}

/** 画像プロンプトの説明＝本文冒頭の抜粋（見出しを除いた最初の内容行）。 */
function excerpt(content: string): string {
  const line = content
    .split("\n")
    .map((raw) => raw.trim())
    .find((raw) => raw.length > 0 && !raw.startsWith("#"));
  if (!line) return "利用者がカスタマイズした画像生成プロンプトです。";
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

export async function loadGalleryItems(): Promise<GalleryItem[]> {
  const db = pooledQueryable();
  const official: GalleryItem[] = galleryTemplates().map((template) => ({
    ...template,
    source: "official",
  }));

  const [patterns, images, baseMds] = await Promise.all([
    // 自作の投稿パターン（seed_key null＝利用者が題名・説明ごと作ったもの）。
    db.query<{ id: string; name: string; description: string | null; prompt: string }>(
      `select id, name, description, prompt
         from post_patterns
        where seed_key is null and prompt is not null
        order by updated_at desc
        limit ${COMMUNITY_LIMIT}`,
    ),
    // 画像生成プロンプトのアカウント上書き。
    db.query<{ id: string; content: string }>(
      `select id, content
         from prompt_templates
        where x_account_id is not null and kind = 'image'
        order by updated_at desc
        limit ${COMMUNITY_LIMIT}`,
    ),
    // 利用者のアカウント.md（初版生成済みのもの）。題名は本文から導出し、識別子は出さない。
    db.query<{ id: string; base_md: string }>(
      `select id, base_md
         from x_accounts
        where base_md_version >= 1 and base_md is not null and status <> 'disabled'
        order by updated_at desc
        limit ${COMMUNITY_LIMIT}`,
    ),
  ]);

  const community: GalleryItem[] = [
    ...baseMds.rows.map((row) => {
      const meta = accountMdTitle(row.base_md);
      return {
        id: `community-md-${row.id}`,
        name: meta.title,
        description: meta.description,
        content: row.base_md,
        group: "account-md" as const,
        source: "community" as const,
      };
    }),
    ...patterns.rows.map((row) => ({
      id: `community-post-${row.id}`,
      name: row.name,
      description: row.description ?? "利用者が作成した投稿の型です。",
      content: row.prompt,
      group: "post" as const,
      source: "community" as const,
    })),
    ...images.rows.map((row) => ({
      id: `community-image-${row.id}`,
      name: "画像生成プロンプト（利用者カスタム）",
      description: excerpt(row.content),
      content: row.content,
      group: "image" as const,
      source: "community" as const,
    })),
  ];

  return [...official, ...community];
}
