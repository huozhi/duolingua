/**
 * On-disk format for the offline dictionary.
 *
 * The dictionary is split into two families of gzipped, sharded text files:
 *
 *   w-000.txt.gz … w-255.txt.gz   lemma → glosses in en/es/zh
 *   f-000.txt.gz … f-255.txt.gz   inflected form → lemma + grammatical features
 *
 * Both are plain TSV so that a shard can be parsed with `split` rather than a
 * JSON parse, and so the artifacts stay diffable and inspectable. gzip (not
 * brotli) because `DecompressionStream('gzip')` exists in every browser, which
 * means the files can be served by any dumb static host with no
 * `Content-Encoding` negotiation to get wrong.
 *
 * Serialization lives here; `build-dict.ts` writes through these helpers and
 * `dictStore.ts` reads through them, so the two can never drift apart.
 */

import { emptyGlosses, type Case, type Gender, type GrammaticalNumber, type Gloss, type Glosses, type Person, type Pos, type Target } from "./analysis.ts";

export const SHARD_COUNT = 256;

/** Prefix of each shard family, used to build filenames. */
export const WORD_SHARD = "w";
export const FORM_SHARD = "f";

/**
 * FNV-1a, 32-bit. Any stable hash works; this one is four lines and produces an
 * even spread over 256 buckets for German word lists.
 */
export function shardOf(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % SHARD_COUNT;
}

export function shardName(family: string, index: number): string {
  return `${family}-${String(index).padStart(3, "0")}.txt.gz`;
}

/** Lemmas are looked up case-insensitively; German capitalization is data, not identity. */
export function dictKey(word: string): string {
  return word.toLocaleLowerCase("de-DE");
}

// ---------------------------------------------------------------------------
// Grammatical features
// ---------------------------------------------------------------------------

/**
 * A single grammatical reading of an inflected form. A form usually has several
 * — `guten` is accusative singular masculine *and* dative plural *and* more —
 * which is exactly why we keep them as a list and let the tagger narrow down.
 */
export type Features = {
  case?: Case;
  number?: GrammaticalNumber;
  person?: Person;
  /** Tense or mood, already normalized to the labels the UI shows. */
  tense?: string;
  degree?: "comparative" | "superlative";
  gender?: Gender;
};

/**
 * Features are encoded as concatenated two-character tokens: `CnNsGm` is
 * nominative singular masculine. Two chars rather than one keeps the codes
 * self-describing when you `zcat` a shard, and gzip reduces the repetition to
 * nearly nothing anyway.
 */
const CASE_CODES: Record<string, Case> = {
  Cn: "nominative",
  Cg: "genitive",
  Cd: "dative",
  Ca: "accusative",
};

const NUMBER_CODES: Record<string, GrammaticalNumber> = {
  Ns: "singular",
  Np: "plural",
};

const PERSON_CODES: Record<string, Person> = { P1: "1", P2: "2", P3: "3" };

const TENSE_CODES: Record<string, string> = {
  Tp: "present",
  Tt: "Präteritum",
  Tk: "Konjunktiv I",
  Tj: "Konjunktiv II",
  Ti: "imperative",
  Tz: "Partizip II",
  Ty: "Partizip I",
  Tf: "infinitive",
};

const DEGREE_CODES: Record<string, "comparative" | "superlative"> = {
  Dc: "comparative",
  Du: "superlative",
};

const GENDER_CODES: Record<string, Gender> = {
  Gm: "masculine",
  Gf: "feminine",
  Gn: "neuter",
};

const CODE_TABLES = [
  ["case", CASE_CODES],
  ["number", NUMBER_CODES],
  ["person", PERSON_CODES],
  ["tense", TENSE_CODES],
  ["degree", DEGREE_CODES],
  ["gender", GENDER_CODES],
] as const;

/** Reverse lookup: feature field + value → two-character code. */
const ENCODE = new Map<string, string>();
for (const [field, table] of CODE_TABLES) {
  for (const [code, value] of Object.entries(table)) ENCODE.set(`${field}:${value}`, code);
}

export function encodeFeatures(features: Features): string {
  let out = "";
  for (const [field] of CODE_TABLES) {
    const value = features[field as keyof Features];
    if (value === undefined) continue;
    out += ENCODE.get(`${field}:${value}`) ?? "";
  }
  return out;
}

export function decodeFeatures(code: string): Features {
  const features: Features = {};
  for (let i = 0; i + 1 < code.length; i += 2) {
    const token = code.slice(i, i + 2);
    for (const [field, table] of CODE_TABLES) {
      const value = (table as Record<string, string>)[token];
      if (value !== undefined) {
        // @ts-expect-error — field/value pairs are matched by construction above.
        features[field] = value;
        break;
      }
    }
  }
  return features;
}

// ---------------------------------------------------------------------------
// Word shards: lemma → glosses
// ---------------------------------------------------------------------------

export type WordEntry = {
  /** The lemma with its original capitalization (`Buch`, not `buch`). */
  lemma: string;
  pos: Pos;
  gender: Gender | null;
  glosses: Glosses;
};

/**
 * Field and list separators. Any of these appearing inside source data is
 * replaced with a space at build time — see `sanitize`.
 */
const FIELD = "\t";
const LIST = ";";
const SUB = "|";

/** Strip the characters our TSV uses as structure, plus collapse whitespace. */
export function sanitize(value: string): string {
  return value.replace(/[\t\n\r;|]+/g, " ").replace(/\s+/g, " ").trim();
}

export function encodeWordLine(entry: WordEntry): string {
  const gloss = (target: Target) =>
    entry.glosses[target]
      .map((g) => (g.pinyin ? `${sanitize(g.text)}${SUB}${sanitize(g.pinyin)}` : sanitize(g.text)))
      .join(LIST);

  return [
    entry.lemma,
    entry.pos,
    entry.gender ?? "",
    gloss("en"),
    gloss("es"),
    gloss("zh"),
  ].join(FIELD);
}

export function parseWordLine(line: string): WordEntry | null {
  const [lemma, pos, gender, en, es, zh] = line.split(FIELD);
  if (!lemma || !pos) return null;

  const glosses = emptyGlosses();
  glosses.en = parseGlossList(en);
  glosses.es = parseGlossList(es);
  glosses.zh = parseGlossList(zh);

  return {
    lemma,
    pos: pos as Pos,
    gender: (gender || null) as Gender | null,
    glosses,
  };
}

function parseGlossList(field: string | undefined): Gloss[] {
  if (!field) return [];
  return field.split(LIST).flatMap((item) => {
    const [text, pinyin] = item.split(SUB);
    if (!text) return [];
    return [pinyin ? { text, pinyin } : { text }];
  });
}

// ---------------------------------------------------------------------------
// Form shards: inflected form → lemma
// ---------------------------------------------------------------------------

export type FormAnalysis = {
  lemma: string;
  pos: Pos;
  /** Every grammatical reading of this form under this lemma. */
  readings: Features[];
};

/** Like `FormAnalysis`, but with readings already reduced to feature codes. */
export type EncodedFormAnalysis = { lemma: string; pos: Pos; codes: string[] };

/**
 * The primitive writer. The build script deduplicates readings as code strings
 * (a `Set<string>` is the natural way to do that), so it encodes at this level;
 * `encodeFormLine` is the same thing starting from structured features.
 */
export function encodeFormLineFromCodes(form: string, analyses: EncodedFormAnalysis[]): string {
  const encoded = analyses
    .map((a) => [a.lemma, a.pos, a.codes.filter(Boolean).join(",")].join(SUB))
    .join(LIST);
  return `${form}${FIELD}${encoded}`;
}

export function encodeFormLine(form: string, analyses: FormAnalysis[]): string {
  return encodeFormLineFromCodes(
    form,
    analyses.map((a) => ({ lemma: a.lemma, pos: a.pos, codes: a.readings.map(encodeFeatures) })),
  );
}

export function parseFormLine(line: string): { form: string; analyses: FormAnalysis[] } | null {
  const tab = line.indexOf(FIELD);
  if (tab < 1) return null;
  const form = line.slice(0, tab);

  const analyses = line
    .slice(tab + 1)
    .split(LIST)
    .flatMap((chunk) => {
      const [lemma, pos, codes] = chunk.split(SUB);
      if (!lemma || !pos) return [];
      const readings = (codes ?? "").split(",").filter(Boolean).map(decodeFeatures);
      return [{ lemma, pos: pos as Pos, readings }];
    });

  return analyses.length ? { form, analyses } : null;
}
