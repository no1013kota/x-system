"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * プロンプト集の一覧（T-M8-175）。タブ内のワード検索をクライアント側で行う
 * （題名・説明・本文を対象。1タブ最大約60件なのでその場で絞る）。
 * データはサーバー（`prompt-gallery-server.ts`）が渡す。識別子は含まれない。
 */

export interface GalleryListItem {
  id: string;
  name: string;
  description: string;
  content: string;
  source: "official" | "community";
}

function TemplateCard({ item }: { item: GalleryListItem }) {
  const headingId = `template-${item.id}`;
  return (
    <Card aria-labelledby={headingId} as="article" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle as="h3" id={headingId}>
              {item.name}
            </CardTitle>
            {item.source === "official" ? (
              <Badge tone="brand">公式</Badge>
            ) : (
              <Badge tone="info">利用者作成</Badge>
            )}
          </div>
          <p className="mt-1 text-caption text-ink-2">{item.description}</p>
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
        {item.content}
      </pre>
    </Card>
  );
}

export function GalleryExplorer({ items }: { items: GalleryListItem[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.name}\n${item.description}\n${item.content}`.toLowerCase().includes(needle),
    );
  }, [items, query]);

  return (
    <div>
      <label className="relative block max-w-md">
        <span className="sr-only">プロンプトをワード検索</span>
        <Icon
          aria-hidden="true"
          className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-3"
          name="tune"
          size={16}
        />
        <input
          className="h-11 w-full rounded-lg border border-hairline bg-surface pr-3 pl-9 text-sm"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="題名・説明・本文からワード検索"
          type="search"
          value={query}
        />
      </label>
      {/* 0件は「該当なし」と明示する（黙って空にしない・原則1）。 */}
      {filtered.length === 0 ? (
        <p className="mt-6 text-sm text-ink-2" role="status">
          「{query}」に一致するプロンプトはありません。
        </p>
      ) : (
        <div aria-live="polite" className="mt-4 grid gap-4">
          {filtered.map((item) => (
            <TemplateCard item={item} key={item.id} />
          ))}
        </div>
      )}
    </div>
  );
}
