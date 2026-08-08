"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * LP（SC-01）のスクロール出現。design_handoff_space_ai_lp/README.md §インタラクション:
 * 初期 opacity:0 / translateY(16px)、視界に入ったら delay(ms) 後に .65s で表示する。
 *
 * `prefers-reduced-motion: reduce` では JS の状態に関係なく **CSS（motion-reduce:）で即時表示**する。
 * JSが動くまで内容は透明のままなので、この部品を使ってよいのはLPの演出だけ
 * （アプリ画面の情報を包むと、hydration前に読めない画面ができる）。
 */
export function Reveal({
  delay = 0,
  className,
  children,
}: {
  /** 視界に入ってから表示するまでのstagger（ms）。参照デザインの data-reveal 値。 */
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // IntersectionObserver が無い環境では演出を諦めて即時表示する（隠れたままが最悪）。
    if (typeof IntersectionObserver === "undefined") {
      timer = setTimeout(() => setShown(true), 0);
      return () => clearTimeout(timer);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          timer = setTimeout(() => setShown(true), delay);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -30px 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [delay]);

  return (
    <div
      className={cn(
        "transition-[opacity,transform] duration-[650ms] ease-[cubic-bezier(.2,.6,.2,1)]",
        shown || "translate-y-4 opacity-0",
        "motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none",
        className,
      )}
      data-reveal={delay}
      ref={ref}
    >
      {children}
    </div>
  );
}
