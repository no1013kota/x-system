import type { ReactNode } from "react";
import Link from "next/link";

import { LegalFooter } from "@/components/legal-footer";
import { cardTitleClassName } from "@/components/ui/card";
import { APP_NAME } from "@/lib/app-config";
import { LEGAL_ENTITY } from "@/lib/legal-entity";

/**
 * 法務文書の共通レイアウト（T-M8-72）。
 *
 * 以前は3ページがそれぞれ別の骨格を持ち、「暫定版」の見せ方も配色も文言も揃っていなかった。
 * 版の表示・事業者名・フッタの法務3リンクは**どのページでも同じ位置に同じ形で出す**必要があるため、
 * 器をここへ集約する。条番号の付け方も `LegalArticle` に寄せて手打ちのズレを防ぐ。
 */
export function LegalDocument({
  children,
  title,
  versionLabel,
  updatedLabel,
}: {
  children: ReactNode;
  title: string;
  /** 「2026年8月8日版」。同意の対象になる文書（規約・プライバシー）だけ渡す。 */
  versionLabel?: string;
  /** 「最終更新: 2026年8月8日」。同意の対象でない文書（特商法表記）で使う。 */
  updatedLabel?: string;
}) {
  return (
    <div className="bg-page flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:px-8">
        <header className="space-y-2">
          <Link className="text-body font-bold tracking-tight text-ink" href="/">
            {APP_NAME}
          </Link>
          <h1 className="text-[26px] font-bold tracking-tight text-ink">{title}</h1>
          <p className="text-caption text-ink-3">
            {versionLabel ? `${versionLabel}　` : null}
            {updatedLabel ?? null}
          </p>
        </header>

        {/*
          法務文書は読ませる文章なので、UI本文（13px）ではなく14px・行間1.9で組む。
          `[&>ul]` 等で子要素の体裁をまとめて指定し、各条文側にクラスを書かせない。
        */}
        <article
          className="mt-9 space-y-6 text-sm leading-[1.9] text-ink [&_a]:text-brand [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_p]:leading-[1.9] [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6"
        >
          {children}
        </article>

        <p className="mt-10 text-caption text-ink-3">
          発行者: {LEGAL_ENTITY.name}（お問い合わせ: {LEGAL_ENTITY.email}）
        </p>
      </main>
      <LegalFooter />
    </div>
  );
}

/** 条見出し＋本文。番号は呼び出し側が渡す（目視で通し番号を確認できるようにする）。 */
export function LegalArticle({
  children,
  n,
  title,
}: {
  children: ReactNode;
  n: number;
  title: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className={cardTitleClassName}>第{n}条（{title}）</h2>
      {children}
    </section>
  );
}

/** 定義リスト形式の節（プライバシーポリシーの「取得する情報」など）。 */
export function LegalDefinitions({
  items,
}: {
  items: readonly { term: string; description: string }[];
}) {
  return (
    <dl className="divide-y divide-hairline rounded-card border border-hairline">
      {items.map((item) => (
        <div className="grid gap-1 p-4 sm:grid-cols-[12rem_1fr] sm:gap-4" key={item.term}>
          <dt className="text-body font-bold text-ink">{item.term}</dt>
          <dd className="text-body leading-[1.8] text-ink-2">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 横スクロールする表（委託先一覧・Cookie一覧）。狭い幅でページ全体を伸ばさない。 */
export function LegalTable({
  headers,
  rows,
}: {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}) {
  return (
    // 外側に `relative` を付ける（横スクロールする表の規約・開発とテストの進め方 §12）。
    <div className="relative overflow-x-auto rounded-card border border-hairline">
      <table className="w-full min-w-[40rem] border-collapse text-caption">
        <thead>
          <tr className="border-b border-hairline bg-black/[0.02] text-left">
            {headers.map((h) => (
              <th className="p-3 font-bold text-ink" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-hairline last:border-0" key={row[0]}>
              {row.map((cell, i) => (
                <td
                  className={`p-3 align-top leading-[1.8] ${i === 0 ? "font-medium text-ink" : "text-ink-2"}`}
                  key={i}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
