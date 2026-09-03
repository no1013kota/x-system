import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import { GLASS, HEADING } from "./tokens";

/**
 * 画像を使わない文字だけの3カード（「クローンと呼ぶ理由」「安心して任せるために」）。
 * 中盤で視覚密度を意図的に下げて緩急をつける。器はガラス（`cardClassName` の白カードとは別物）。
 */
export interface TextCard {
  icon: IconName;
  title: string;
  body: string;
}

export function TextCards({
  items,
  className,
}: {
  items: TextCard[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-6 min-[760px]:grid-cols-3",
        className,
      )}
    >
      {items.map((item) => (
        <div className={cn(GLASS, "p-8")} key={item.title}>
          <Icon className="text-brand" name={item.icon} size={24} />
          <h3 className={cn("mt-4 text-[20px] leading-[1.4]", HEADING)}>
            {item.title}
          </h3>
          <p className="mt-2 text-sm leading-[1.8] text-ink-2">{item.body}</p>
        </div>
      ))}
    </div>
  );
}
