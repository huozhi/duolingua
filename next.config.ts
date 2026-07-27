import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Self-contained server output, which is what the Dockerfile copies. */
  output: "standalone",

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
    "/api/translate": [
      `./node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v6/${process.platform}/${process.arch}/**`,
    ],
  },
};

export default nextConfig;
