"use client";

import { useState, useTransition } from "react";

import { saveWritingCheckpointsAction } from "@/app/actions/writing-checkpoints";
import { cardTitleClassName } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import {
  WRITING_CHECKPOINT_GROUPS,
  WRITING_CHECKPOINTS,
  WRITING_CHECKPOINTS_HEADING,
  type WritingCheckpointGroup,
} from "@/lib/prompts/writing-checkpoints";

/**
 * 書き方のチェックポイント（T-M8-447）。チェックした条項が、生成のたびにアカウント.mdの末尾へ
 * 「## 書き方のチェックポイント」として付いて AI へ渡る。本文（本棚）には書き込まない。
 * 切り替えは即保存（保存ボタンを置かない。1つ切り替えるたびに保存し、失敗したら元へ戻す）。
 */
export function WritingCheckpointsPanel({
  initialIds,
  xAccountId,
}: {
  initialIds: string[];
  xAccountId: string;
}) {
  const toast = useToast();
  const [ids, setIds] = useState<string[]>(initialIds);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    const previous = ids;
    const next = ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id];
    setIds(next);
    startTransition(async () => {
      const res = await saveWritingCheckpointsAction({
        x_account_id: xAccountId,
        checkpoint_ids: next,
      });
      if (res.status !== "success") {
        setIds(previous);
        toast.show({
          tone: "error",
          title: "保存できませんでした",
          description: res.message,
        });
        return;
      }
      setIds(res.checkpoint_ids ?? next);
      toast.show({
        tone: "success",
        title: "チェックポイントを保存しました",
        description: "次の生成から反映されます。",
      });
    });
  }

  const groups: WritingCheckpointGroup[] = ["ai", "buzz"];
  return (
    <section
      aria-labelledby="writing-checkpoints-heading"
      className="space-y-4"
    >
      <div>
        <h3
          className="text-[15px] font-bold text-ink"
          id="writing-checkpoints-heading"
        >
          書き方のチェックポイント
        </h3>
        <p className="mt-1 text-body leading-6 text-ink-2">
          チェックした条項は、生成のたびにアカウント.mdの末尾に「
          {WRITING_CHECKPOINTS_HEADING.replace(/^## /, "")}」として付いて AI
          へ渡ります。本文は変わらず、本文の文字数にも数えません。切り替えると自動で保存されます。
        </p>
      </div>
      {groups.map((group) => {
        const meta = WRITING_CHECKPOINT_GROUPS[group];
        const items = WRITING_CHECKPOINTS.filter((c) => c.group === group);
        const checkedCount = items.filter((c) => ids.includes(c.id)).length;
        return (
          <fieldset
            className="rounded-lg border border-hairline bg-surface p-4"
            key={group}
          >
            <legend className="px-1 text-body font-bold text-ink">
              {meta.title}
              <span className="ml-2 text-caption font-normal text-ink-3">
                {checkedCount}/{items.length}
              </span>
            </legend>
            <p className="mb-3 text-caption text-ink-3">{meta.lead}</p>
            <ul className="space-y-2">
              {items.map((item) => {
                const checked = ids.includes(item.id);
                return (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-black/[0.02]">
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? "border-brand bg-brand text-white"
                            : "border-hairline bg-white"
                        }`}
                      >
                        {checked ? <Icon name="check" size={14} /> : null}
                      </span>
                      <input
                        checked={checked}
                        className="sr-only"
                        disabled={pending}
                        name={`checkpoint-${item.id}`}
                        onChange={() => toggle(item.id)}
                        type="checkbox"
                      />
                      <span className="min-w-0">
                        <span className="block text-body font-medium text-ink">
                          {item.label}
                        </span>
                        <span className="block text-caption text-ink-3">
                          {item.description}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </section>
  );
}
