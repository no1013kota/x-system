"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { classifyTurnstileError } from "@/lib/auth/turnstile-errors";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      action: string;
      callback: (token: string) => void;
      /** Turnstile はエラーコード（例 "110200"）を渡してくる。捨てずに文言へ反映する。 */
      "error-callback": (code?: string) => void;
      "expired-callback": () => void;
      sitekey: string;
      /** `invisible` は利用者に何も見せない（疑わしいときだけCloudflareが割り込む）。 */
      size?: "invisible";
      theme: "auto";
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** スクリプトの読み込みを待つ上限。超えたら黙って空欄にせず、再読み込みを促す。 */
const SCRIPT_WAIT_MS = 15_000;

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileWidgetProps {
  action: "login" | "password-reset" | "signup" | "signup-resend";
  fieldError?: string;
  resetSignal: unknown;
  /**
   * 目に見えない形で確認する（T-M8-138・運営者の指示 2026-08-18）。
   *
   * **6桁コードを打つ画面にCloudflareのUIを出さない**ため。コード入力そのものには
   * 人間確認を求めていないのに、同じ画面の「コードを再送」にウィジェットが出ていると
   * 「コードを打つのに確認が要る」と読めてしまう。
   *
   * **確認そのものは残す。** Supabaseの `resend` はプロジェクトでcaptchaを有効にしていると
   * トークン無しでは拒否するため、外すと再送が壊れる。`size: "invisible"` は
   * 疑わしいときだけCloudflareが割り込み、通常は利用者に何も見せない。
   */
  invisible?: boolean;
}

export function TurnstileWidget({
  action,
  fieldError,
  resetSignal,
  invisible = false,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [token, setToken] = useState("");
  const [widgetError, setWidgetError] = useState("");
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  /**
   * `onReady` だけに依存しない（2026-07-31）。
   *
   * `next/script` は同じ `id` のスクリプトを内部でキャッシュするため、**読み込み中に unmount
   * されると次のマウントで `onReady` が発火しない**。ログイン画面で初期化が終わる前に
   * 「パスワードを忘れた方」へ遷移すると、再設定フォームのウィジェットが永久に描画されず
   * （iframeもトークンもエラーも無し）、申請ができなくなっていた（E2Eで30秒待っても復帰せず）。
   * そこで `window.turnstile` の存在自体も準備完了の合図として扱う。
   */
  useEffect(() => {
    if (scriptReady) return;
    // setState は必ずコールバック側で呼ぶ（effect本文での同期setStateは連鎖renderを招く）。
    const timer = setInterval(() => {
      if (window.turnstile) {
        setScriptReady(true);
        clearInterval(timer);
      }
    }, 100);
    // 読み込めないまま黙って空欄になるのを防ぐ（原因不明の行き止まりにしない）。
    const giveUp = setTimeout(() => {
      clearInterval(timer);
      if (!window.turnstile) {
        setWidgetError(
          "人間であることの確認を読み込めませんでした。ページを再読み込みしてください。",
        );
      }
    }, SCRIPT_WAIT_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [scriptReady]);

  useEffect(() => {
    if (!scriptReady || !siteKey || !containerRef.current || !window.turnstile) {
      return;
    }

    const turnstile = window.turnstile;
    widgetIdRef.current = turnstile.render(containerRef.current, {
      action,
      callback: (nextToken) => {
        setToken(nextToken);
        setWidgetError("");
      },
      "error-callback": (code) => {
        setToken("");
        // 設定の問題（ドメイン未許可など）で「もう一度お試しください」と出すと、直らない再試行を
        // 延々と繰り返させることになる。コードで種類を分ける（T-M7-48）。
        setWidgetError(classifyTurnstileError(code).message);
      },
      "expired-callback": () => {
        setToken("");
        setWidgetError(
          "人間であることの確認の有効期限が切れました。もう一度お試しください。",
        );
      },
      sitekey: siteKey,
      ...(invisible ? { size: "invisible" as const } : {}),
      theme: "auto",
    });

    return () => {
      if (widgetIdRef.current) turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [action, invisible, scriptReady, siteKey]);

  useEffect(() => {
    const widgetId = widgetIdRef.current;
    if (!widgetId || !window.turnstile) return;
    window.turnstile.reset(widgetId);
    setToken("");
  }, [resetSignal]);

  if (!siteKey) {
    return (
      <p className="text-sm text-destructive" role="alert">
        人間であることの確認を読み込めませんでした。
      </p>
    );
  }

  const error = fieldError ?? widgetError;

  return (
    <div className="space-y-2">
      <Script
        id="cloudflare-turnstile"
        onReady={() => setScriptReady(true)}
        src={TURNSTILE_SCRIPT_URL}
        strategy="afterInteractive"
      />
      <input name="captcha_token" type="hidden" value={token} />
      <div ref={containerRef} className={invisible ? undefined : "min-h-16"} />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
