/**
 * Reads the sharded dictionary written by `scripts/build-dict.ts`.
 *
 * Shard loading is injected rather than hardcoded, so the same parser serves the
 * API routes, the CLI and the tests — there is exactly one implementation of the
 * read path, and it is the one the app runs on.
 *
 * Decompression uses `DecompressionStream` rather than `node:zlib`, which keeps
 * this module free of Node built-ins and therefore safe to import anywhere.
 */

import {
  FORM_SHARD,
  WORD_SHARD,
  dictKey,
  parseFormLine,
  parseWordLine,
  shardName,
  shardOf,
  type FormAnalysis,
  type WordEntry,
} from "./dict-format.ts";

/** Returns the raw gzipped bytes of a shard, or null if it does not exist. */
export type ShardLoader = (name: string) => Promise<Uint8Array | null>;

export type DictManifest = {
  version: string;
  generatedAt: string;
  shardCount: number;
  families: Record<string, { files: number; lines: number; bytes: number }>;
  coverage: { lemmas: number; en: number; es: number; zh: number };
  sources: {
    id: string;
    title: string;
    url: string;
    license: string;
    licenseUrl: string;
    attribution: string;
    use: string;
  }[];
};

export type DictStore = {
  /** All dictionary entries for a lemma, one per part of speech. */
  lookupWord(word: string): Promise<WordEntry[]>;
  /** All lemmas an inflected form could belong to, with their grammatical readings. */
  lookupForm(form: string): Promise<FormAnalysis[]>;
};

export function createDictStore(load: ShardLoader): DictStore {
  // Shard name → key → lines. Parsed once, then kept for the session; a shard is
  // ~30KB of text, and a sentence typically touches a dozen of them.
  const shards = new Map<string, Promise<Map<string, string[]>>>();

  function shard(family: string, key: string): Promise<Map<string, string[]>> {
    const name = shardName(family, shardOf(key));
    let pending = shards.get(name);
    if (!pending) {
      pending = loadShard(load, name);
      shards.set(name, pending);
    }
    return pending;
  }

  async function linesFor(family: string, raw: string): Promise<string[]> {
    const key = dictKey(raw);
    const lines = (await shard(family, key)).get(key) ?? [];
    return withoutAcronymNoise(raw, lines);
  }

  return {
    async lookupWord(word) {
      const lines = await linesFor(WORD_SHARD, word);
      return lines.map(parseWordLine).filter((entry): entry is WordEntry => entry !== null);
    },

    async lookupForm(form) {
      const lines = await linesFor(FORM_SHARD, form);
      return lines.flatMap((line) => parseFormLine(line)?.analyses ?? []);
    },
  };
}

/**
 * Keys are case-folded so that a sentence-initial `Der` finds `der`. The side
 * effect is that an ordinary lowercase word also matches an all-caps abbreviation
 * that happens to share its letters: `zum` matches `ZUM` (an abbreviation of
 * `Busbahnhof`), and `das` matches `DAS`. Those readings are never intended, so
 * drop them.
 *
 * The trade-off is deliberate: a lowercase query for an abbreviation now finds
 * nothing rather than something. `ARD` still resolves, `ard` no longer does — a
 * fair price for `zum` not offering "bus terminal" as a reading.
 */
function withoutAcronymNoise(query: string, lines: string[]): string[] {
  if (isAllCaps(query)) return lines;
  return lines.filter((line) => !isAllCaps(line.slice(0, line.indexOf("\t"))));
}

function isAllCaps(word: string): boolean {
  return (
    word.length > 1 &&
    /\p{L}/u.test(word) &&
    word === word.toLocaleUpperCase("de-DE") &&
    word !== word.toLocaleLowerCase("de-DE")
  );
}

async function loadShard(load: ShardLoader, name: string): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  const gz = await load(name);
  if (!gz) return index;

  const text = await gunzip(gz);
  for (const line of text.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    const key = dictKey(line.slice(0, tab));
    const bucket = index.get(key);
    if (bucket) bucket.push(line);
    else index.set(key, [line]);
  }
  return index;
}

/**
 * Decompress a shard, unless the host already did.
 *
 * Shards are stored gzipped and normally arrive that way. But some static hosts
 * map `.gz` to `Content-Encoding: gzip`, in which case the browser transparently
 * decompresses and we are handed plain text — so check the gzip magic number
 * rather than assuming. Cheaper than a deployment that fails only in production.
 */
async function gunzip(bytes: Uint8Array): Promise<string> {
  const isGzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzipped) return new TextDecoder().decode(bytes);

  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
