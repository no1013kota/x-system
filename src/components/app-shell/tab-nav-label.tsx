"use client";

import { useLinkStatus } from "next/link";

/**
 * タブ内で使うローディング表示（T-M8-67）。searchParamsだけの遷移では `loading.tsx` が
 * 再表示されないため、以前はタブを押してもサーバー応答が返るまで**画面に何の反応も無かった**
 * （本番のVercel↔Supabase往復で1秒前後の「押しても効いていない」時間になる）。
 * `useLinkStatus` は囲っている Link の遷移中だけ pending を返すので、押したタブに
 * その場でスピナーが出る。
 *
 * このファイルだけを client component にしている理由: TabNav 本体を "use client" にすると、
 * 各ページが渡す `hrefFor`（関数props）がserver→client境界を越えられず**全タブページが
 * 実行時エラーになる**（typecheckでは検出できない。2026-08-07に実際に踏んだ）。
 */
export function TabLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {pending ? (
        <span
          aria-hidden
          className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
        />
      ) : null}
    </span>
  );
}
