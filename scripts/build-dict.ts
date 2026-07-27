/**
 * Build the offline dictionary shards in `public/dict/` from the raw sources in
 * `data/raw/`.
 *
 *   node --max-old-space-size=8192 scripts/build-dict.ts
 *
 * Shape of the work:
 *
 *  1. Read the frequency list, so we can decide what is worth shipping.
 *  2. Stream the Wiktionary extract once. German entries come in two kinds:
 *     lemma entries (`Substantiv`, `Verb`, …) carrying translations and an
 *     inflection table, and dedicated inflected-form entries (`Deklinierte
 *     Form`, `Konjugierte Form`, …) carrying a `form_of` pointer. We collect
 *     both.
 *  3. Invert HanDeDict to get German → Chinese, because Wiktionary's Chinese
 *     coverage is thin (~6k German lemmas, versus ~80k for English).
 *  4. Keep lemmas that are either frequent or actually translatable, then emit
 *     gzipped TSV shards through `src/lib/dictFormat.ts`.
 *
 * Deliberate size trade-off: adjective declensions are *not* stored. German
 * adjective endings are a closed set (-e -en -em -er -es) and stripping them at
 * runtime is exact enough, which removes ~850k rows for ~15 lines of code.
 * Noun plurals and verb stems are irregular, so those are stored in full.
 */

import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  FORM_SHARD,
  SHARD_COUNT,
  WORD_SHARD,
  dictKey,
  encodeFeatures,
  encodeFormLineFromCodes,
  encodeWordLine,
  sanitize,
  shardName,
  shardOf,
  type Features,
} from "../src/lib/dictFormat.ts";
import {
  emptyGlosses,
  type Case,
  type Gender,
  type Gloss,
  type GrammaticalNumber,
  type Person,
  type Pos,
  type Target,
} from "../src/lib/analysis.ts";
import { toDiacriticPinyin } from "./pinyin.ts";
import { OUT_DIR, RAW_DIR, SOURCES } from "./sources.ts";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Maximum gloss candidates kept per language, per lemma. */
const MAX_GLOSSES = 3;
/** Maximum grammatical readings kept per (form, lemma) pair. */
const MAX_READINGS = 8;
/** A translation longer than this is an explanation, not a gloss. */
const MAX_GLOSS_LENGTH = 40;

/** Separable prefixes, so `stehe auf` can be indexed as a form of `aufstehen`. */
const SEPARABLE_PARTICLES = new Set([
  "ab", "an", "auf", "aus", "bei", "da", "dabei", "dar", "durch", "ein", "empor", "entgegen",
  "entlang", "fort", "gegenüber", "her", "herab", "heran", "herauf", "heraus", "herbei", "herein",
  "herum", "herunter", "hervor", "hin", "hinab", "hinauf", "hinaus", "hinein", "hinter", "hinunter",
  "hinzu", "los", "mit", "nach", "nieder", "über", "um", "unter", "vor", "voran", "vorbei", "vorüber",
  "weg", "weiter", "wieder", "zu", "zurecht", "zurück", "zusammen",
]);

// ---------------------------------------------------------------------------
// Wiktionary → our vocabulary
// ---------------------------------------------------------------------------

const POS_MAP: Record<string, Pos> = {
  noun: "noun",
  name: "noun",
  verb: "verb",
  adj: "adjective",
  adv: "adverb",
  pron: "pronoun",
  prep: "preposition",
  conj: "conjunction",
  num: "numeral",
  particle: "particle",
  intj: "interjection",
  det: "article",
  article: "article",
};

const GENDER_TAGS: Record<string, Gender> = {
  masculine: "masculine",
  feminine: "feminine",
  neuter: "neuter",
};

const CASE_FROM_TAG: Record<string, Case> = {
  nominative: "nominative",
  genitive: "genitive",
  dative: "dative",
  accusative: "accusative",
};

const GENDER_FROM_TAG: Record<string, Gender> = {
  masculine: "masculine",
  feminine: "feminine",
  neuter: "neuter",
};

/**
 * Tense and mood, most specific first. Order matters and `Object.assign` would
 * get it wrong: an infinitive is tagged `["active","infinitive","present"]`, and
 * whichever of `infinitive`/`present` was applied last would win by accident.
 */
const TENSE_BY_PRECEDENCE: [string, string][] = [
  ["participle-2", "Partizip II"],
  ["participle-1", "Partizip I"],
  ["imperative", "imperative"],
  ["subjunctive-ii", "Konjunktiv II"],
  ["subjunctive-i", "Konjunktiv I"],
  ["infinitive", "infinitive"],
  ["past", "Präteritum"],
  ["present", "present"],
];

/**
 * German Wiktionary's conjugation tables label the person by listing the pronoun
 * rather than tagging it, so `liest` arrives as `{tags:["present"],
 * pronouns:["er","sie","es"]}`. Reading only the tags leaves every verb without a
 * person, which is exactly the feature a learner is looking for.
 */
const PERSON_BY_PRONOUN: Record<string, { person: Person; number: GrammaticalNumber }> = {
  ich: { person: "1", number: "singular" },
  du: { person: "2", number: "singular" },
  er: { person: "3", number: "singular" },
  sie: { person: "3", number: "singular" },
  es: { person: "3", number: "singular" },
  wir: { person: "1", number: "plural" },
  ihr: { person: "2", number: "plural" },
  Sie: { person: "3", number: "plural" },
};

/**
 * Composite tenses ("werde lesen") and passives ("wird gelesen") are multiword,
 * so they are already dropped by `normalizeForm`; these tags only appear on
 * single words in combination with a participle tag, where they are redundant.
 * What is left here is material we genuinely do not want to teach.
 */
const SKIP_FORM_TAGS = new Set(["obsolete", "archaic"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FormRow = { form: string; features: Features[] };

type LemmaRecord = {
  lemma: string;
  pos: Pos;
  gender: Gender | null;
  /** Gloss candidates keyed by target, each tagged with the sense it came from. */
  candidates: Record<Target, { text: string; pinyin?: string; sense: string; order: number }[]>;
  forms: FormRow[];
  /** Best (lowest) frequency rank of the lemma or any of its forms; Infinity if unseen. */
  rank: number;
};

/** `pos` is null when the source entry did not say — resolve it from the lemma. */
type FormOfRow = { form: string; lemma: string; pos: Pos | null; features: Features };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GERMAN_WORD = /^[A-Za-zÄÖÜäöüßẞ][A-Za-zÄÖÜäöüß.-]*$/;

function isPlainGermanWord(value: string): boolean {
  return GERMAN_WORD.test(value);
}

/** `Nominativ Plural` → sortable: 1 before 1a before 2 before 10. */
function senseOrder(sense: string | undefined): number {
  if (!sense) return 9_999;
  const match = /^(\d+)([a-z]?)/.exec(sense);
  if (!match) return 9_998;
  return Number(match[1]) * 100 + (match[2] ? match[2].charCodeAt(0) - 96 : 0);
}

/**
 * Translations arrive with parenthetical hints (`phylum (neulateinisch)`) and
 * occasional bracketed notes. Strip those; reject anything left over that reads
 * as a sentence rather than a gloss.
 */
function cleanGloss(raw: string | undefined): string | null {
  const cleaned = sanitize(
    (raw ?? "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[…]/g, " ")
      // Unbalanced brackets survive the passes above — the Chinese gloss of `ja`
      // arrives as `對 ( =` — and so does the space Wiktionary leaves before
      // punctuation, as in `yes !`.
      .replace(/[()[\]{}=]/g, " ")
      .replace(/\s+([!?.,;:])/g, "$1"),
  );
  if (!cleaned || cleaned.length > MAX_GLOSS_LENGTH) return null;
  // A gloss reduced to punctuation carries nothing.
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;
  return cleaned;
}

/**
 * A single translation field often holds a whole list.
 *
 * German Wiktionary writes the translations of a polysemous word as one string
 * with sense references inline — `gehen` yields
 * `"walk ; [1–3, 7, 13] go ; [2] leave ; [4] work , be operable"`. Treated as one
 * gloss it collapses into "walk go leave work be operable", so the field has to
 * be split before anything else happens to it. This matters most for exactly the
 * words people look up most, since those are the ones with many senses.
 */
function splitGlossField(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s*;\s*/)
    // Spaced commas separate alternatives within one sense (`work , be operable`).
    // Unspaced commas are left alone, since they occur inside names.
    .flatMap((part) => part.split(/\s+,\s+/))
    .map(cleanGloss)
    .filter((gloss): gloss is string => gloss !== null);
}

/**
 * Wiktionary writes Chinese entries that differ between scripts as
 * `traditional / simplified` — `貓 / 猫`. We ship simplified, which by that
 * convention is the last part.
 */
function simplifiedOnly(text: string): string {
  const parts = text.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : text;
}

function targetOf(langCode: string | undefined): Target | null {
  if (langCode === "en") return "en";
  if (langCode === "es") return "es";
  // de.wiktionary splits Chinese into `zh`, `zh-cn` (simplified) and `zh-tw`
  // (traditional). We ship simplified, so `zh-tw` is ignored.
  if (langCode === "zh" || langCode === "zh-cn" || langCode === "cmn") return "zh";
  return null;
}

/**
 * Build a feature set from a form's tags and, for verbs, its `pronouns` list.
 * Returns null when nothing usable was found.
 */
function featuresFromTags(tags: string[] | undefined, pronouns?: string[]): Features | null {
  if (!tags?.length && !pronouns?.length) return null;
  if (tags?.some((t) => SKIP_FORM_TAGS.has(t))) return null;

  const features: Features = {};
  const has = (tag: string) => tags?.includes(tag) ?? false;

  for (const tag of tags ?? []) {
    features.case ??= CASE_FROM_TAG[tag];
    features.gender ??= GENDER_FROM_TAG[tag];
  }
  if (has("singular")) features.number = "singular";
  else if (has("plural")) features.number = "plural";

  if (has("first-person")) features.person = "1";
  else if (has("second-person")) features.person = "2";
  else if (has("third-person")) features.person = "3";

  for (const [tag, tense] of TENSE_BY_PRECEDENCE) {
    if (has(tag)) {
      features.tense = tense;
      break;
    }
  }

  if (has("comparative")) features.degree = "comparative";
  else if (has("superlative")) features.degree = "superlative";

  // The pronoun column is the only place a conjugation table states the person.
  // All three of `er`/`sie`/`es` mean third singular, so a row listing them is
  // unambiguous; a row mixing numbers is not, and is left alone.
  const agreements = (pronouns ?? [])
    // The column arrives either as ["er","sie","es"] or as one "er, sie, es".
    .flatMap((entry) => entry.split(/[,\s/]+/))
    .map((pronoun) => PERSON_BY_PRONOUN[pronoun])
    .filter(Boolean);
  if (agreements.length) {
    const persons = new Set(agreements.map((a) => a.person));
    const numbers = new Set(agreements.map((a) => a.number));
    if (persons.size === 1) features.person ??= [...persons][0];
    if (numbers.size === 1) features.number ??= [...numbers][0];
  }

  return Object.keys(features).length ? features : null;
}

/**
 * Inflected-form entries state person and number in prose rather than in tags:
 * "1. Person Singular Indikativ Präteritum Aktiv des Verbs sein". Reading it
 * matters for honesty as much as accuracy — without the person, `war` looks
 * unambiguously first-person, when it is first *or* third.
 */
function personFromGloss(gloss: string | undefined): Partial<Features> {
  if (!gloss) return {};
  const features: Partial<Features> = {};

  const person = /^([123])\.\s*Person/.exec(gloss);
  if (person) features.person = person[1] as Person;
  if (/\bSingular\b/.test(gloss)) features.number = "singular";
  else if (/\bPlural\b/.test(gloss)) features.number = "plural";

  return features;
}

/**
 * Reject features the entry's part of speech cannot bear.
 *
 * This is not paranoia: German Wiktionary keeps one `Flexion:` page per spelling,
 * so wiktextract hands the *adjective* `buchen` ("made of beechwood") the full
 * conjugation table of the *verb* `buchen` ("to book"). Without this filter the
 * dictionary ends up claiming an adjective has a 2nd-person present form.
 */
function featuresValidFor(pos: Pos, features: Features): boolean {
  const verbal = features.person !== undefined || features.tense !== undefined;
  const nominal = features.case !== undefined;

  switch (pos) {
    case "verb":
      // Participles decline, but those readings come from the participle's own entry.
      return !nominal;
    case "adjective":
    case "adverb":
      return !verbal;
    case "noun":
    case "pronoun":
    case "article":
    case "numeral":
      return !verbal && features.degree === undefined;
    default:
      return true;
  }
}

/**
 * A form is indexable if it is a single German word, or a separable-verb form
 * like `stehe auf` whose second token is a known particle.
 */
function normalizeForm(raw: string): string | null {
  const form = raw.replace(/[!?]$/, "").trim();
  if (!form) return null;
  if (isPlainGermanWord(form)) return form;

  const parts = form.split(/\s+/);
  if (parts.length === 2 && isPlainGermanWord(parts[0]) && SEPARABLE_PARTICLES.has(parts[1].toLowerCase())) {
    return form;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 1: frequency list
// ---------------------------------------------------------------------------

async function loadFrequency(): Promise<Map<string, number>> {
  const text = await readFile(join(RAW_DIR, "de_50k.txt"), "utf8");
  const ranks = new Map<string, number>();
  let rank = 0;
  for (const line of text.split("\n")) {
    const word = line.split(" ")[0]?.trim();
    if (!word) continue;
    const key = dictKey(word);
    if (!ranks.has(key)) ranks.set(key, rank++);
  }
  return ranks;
}

// ---------------------------------------------------------------------------
// Step 2: Wiktionary
// ---------------------------------------------------------------------------

type WiktEntry = {
  word?: string;
  pos?: string;
  pos_title?: string;
  lang_code?: string;
  tags?: string[];
  senses?: { glosses?: string[]; tags?: string[]; form_of?: { word?: string }[]; sense_index?: string }[];
  translations?: { word?: string; lang_code?: string; roman?: string; sense_index?: string }[];
  forms?: { form?: string; tags?: string[]; pronouns?: string[] }[];
};

async function readWiktionary(freq: Map<string, number>) {
  const lemmas = new Map<string, LemmaRecord[]>();
  const formOfRows: FormOfRow[] = [];
  let lines = 0;

  const stream = createReadStream(join(RAW_DIR, "dewiktionary-raw.jsonl.gz")).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    lines++;
    let entry: WiktEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.lang_code !== "de" || !entry.word) continue;

    const pos = POS_MAP[entry.pos ?? ""] ?? (entry.pos_title === "Kontraktion" ? "preposition" : null);

    // Inflected-form entries point at their lemma and carry no translations. Each
    // sense is one reading — `Buchen` is separately the nominative, genitive,
    // dative and accusative plural of `Buche`, so merging their tags would
    // collapse four correct readings into one wrong one.
    if (entry.senses?.some((s) => s.form_of?.length)) {
      const form = normalizeForm(entry.word);
      if (!form) continue;
      for (const sense of entry.senses) {
        const lemma = sense.form_of?.find((f) => f.word)?.word;
        if (!lemma || !isPlainGermanWord(lemma)) continue;
        const features = featuresFromTags(sense.tags) ?? {};
        Object.assign(features, personFromGloss(sense.glosses?.[0]));
        // `pos` is often `unknown` on these entries; resolved from the lemma later.
        formOfRows.push({ form, lemma, pos, features });

      }
      continue;
    }

    if (!pos || !isPlainGermanWord(entry.word)) continue;

    const record: LemmaRecord = {
      lemma: entry.word,
      pos,
      gender: entry.tags?.map((t) => GENDER_TAGS[t]).find(Boolean) ?? null,
      candidates: { en: [], es: [], zh: [] },
      forms: [],
      rank: freq.get(dictKey(entry.word)) ?? Infinity,
    };

    for (const translation of entry.translations ?? []) {
      const target = targetOf(translation.lang_code);
      if (!target) continue;

      const texts = splitGlossField(translation.word).map((text) =>
        target === "zh" ? simplifiedOnly(text) : text,
      );
      const pinyin = target === "zh" ? cleanGloss(translation.roman) ?? undefined : undefined;

      texts.forEach((text, position) => {
        record.candidates[target].push({
          text,
          // Pinyin only belongs to a single Chinese word; a packed field would
          // attach the first reading to all of them, which would be wrong.
          pinyin: texts.length === 1 ? pinyin : undefined,
          sense: translation.sense_index ?? "",
          // Keep the field's internal order below the sense ordering.
          order: senseOrder(translation.sense_index) + position / 100,
        });
      });
    }

    // Adjective declensions are recomputed at runtime; only the degree forms
    // (which are irregular — gut/besser/best) are worth storing.
    const keepDeclensions = pos !== "adjective";
    const seenForms = new Map<string, Features[]>();
    for (const raw of entry.forms ?? []) {
      if (!raw.form) continue;
      const features = featuresFromTags(raw.tags, raw.pronouns);
      if (!features) continue;
      if (!keepDeclensions && features.case) continue;
      if (!featuresValidFor(pos, features)) continue;

      // The lemma's own row is kept when it carries features: `Hund` is the
      // nominative singular of `Hund`, and without that row an uninflected noun
      // has no number or case at all to narrow its determiner against.
      const form = normalizeForm(raw.form);
      if (!form) continue;
      if (freq.has(dictKey(form))) record.rank = Math.min(record.rank, freq.get(dictKey(form))!);

      const existing = seenForms.get(form);
      if (existing) {
        if (existing.length < MAX_READINGS) existing.push(features);
      } else {
        seenForms.set(form, [features]);
      }
    }
    record.forms = [...seenForms].map(([form, features]) => ({ form, features }));

    const key = dictKey(entry.word);
    const bucket = lemmas.get(key);
    if (bucket) bucket.push(record);
    else lemmas.set(key, [record]);
  }

  console.log(`  read ${lines.toLocaleString()} lines → ${lemmas.size.toLocaleString()} German lemma keys, ${formOfRows.length.toLocaleString()} inflected-form entries`);
  return { lemmas, formOfRows };
}

// ---------------------------------------------------------------------------
// Step 3: HanDeDict, inverted
// ---------------------------------------------------------------------------

/** HanDeDict marks part of speech and domain in trailing parentheses. */
const HANDEDICT_POS: Record<string, Pos> = {
  S: "noun",
  V: "verb",
  Adj: "adjective",
  Adv: "adverb",
  Int: "interjection",
  Pron: "pronoun",
  Präp: "preposition",
  Konj: "conjunction",
  Num: "numeral",
  Eig: "noun",
};

/**
 * Domain markers. A word whose only gloss is a chemistry term is a bad default
 * translation for an everyday German word.
 */
const TECHNICAL_DOMAINS = new Set([
  "Chem", "Bio", "Med", "Tech", "Math", "Phys", "Mil", "Rel", "Sprachw", "Arch", "Jur",
  "Wirtsch", "Sport", "Mus", "EDV", "Astron", "Zool", "Bot", "Geol", "Psych", "Pol",
]);

type ZhCandidate = { text: string; pinyin: string; pos: Pos | null; score: number };

/**
 * Invert the Chinese → German direction into German → Chinese.
 *
 * This is the noisy half of the pipeline: a Chinese headword's German gloss list
 * is not a set of synonyms for one sense, and proper nouns dominate the corpus.
 * Scoring therefore prefers entries with few glosses (specific), short headwords
 * (base words rather than compounds), and demotes proper nouns.
 */
const HANDEDICT_ENTRY = /^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/\s*$/;

async function readHanDeDict(): Promise<Map<string, ZhCandidate[]>> {
  const lines = (await readFile(join(RAW_DIR, "handedict.u8"), "utf8")).split("\n");
  const byGerman = new Map<string, ZhCandidate[]>();

  // Pass 1: how often does each Chinese character occur across all headwords?
  // This is the only frequency signal available without another download, and it
  // is what separates 好 ("good", tens of thousands of occurrences) from 婽, which
  // is also glossed "gut" but appears once in the entire dictionary.
  const charFrequency = new Map<string, number>();
  let entries = 0;
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const match = HANDEDICT_ENTRY.exec(line);
    if (!match) continue;
    entries++;
    for (const char of match[2]) charFrequency.set(char, (charFrequency.get(char) ?? 0) + 1);
  }

  /** Mean log-frequency of a word's characters, ~0 for rare, ~10 for very common. */
  const commonness = (word: string): number => {
    let total = 0;
    for (const char of word) total += Math.log((charFrequency.get(char) ?? 1) + 1);
    return total / Math.max(1, [...word].length);
  };

  // Pass 2: invert into German → Chinese.
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const match = HANDEDICT_ENTRY.exec(line);
    if (!match) continue;

    const [, , simplified, numericPinyin, glossField] = match;
    const glosses = glossField.split("/").filter(Boolean);
    const pinyin = toDiacriticPinyin(numericPinyin);
    const score = commonness(simplified) * 8;

    for (const [glossIndex, gloss] of glosses.entries()) {
      // Pull out the trailing tag groups — `(u.E.) (S, Chem)` — then drop them.
      const tags = [...gloss.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1].split(/,\s*/));
      const isProperNoun = tags.includes("Eig");
      const pos = tags.map((t) => HANDEDICT_POS[t]).find(Boolean) ?? null;
      const isTechnical = tags.some((t) => TECHNICAL_DOMAINS.has(t));
      const german = gloss.replace(/\([^)]*\)/g, " ");
      const synonyms = german.split(/[,;]/);

      for (const [synonymIndex, candidate] of synonyms.entries()) {
        const word = candidate.trim();
        if (!word || !isPlainGermanWord(word)) continue;

        const ranked =
          score +
          // The first gloss of an entry is its primary meaning, and the first
          // synonym within a gloss is the closest equivalent.
          (glossIndex === 0 ? 30 : 0) +
          (synonymIndex === 0 ? 10 : 0) -
          glosses.length * 3 -
          (isProperNoun ? 45 : 0) -
          (isTechnical ? 20 : 0);

        const key = dictKey(word);
        const bucket = byGerman.get(key) ?? [];
        if (!bucket.some((c) => c.text === simplified)) {
          bucket.push({ text: simplified, pinyin, pos, score: ranked });
          byGerman.set(key, bucket);
        }
      }
    }
  }

  for (const bucket of byGerman.values()) bucket.sort((a, b) => b.score - a.score);
  console.log(`  read ${entries.toLocaleString()} HanDeDict entries → ${byGerman.size.toLocaleString()} German headwords`);
  return byGerman;
}

// ---------------------------------------------------------------------------
// Step 4: select, merge, emit
// ---------------------------------------------------------------------------

/**
 * Parts of speech that can meaningfully take a HanDeDict gloss. Function words
 * must not: inverting a Chinese-German dictionary offers 何人 ("who") as a
 * translation of `der`, which is noise dressed up as data.
 */
const CONTENT_POS = new Set<Pos>(["noun", "verb", "adjective", "adverb", "numeral", "interjection"]);

/**
 * German Wiktionary keeps one page per spelling, so a word can have several
 * entries with the same part of speech — `Hund` is the animal, the constellation,
 * and a mining cart. They arrive in page order, which is not usefulness order, so
 * merge them with the richest entry first: the primary sense is reliably the one
 * translated into the most languages.
 */
function mergeRecords(records: LemmaRecord[]): LemmaRecord {
  const ranked = [...records].sort((a, b) => {
    const coverage = (r: LemmaRecord) =>
      (["en", "es", "zh"] as Target[]).filter((t) => r.candidates[t].length > 0).length;
    const total = (r: LemmaRecord) =>
      (["en", "es", "zh"] as Target[]).reduce((sum, t) => sum + r.candidates[t].length, 0);
    return coverage(b) - coverage(a) || total(b) - total(a);
  });

  const merged: LemmaRecord = {
    lemma: ranked[0].lemma,
    pos: ranked[0].pos,
    gender: ranked.find((r) => r.gender)?.gender ?? null,
    candidates: { en: [], es: [], zh: [] },
    forms: ranked.flatMap((r) => r.forms),
    rank: Math.min(...ranked.map((r) => r.rank)),
  };

  ranked.forEach((record, position) => {
    for (const target of ["en", "es", "zh"] as Target[]) {
      // Offset keeps each entry's senses in order while letting the richer entry
      // supply the first candidates overall.
      merged.candidates[target].push(
        ...record.candidates[target].map((c) => ({ ...c, order: position * 10_000 + c.order })),
      );
    }
  });

  return merged;
}

function finalGlosses(record: LemmaRecord, zhFallback: ZhCandidate[] | undefined) {
  const glosses = emptyGlosses();

  for (const target of ["en", "es", "zh"] as Target[]) {
    const seen = new Set<string>();
    const picked: Gloss[] = [];
    for (const candidate of [...record.candidates[target]].sort((a, b) => a.order - b.order)) {
      if (seen.has(candidate.text)) continue;
      seen.add(candidate.text);
      picked.push(candidate.pinyin ? { text: candidate.text, pinyin: candidate.pinyin } : { text: candidate.text });
      if (picked.length >= MAX_GLOSSES) break;
    }

    // Wiktionary's Chinese coverage is thin, so top up from inverted HanDeDict —
    // after the curated, sense-linked entries, never before them.
    if (target === "zh" && picked.length < MAX_GLOSSES && zhFallback && CONTENT_POS.has(record.pos)) {
      for (const candidate of zhFallback) {
        if (picked.length >= MAX_GLOSSES) break;
        if (candidate.pos && candidate.pos !== record.pos) continue;
        if (seen.has(candidate.text)) continue;
        seen.add(candidate.text);
        picked.push({ text: candidate.text, pinyin: candidate.pinyin });
      }
    }

    glosses[target] = picked;
  }

  return glosses;
}

async function emitShards(
  family: string,
  lines: Map<number, string[]>,
): Promise<{ files: number; lines: number; bytes: number; hash: string }> {
  const hash = createHash("sha256");
  let totalLines = 0;
  let totalBytes = 0;
  let files = 0;

  for (let index = 0; index < SHARD_COUNT; index++) {
    const shard = lines.get(index);
    if (!shard?.length) continue;
    // Sorted so that a rebuild from the same inputs is byte-identical. Deduped
    // because a word can have two Wiktionary entries that reduce to the same
    // line — `Buchen` is both a nominalized verb and a town in Baden-Württemberg.
    const unique = [...new Set(shard)].sort();
    const body = unique.join("\n") + "\n";
    const gz = gzipSync(Buffer.from(body, "utf8"), { level: 9 });
    const name = shardName(family, index);
    await writeFile(join(OUT_DIR, name), gz);
    hash.update(name).update(gz);
    files++;
    totalLines += unique.length;
    totalBytes += gz.length;
  }

  return { files, lines: totalLines, bytes: totalBytes, hash: hash.digest("hex").slice(0, 12) };
}

function push(map: Map<number, string[]>, key: string, line: string) {
  const index = shardOf(dictKey(key));
  const bucket = map.get(index);
  if (bucket) bucket.push(line);
  else map.set(index, [line]);
}

async function main() {
  const started = Date.now();
  await mkdir(OUT_DIR, { recursive: true });

  console.log("1/5 frequency list");
  const freq = await loadFrequency();
  console.log(`  ${freq.size.toLocaleString()} ranked surface forms`);

  console.log("2/5 Wiktionary extract (this takes a minute)");
  const { lemmas, formOfRows } = await readWiktionary(freq);

  console.log("3/5 HanDeDict");
  const handedict = await readHanDeDict();

  console.log("4/5 selecting lemmas");
  /** Lemma keys that made the cut, mapped to the exact spellings we kept. */
  const keptKeys = new Set<string>();
  const wordLines = new Map<number, string[]>();
  let kept = 0;
  let withEn = 0;
  let withEs = 0;
  let withZh = 0;

  for (const [key, records] of lemmas) {
    // One line per (lemma, part of speech): several Wiktionary entries can share
    // both, and shipping them separately means the reader picks one at random.
    const byLemmaAndPos = new Map<string, LemmaRecord[]>();
    for (const record of records) {
      const id = `${record.lemma} ${record.pos}`;
      const bucket = byLemmaAndPos.get(id);
      if (bucket) bucket.push(record);
      else byLemmaAndPos.set(id, [record]);
    }

    for (const group of byLemmaAndPos.values()) {
      const record = group.length === 1 ? group[0] : mergeRecords(group);
      const zhFallback = handedict.get(key);
      const glosses = finalGlosses(record, zhFallback);
      const translatable = glosses.en.length > 0 || glosses.es.length > 0 || glosses.zh.length > 0;

      // Ship a lemma if it is frequent enough to be met in real text, or if we
      // have something to say about it in at least one target language.
      if (record.rank === Infinity && !translatable) continue;

      keptKeys.add(key);
      kept++;
      if (glosses.en.length) withEn++;
      if (glosses.es.length) withEs++;
      if (glosses.zh.length) withZh++;

      push(wordLines, record.lemma, encodeWordLine({
        lemma: record.lemma,
        pos: record.pos,
        gender: record.gender,
        glosses,
      }));
    }
  }
  console.log(`  ${kept.toLocaleString()} lemma entries kept (en ${withEn.toLocaleString()}, es ${withEs.toLocaleString()}, zh ${withZh.toLocaleString()})`);

  console.log("5/5 form index");
  /** form → `lemma|pos` → feature codes. */
  const formIndex = new Map<string, Map<string, Set<string>>>();

  const addForm = (form: string, lemma: string, pos: Pos, features: Features[]) => {
    if (!keptKeys.has(dictKey(lemma))) return;
    features = features.filter((f) => featuresValidFor(pos, f));
    let byLemma = formIndex.get(form);
    if (!byLemma) formIndex.set(form, (byLemma = new Map()));
    const id = `${lemma}|${pos}`;
    let codes = byLemma.get(id);
    if (!codes) byLemma.set(id, (codes = new Set()));
    for (const feature of features) {
      if (codes.size >= MAX_READINGS) break;
      const code = encodeFeatures(feature);
      if (code) codes.add(code);
    }
  };

  for (const records of lemmas.values()) {
    for (const record of records) {
      for (const { form, features } of record.forms) addForm(form, record.lemma, record.pos, features);
    }
  }
  for (const row of formOfRows) {
    if (row.pos) {
      addForm(row.form, row.lemma, row.pos, [row.features]);
      continue;
    }
    // The source entry did not give a usable part of speech (`Deklinierte Form`
    // entries are often tagged `unknown`), so trust the lemma's own entries.
    for (const record of lemmas.get(dictKey(row.lemma)) ?? []) {
      if (record.lemma === row.lemma) addForm(row.form, record.lemma, record.pos, [row.features]);
    }
  }

  const formLines = new Map<number, string[]>();
  for (const [form, byLemma] of formIndex) {
    const analyses = [...byLemma].map(([id, codes]) => {
      const [lemma, pos] = id.split("|");
      return { lemma, pos: pos as Pos, codes: [...codes] };
    });
    push(formLines, form, encodeFormLineFromCodes(form, analyses));
  }
  console.log(`  ${formIndex.size.toLocaleString()} distinct inflected forms`);

  // Clear stale shards so a shrinking dictionary cannot leave orphans behind.
  for (const file of await readdir(OUT_DIR)) {
    if (/^[wf]-\d{3}\.txt\.gz$/.test(file)) await unlink(join(OUT_DIR, file));
  }

  const words = await emitShards(WORD_SHARD, wordLines);
  const forms = await emitShards(FORM_SHARD, formLines);
  const version = createHash("sha256").update(words.hash).update(forms.hash).digest("hex").slice(0, 12);

  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    shardCount: SHARD_COUNT,
    families: {
      [WORD_SHARD]: { files: words.files, lines: words.lines, bytes: words.bytes },
      [FORM_SHARD]: { files: forms.files, lines: forms.lines, bytes: forms.bytes },
    },
    coverage: { lemmas: kept, en: withEn, es: withEs, zh: withZh },
    sources: SOURCES.map(({ id, title, url, license, licenseUrl, attribution, use }) => ({
      id,
      title,
      url,
      license,
      licenseUrl,
      attribution,
      use,
    })),
  };
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const total = words.bytes + forms.bytes;
  console.log(`\nWrote ${words.files + forms.files} shards + manifest to public/dict/`);
  console.log(`  words: ${words.lines.toLocaleString()} lines, ${mb(words.bytes)}`);
  console.log(`  forms: ${forms.lines.toLocaleString()} lines, ${mb(forms.bytes)}`);
  console.log(`  total: ${mb(total)}  (version ${version})`);
  console.log(`  took ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

await main();
