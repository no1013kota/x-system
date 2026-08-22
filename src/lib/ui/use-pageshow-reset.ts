"use client";

import { useEffect } from "react";

/**
 * bfcache復元でボタンの「開いています…」が残る問題の対策（T-M8-212）。
 *
 * Stripe等へ `location.href` で遷移した後にブラウザの「戻る」で復帰すると、
 * ブラウザはページを**bfcacheからstateごと復元する**ため、pending=true のまま
 * ボタンが永久に押せなかった。`pageshow` の `persisted` が復元の合図なので、
 * そこでpendingを解除する（新規読み込み時は state 自体が初期化されるので何もしない）。
 */
export function usePageshowReset(reset: () => void): void {
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
    // resetはsetStateで安定参照の想定。依存に入れると呼び出し側へuseCallbackを強いる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
