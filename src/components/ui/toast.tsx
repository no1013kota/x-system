"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Icon } from "@/components/ui/icon";
import {
  AUTO_DISMISS_MS,
  toastRole,
  toastShouldAutoDismiss,
  type ToastTone,
} from "./toast-policy";

/**
 * トースト（T-1/T-2・デザイン §補助画面 T）。
 *
 * ## なぜ1か所に集約するか
 *
 * これまで操作の結果は各画面がインラインの `role="alert"` で出しており、**同じ画面に複数の
 * alert が並び得る**状態だった。読み上げ環境では後から出た方に割り込まれ、Playwright の
 * strict mode でも1要素に絞れない。通知の出口をここへ1本化する。
 *
 * ## 種別と読み上げ
 *
 * - 成功: `role="status"`（polite）。**5秒で自動的に消える**。
 * - 失敗: `role="alert"`（assertive）。**自動では消さない**——エラーを見逃させないため、
 *   利用者が閉じるまで残す（デザイン §T-1/T-2）。
 */

export interface ToastInput {
  tone: ToastTone;
  title: string;
  /** 補足。省略可。 */
  description?: string;
  /** 追加の導線（「設定画面へ」など）。 */
  action?: { href: string; label: string };
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * トーストを出す。**Provider の外で呼んでも落ちない**（何も表示しないだけ）。
 * 画面の一部だけを差し替える途中の状態でも、呼び出し側を壊さないため。
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  const noop = useMemo<ToastApi>(() => ({ show: () => {} }), []);
  return ctx ?? noop;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    // **同時に出すのは1件だけ。** 複数を積むと読み上げが競合し、画面も埋まる。
    // 後から出たものを優先する（利用者の最後の操作の結果が一番知りたいもの）。
    setItems([{ ...input, id }]);
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {items.map((item) => (
          <ToastCard item={item} key={item.id} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    // 判断は toast-policy 側（単体テストで固定してある）。
    if (!toastShouldAutoDismiss(item.tone)) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.tone, onDismiss]);

  const success = item.tone === "success";
  const role = toastRole(item.tone);
  return (
    <div
      aria-live={success ? "polite" : "assertive"}
      className="pointer-events-auto flex w-[380px] max-w-[calc(100vw-2rem)] gap-3 overflow-hidden rounded-card border border-hairline bg-surface p-3.5 shadow-[var(--shadow-modal)]"
      data-testid="toast"
      role={role}
    >
      {/* 左端の3pxカラーバー（デザイン §T-1/T-2） */}
      <span
        aria-hidden="true"
        className={`-my-3.5 -ml-3.5 w-[3px] shrink-0 ${success ? "bg-success-icon" : "bg-danger-fg"}`}
      />
      <Icon
        className={success ? "mt-0.5 text-success-icon" : "mt-0.5 text-danger-fg"}
        filled={success}
        name={success ? "check_circle" : "error"}
        size={18}
      />
      <div className="min-w-0 flex-1">
        <p className="text-body font-bold text-ink">{item.title}</p>
        {item.description ? (
          <p className="mt-0.5 text-caption leading-4 text-ink-2">{item.description}</p>
        ) : null}
        {item.action ? (
          <a
            className="mt-1 inline-block text-caption font-medium text-brand underline-offset-2 hover:underline"
            href={item.action.href}
          >
            {item.action.label}
          </a>
        ) : null}
      </div>
      <button
        aria-label="通知を閉じる"
        className="-mt-2 -mr-2 shrink-0 self-start rounded-card p-2 text-ink-3 transition-colors duration-150 hover:bg-black/[0.04] hover:text-ink"
        onClick={onDismiss}
        type="button"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export type { ToastTone };
