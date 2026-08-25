"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * プロンプト集の一覧（T-M8-175/182）。タブ内のワード検索と、**プレースホルダーの入力体験**
 * （入力すると本文中の {名前} がその場で置き換わる・T-M8-182）をクライアント側で行う。
 * データはサーバー（`prompt-gallery-server.ts`）が渡す。識別子は含まれない。
 */

export interface GalleryListItem {
  id: string;
  name: string;
  description: string;
  content: string;
  source: "official" | "community";
  /** 投稿プロンプトの差し込み欄（{名前} で本文へ差し込まれる・T-M8-178）。 */
  placeholders: string[];
}

/**
 * 本文中の {名前} を入力値で置き換えて描画する。入力済みは色付きで示し、
 * 未入力はトークンのまま出す。対象は**その項目が宣言したプレースホルダーだけ**
 * （プロンプト内の `{{...}}` などシステム変数には触らない）。
 */
function renderContentWithValues(
  content: string,
  placeholders: string[],
  values: Record<string, string>,
): ReactNode[] {
  if (placeholders.length === 0) return [content];
  const pattern = new RegExp(
    `(${placeholders
      .map((name) => `\\{${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`)
      .join("|")})`,
    "g",
  );
  return content.split(pattern).map((segment, index) => {
    const match = /^\{(.+)\}$/.exec(segment);
    const name = match?.[1];
    if (!name || !placeholders.includes(name)) return segment;
    const value = values[name]?.trim();
    return value ? (
      <mark className="rounded bg-brand-subtle px-1 font-medium text-brand" key={index}>
        {value}
      </mark>
    ) : (
      <span className="rounded border border-hairline bg-surface px-1 text-ink-3" key={index}>
        {segment}
      </span>
    );
  });
}

function TemplateCard({ item }: { item: GalleryListItem }) {
  const headingId = `template-${item.id}`;
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <Card aria-labelledby={headingId} as="article" className="overflow-hidden">
      {/* CTAは常にカード右上（T-M8-182）。タイトルが長くても回り込ませない。 */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-5 pt-4">
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
          className={cn(
            buttonVariants({ variant: "brand" }),
            "h-9 justify-self-end px-4 text-body font-bold",
          )}
          href="/signup"
        >
          このプロンプトを利用する
        </Link>
      </div>
      {item.placeholders.length > 0 ? (
        /*
          プレースホルダーの入力体験（T-M8-182・運営者の指示）。入力すると下の本文の
          {名前} がその場で置き換わる。実際の投稿作成画面と同じ「差し込み」の感覚を試せる。
        */
        <div className="mx-5 mt-3.5 rounded-card border border-hairline bg-brand-subtle/50 px-4 py-3">
          <p className="text-caption font-bold text-ink-2">
            プレースホルダー
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {item.placeholders.map((name) => (
              <label className="block text-caption font-medium text-ink-2" key={name}>
                {`{${name}}`}
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-sm text-ink"
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [name]: event.target.value }))
                  }
                  placeholder={`${name}を入力して試す`}
                  type="text"
                  value={values[name] ?? ""}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {/* 全文。折りたたまず、長いものはこの枠の中でスクロールさせる（ページを縦に伸ばしすぎない）。 */}
      <pre className="mx-5 mt-3.5 mb-5 max-h-[420px] overflow-auto rounded-card border border-hairline bg-page px-4 py-3.5 text-caption leading-[1.8] whitespace-pre-wrap text-ink-2">
        {renderContentWithValues(item.content, item.placeholders, values)}
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
