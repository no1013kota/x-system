import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js dev logs include serialized Server Function arguments by default.
  // API keys and OAuth credentials must never be written to terminal logs.
  logging: { serverFunctions: false },
};

export default nextConfig;
