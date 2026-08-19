"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

type IntentPrefetchLinkProps = ComponentProps<typeof Link>;

/**
 * Keeps Next.js automatic partial prefetching by default, then upgrades only a hovered,
 * focused, or touched destination to a full-route prefetch. This uses the short intent window
 * before a click without querying every unvisited screen at once (T-M8-154).
 */
export function IntentPrefetchLink({
  onFocus,
  onMouseEnter,
  onTouchStart,
  prefetch,
  ...props
}: IntentPrefetchLinkProps) {
  const [hasIntent, setHasIntent] = useState(false);
  const markIntent = () => setHasIntent(true);
  const resolvedPrefetch = prefetch === false ? false : hasIntent ? true : prefetch;

  return (
    <Link
      {...props}
      onFocus={(event) => {
        onFocus?.(event);
        if (!event.defaultPrevented) markIntent();
      }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        if (!event.defaultPrevented) markIntent();
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event);
        if (!event.defaultPrevented) markIntent();
      }}
      prefetch={resolvedPrefetch}
    />
  );
}
