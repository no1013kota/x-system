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
      </div>
    </fieldset>
  );
}
