/**
 * Download the translation models into the local cache.
 *
 *   pnpm models:fetch
 *   MODEL_CACHE_DIR=/models node scripts/fetch-models.ts
 *
 * Run by the Dockerfile so the image ships with weights and the container never
 * needs the network. Useful locally too, before going offline or to keep the
 * first request of a session fast.
 */

import { ALL_MODELS } from "../src/lib/mtModels.ts";
import { loadAllModels } from "../src/server/mt.ts";

const cacheDir = process.env.MODEL_CACHE_DIR ?? ".cache";
console.log(`Fetching ${ALL_MODELS.length} models into ${cacheDir}`);
console.log("(~110MB each; German → English is shared by English and Chinese)\n");

const started = Date.now();

await loadAllModels((model, index, total) => {
  console.log(`  ${index + 1}/${total} ${model}`);
});

console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(0)}s.`);
