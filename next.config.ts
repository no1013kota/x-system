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
  // static analysis, so list them explicitly for the routes that read them.
  // Without this, production silently serves an empty blog while dev works.
  // Keys are picomatch globs matched with `contains: true` against the route path
  // (next/dist/build/collect-build-traces.js), so "/blog" also covers "/blog/[slug]".
  // Do NOT write "/blog/[slug]" as a key: picomatch reads `[slug]` as a character class.
  // `npm run check:blog-trace` (in release:check) verifies the build output.
  outputFileTracingIncludes: {
    // Only published articles are read at runtime (blog/published/ — T-M8-193).
    // Bundling all of blog/** would ship drafts to production functions.
    "/blog": ["./blog/published/**/*.md"],
    // doctor reports whether the articles made it into the deployment.
    "/api/cron/doctor": ["./blog/published/**/*.md"],
    // sharp（画像の正規化）のLinuxネイティブバイナリ（T-M8-230）。Turbopackはsharpを
    // 実行時externalにするが、出力トレースが@imgのoptional依存を拾わず、Vercel上で
    // 「libvips-cpp.so が無い」と画像生成が全滅した（2026-08-23・staging初スモークで検出。
    // ローカル/CIはmac・通常Linuxのnode_modulesで動くため原理的に見えない）。
    "/api/jobs/run": [
      "./node_modules/@img/sharp-linux-x64/**",
      "./node_modules/@img/sharp-libvips-linux-x64/**",
    ],
    "/api/cron/canary": [
      "./node_modules/@img/sharp-linux-x64/**",
      "./node_modules/@img/sharp-libvips-linux-x64/**",
    ],
  },
};

export default nextConfig;
