import type { PostPatternOption } from "@/lib/post/post-patterns";

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
  name,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  legend?: string;
  name: string;
  onChange: (id: string) => void;
  options: PostPatternOption[];
  value: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-body font-medium text-ink">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => (
          <label
            className="flex cursor-pointer gap-2 rounded-card border border-hairline bg-surface px-3 py-2.5 transition-colors duration-150 hover:bg-black/[0.02] has-checked:border-brand has-checked:bg-brand-subtle"
            key={option.id}
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
              <span className="block text-body font-medium text-ink">{option.label}</span>
              <span className="mt-0.5 block text-caption leading-4 text-ink-3">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
