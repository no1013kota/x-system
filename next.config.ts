import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js dev logs include serialized Server Function arguments by default.
  // API keys and OAuth credentials must never be written to terminal logs.
  logging: { serverFunctions: false },
  // Local dev is served over http://127.0.0.1:3000 (X OAuth requires 127.0.0.1,
  // not localhost). Without this, Next dev treats 127.0.0.1 as cross-origin and
  // blocks the HMR WebSocket (/_next/webpack-hmr), which stalls client hydration
  // so forms and the Turnstile widget never become interactive. Dev-only setting.
  allowedDevOrigins: ["127.0.0.1"],
  // Blog articles live in `blog/*.md` and are read from the filesystem at request
  // time (T-M8-184). Vercel's output tracing only bundles files it can see from
  // static imports, so list them explicitly for the routes that read them.
  // Without this, production silently serves an empty blog while dev works.
  outputFileTracingIncludes: {
    "/blog": ["./blog/**/*.md"],
    "/blog/[slug]": ["./blog/**/*.md"],
  },
};

export default nextConfig;
