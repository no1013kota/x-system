import {
  patternDescriptionWithCount,
  type PatternOption,
} from "@/lib/post/post-patterns-store";

import { DeletePatternButton } from "./pattern-fields";

/**
 * パターン選択（T-M8-29）。**投稿作成とスケジュールで同じ見た目を使う。**
 *
 * ラジオボタン＋ラベル＋その下に説明文。同じものを選ぶ操作なので、画面によって見た目や
 * 情報量が変わらないようにする（以前は投稿作成がカード＋「P1」バッジ、スケジュールが
 * ラベルだけのラジオで、説明文が片方にしか無かった）。
 *
 * `name` は同一ページに複数のグループが並ぶ（スロットごとの編集フォーム）ため呼び出し側が決める。
 */
export function PatternRadioGroup({
  disabled,
  legend = "パターン",
  deleteDisabled,
  name,
  onAdd,
  onChange,
  onDelete,
  options,
  value,
}: {
  /**
   * 削除だけを止める（生成中など）。**ボタンは消さずに残す**——
   * 出したり消したりするとカードの幅が変わり、その場で読んでいる文字が動く。
   */
  deleteDisabled?: boolean;
  disabled?: boolean;
  legend?: string;
  name: string;
  onChange: (id: string) => void;
  /**
   * 渡すと各カードの中に削除（ゴミ箱）が出る（T-M8-134・運営者の指示 2026-08-18）。
   * **スケジュール画面は渡さない**——予約の編集中にパターンを消せると、
   * いま組み立てている予約の足元が崩れる。消すのは投稿作成か設定画面から。
   */
  onDelete?: (option: PatternOption) => void;
  /**
   * 渡すと**並んでいるパターンの最後に、同じパネル形式の「パターンを追加」**が出る
   * （T-M8-331・運営者の指示 2026-08-27）。以前は一覧の外側に単独のボタンがあり、
   * 「選ぶ」操作と「増やす」操作が別の場所に分かれていた。追加も選択肢の一種として
   * 同じ並びに置くと、目線が一覧から外れない。
   */
  onAdd?: () => void;
  options: PatternOption[];
  value: string;
}) {
  // 最後の1件は消せない（サーバーも拒否する）。押せてしまうと理由の分からない失敗になる。
  const deletable = onDelete !== undefined && options.length > 1;
  return (
    <fieldset>
      <legend className="mb-2 text-body font-medium text-ink">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => (
          /*
            **削除ボタンは `<label>` の外に置く**（兄弟にする）。中に入れると、
            押した瞬間にラベルが効いてそのパターンが選択され、消す直前に選択が動く。
          */
          <div className="relative" key={option.id}>
            <label
              className={`flex h-full cursor-pointer gap-2 rounded-card border border-hairline bg-surface py-2.5 pl-3 transition-colors duration-150 hover:bg-black/[0.02] has-checked:border-brand has-checked:bg-brand-subtle ${
                deletable ? "pr-10" : "pr-3"
              }`}
            >
              <input
                checked={value === option.id}
                className="mt-0.5 shrink-0"
                disabled={disabled}
                name={name}
                onChange={() => onChange(option.id)}
                type="radio"
                value={option.id}
              />
              <span className="min-w-0">
                <span className="block text-body font-medium text-ink">{option.name}</span>
                <span className="mt-0.5 block text-caption leading-4 text-ink-3">
                  {patternDescriptionWithCount(option)}
                </span>
              </span>
            </label>
            {deletable ? (
              <span className="absolute top-1.5 right-1.5">
                <DeletePatternButton
                  disabled={Boolean(disabled || deleteDisabled)}
                  name={option.name}
                  onConfirm={() => onDelete(option)}
                  variant="icon"
                />
              </span>
            ) : null}
          </div>
        ))}
        {onAdd ? (
          /*
            **既存パネルと同じ寸法・同じ並び**にする（枠線を破線にして「まだ無いもの」を示す）。
            `<label>` ではなく `<button>`——選択ではなく追加なので、ラジオの仲間に見せない。
          */
          <button
            className="flex h-full min-h-[62px] cursor-pointer items-center gap-2 rounded-card border border-dashed border-hairline bg-surface px-3 py-2.5 text-left transition-colors duration-150 hover:border-brand hover:bg-brand-subtle disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={onAdd}
            type="button"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-hairline text-ink-3">
              ＋
            </span>
            <span className="min-w-0">
              <span className="block text-body font-medium text-ink">パターンを追加</span>
              <span className="mt-0.5 block text-caption leading-4 text-ink-3">
                自分の型を作って選べるようにする
              </span>
            </span>
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}
