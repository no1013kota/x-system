"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { rollbackBaseMdAction } from "@/app/actions/base-md";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import type { BaseMdVersionView } from "@/lib/base-md";
import { formatJst } from "@/lib/format";

/**
 * アカウント.mdの変更履歴とロールバック（M-1・要件06 §9）。
 *
 * **本文の編集本体からは切り離してある**（T-M8-332）。本文は本棚
 * （`PromptPresetManager`）が扱うようになり、履歴はそのうち「使用中」の1件に対する
 * 記録だけを示す。学習の反映・アカウント設定の保存もここへ版として残るので、
 * **どこから変わったのかを1か所で追える**（原則2）。
 */

const CHANGE_SOURCE_LABEL: Record<string, string> = {
  settings: "アカウント設定",
  learning: "学習反映",
  manual: "手動編集",
  rollback: "ロールバック",
};

export function BaseMdHistory({
  currentVersion,
  history: initialHistory,
  learningRunning,
  xAccountId,
}: {
  currentVersion: number;
  history: BaseMdVersionView[];
  learningRunning: boolean;
  xAccountId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [version, setVersion] = useState(currentVersion);
  const history = initialHistory;

  function rollback(target: number) {
    startTransition(async () => {
      const res = await rollbackBaseMdAction({
        x_account_id: xAccountId,
        version: target,
        expected_version: version,
      });
      if (res.status === "success" && res.version !== undefined) {
        setVersion(res.version);
        toast.show({
          tone: "success",
          title: `version ${target} の内容で version ${res.version} を作成しました`,
          description: "使用中のアカウント.mdもこの内容に戻りました。",
        });
        router.refresh();
        return;
      }
      toast.show({
        tone: "error",
        title: "戻せませんでした",
        description: res.message ?? "時間をおいてもう一度お試しください。",
      });
    });
  }

  return (
    <section>
      <CardTitle>変更履歴（使用中のアカウント.md・現在 version {version}）</CardTitle>
      {history.length === 0 ? (
        <p className="mt-2 rounded-card border border-hairline bg-page px-4 py-8 text-center text-body text-ink-3">
          まだ履歴はありません。
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {history.map((h) => (
            <li
              className="flex flex-wrap items-center gap-2 rounded-card border border-hairline bg-surface p-4"
              key={h.version}
            >
              <Badge>v{h.version}</Badge>
              <Badge>{CHANGE_SOURCE_LABEL[h.changeSource] ?? h.changeSource}</Badge>
              {h.summary ? <span className="text-caption text-ink-3">{h.summary}</span> : null}
              <span className="ml-auto text-caption text-ink-3">{formatJst(h.createdAt)}</span>
              {h.version !== version ? (
                <Button
                  disabled={pending || learningRunning}
                  onClick={() => rollback(h.version)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  この版へ戻す
                </Button>
              ) : (
                <span className="text-caption text-ink-3">現在</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
