"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      action: string;
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      sitekey: string;
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

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileWidgetProps {
  action: "login" | "password-reset" | "signup" | "signup-resend";
  fieldError?: string;
  resetSignal: unknown;
}

export function TurnstileWidget({
  action,
  fieldError,
  resetSignal,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [token, setToken] = useState("");
  const [widgetError, setWidgetError] = useState("");
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

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
      "error-callback": () => {
        setToken("");
        setWidgetError(
          "セキュリティ確認を完了できませんでした。もう一度お試しください。",
        );
      },
      "expired-callback": () => {
        setToken("");
        setWidgetError(
          "セキュリティ確認の有効期限が切れました。もう一度お試しください。",
        );
      },
      sitekey: siteKey,
      theme: "auto",
    });

    return () => {
      if (widgetIdRef.current) turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [action, scriptReady, siteKey]);

  useEffect(() => {
    const widgetId = widgetIdRef.current;
    if (!widgetId || !window.turnstile) return;
    window.turnstile.reset(widgetId);
    setToken("");
  }, [resetSignal]);

  if (!siteKey) {
    return (
      <p className="text-sm text-destructive" role="alert">
        セキュリティ確認を読み込めませんでした。
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
      <div ref={containerRef} className="min-h-16" />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
