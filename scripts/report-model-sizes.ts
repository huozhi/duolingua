/**
 * Verify that every translation model is present and report the payload that
 * will be copied into a deployment image.
 *
 *   pnpm models:size
 *   MODEL_CACHE_DIR=/models node scripts/report-model-sizes.ts
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { ALL_MODELS } from "../src/lib/mt-models.ts";

const cacheDir = process.env.MODEL_CACHE_DIR ?? ".cache";

async function directorySize(path: string): Promise<number> {
  let size = 0;

  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);

    if (entry.isDirectory()) {
      size += await directorySize(entryPath);
    } else if (entry.isFile()) {
      size += (await stat(entryPath)).size;
    }
  }

  return size;
}

function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

console.log(`Translation model payload in ${cacheDir}:`);

let total = 0;
for (const model of ALL_MODELS) {
  const path = join(cacheDir, model);

  try {
    const size = await directorySize(path);
    if (size === 0) throw new Error("directory is empty");

    total += size;
    console.log(`  ${model.padEnd(27)} ${mib(size)}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Model ${model} is not ready at ${path}: ${reason}`);
  }
}

console.log(`Total model payload: ${mib(total)} (${total.toLocaleString("en-US")} bytes)`);
