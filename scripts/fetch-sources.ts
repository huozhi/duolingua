/**
 * Download the raw dictionary sources into `data/raw/`, skipping anything that
 * is already there. Run before `build-dict.ts`.
 *
 *   node scripts/fetch-sources.ts [--force]
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { RAW_DIR, SOURCES, type Source } from "./sources.ts";

const force = process.argv.includes("--force");

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function download(source: Source): Promise<number> {
  const target = join(RAW_DIR, source.file);
  const existing = await sizeOf(target);

  if (existing !== null && !force) {
    console.log(`  ✓ ${source.file} already present (${mb(existing)})`);
    return existing;
  }

  console.log(`  ↓ ${source.file} from ${source.url}`);
  const res = await fetch(source.url);
  if (!res.ok || !res.body) throw new Error(`${source.url} → HTTP ${res.status}`);

  // Stream to disk: the Wiktionary extract is 300MB and should not be buffered.
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(target));

  const size = (await sizeOf(target)) ?? 0;
  console.log(`  ✓ ${source.file} (${mb(size)})`);
  return size;
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  console.log(`Fetching ${SOURCES.length} sources into data/raw/`);

  const provenance = [];
  for (const source of SOURCES) {
    const bytes = await download(source);
    provenance.push({ ...source, bytes, fetchedAt: new Date().toISOString() });
  }

  // Written for the /licenses page and for reproducibility: which snapshot of
  // each collaboratively-edited source this build was made from.
  await writeFile(
    join(RAW_DIR, "..", "SOURCES.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  console.log("Wrote data/SOURCES.json");
}

await main();
