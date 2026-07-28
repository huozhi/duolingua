/**
 * The dictionary, read from disk.
 *
 * This is the only consumer of the shards: the browser asks `/api/analyze` rather
 * than downloading them, so they live in `data/dict` and are never web-served. The
 * loader is injected into `createDictStore`, which is why the same parser serves
 * the API routes, the CLI and the tests.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDictStore, type DictManifest, type DictStore } from "../lib/dict-store.ts";

/**
 * `process.cwd()` is the project root under `next dev`, `next start` and the
 * standalone server alike, so one path works everywhere.
 */
const DICT_DIR = join(process.cwd(), "data", "dict");

let store: DictStore | null = null;
let manifest: Promise<DictManifest> | null = null;

export function dictStore(): DictStore {
  store ??= createDictStore(async (name) => {
    try {
      return await readFile(join(DICT_DIR, name));
    } catch {
      // A missing shard is a legitimate "no entries here", not an error.
      return null;
    }
  });
  return store;
}

export function dictManifest(): Promise<DictManifest> {
  manifest ??= readFile(join(DICT_DIR, "manifest.json"), "utf8").then(
    (json) => JSON.parse(json) as DictManifest,
  );
  return manifest;
}
