import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Self-hosted and desktop builds copy the standalone server. Vercel's
   * framework builder performs its own output tracing and packaging; asking it
   * to create a second standalone bundle can make its post-build collector look
   * for `.next/next-server.js.nft.json` after that file has already moved.
   */
  output: process.env.VERCEL ? undefined : "standalone",

  /**
   * Translation runs on the server, and `onnxruntime-node` loads a native `.node`
   * binding — bundling either package breaks that. Keeping them external leaves
   * them as plain `require`s that resolve at runtime.
   */
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],

  /**
   * Tracing finds `onnxruntime_binding.node` but not the shared library sitting
   * next to it, which that binding dlopens — so the standalone server starts and
   * then fails on its first translation with "Library not loaded". Pin the whole
   * directory for the platforms we run on; Windows binaries (124MB) are skipped.
   */
  outputFileTracingIncludes: {
    // Only this build's platform and architecture: the package ships binaries for
    // five of them, and shipping the other four would add ~110MB to the image.
    // The package override pins 1.23.2 for Intel compatibility; naming that exact
    // version also avoids tracing Transformers' unused 1.24.3 declaration.
    "/api/translate": [
      `./node_modules/.pnpm/onnxruntime-node@1.23.2/node_modules/onnxruntime-node/bin/napi-v6/${process.platform}/${process.arch}/**`,
    ],
  },
};

export default nextConfig;
