import type { NextConfig } from "next";

/**
 * Dual-mode config:
 *
 * - Default (dev / self-hosted): `standalone` output as before.
 * - `STATIC_EXPORT=1` (GitHub Pages CI): fully static export served from a
 *   project path (`https://mpem1.github.io/spectra/`), so `basePath` must
 *   match the repo name and every image must be unoptimized.
 */
const isStaticExport = process.env.STATIC_EXPORT === "1";

/** Must match the GitHub repo name (GitHub Pages serves project sites at /<repo>/). */
const REPO_NAME = "spectra";

const sharedConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  devIndicators: false,
};

const nextConfig: NextConfig = isStaticExport
  ? {
      ...sharedConfig,
      output: "export",
      basePath: `/${REPO_NAME}`,
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {
      ...sharedConfig,
      output: "standalone",
    };

export default nextConfig;
