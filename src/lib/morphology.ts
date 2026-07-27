/**
 * Getting from a word as written to the dictionary entries behind it.
 *
 * Four mechanisms, tried in order of confidence:
 *
 *  1. exact lookup — the word is its own lemma (`Buch`, `gut`)
 *  2. the form index — an irregular inflection was stored at build time
 *     (`Häuser` → `Haus`, `gelesen` → `lesen`)
 *  3. adjective ending stripping — declensions are *not* stored, because German
 *     adjective endings are a closed set and stripping them is exact
 *     (`faulen` → `faul`)
 *  4. compound splitting — German compounds are unbounded, so no dictionary can
 *     list them (`Bahnhofsuhr` → `Bahnhof` + `Uhr`)
 */

import type { Gender, Glosses, Pos } from "./analysis.ts";
import type { DictStore } from "./dictStore.ts";
import type { Features } from "./dictFormat.ts";
import { CLITIC, CONTRACTIONS, SEPARABLE_PARTICLES } from "./germanTables.ts";

/** A dictionary entry reached from a surface form, with how we got there. */
export type Candidate = {
  lemma: string;
  pos: Pos;
  gender: Gender | null;
  glosses: Glosses;
  /** Grammatical readings of the surface form under this lemma. */
  readings: Features[];
  /** How the candidate was found, lower is more trustworthy. */
  confidence: 1 | 2 | 3 | 4;
  /** Set when the word was split, e.g. `Bahnhofsuhr` → Bahnhof + Uhr. */
  parts?: { lemma: string; glosses: Glosses }[];
};

/** Adjective and determiner endings, longest first so `-en` beats `-e`. */
const ADJECTIVE_ENDINGS = ["sten", "stem", "ster", "stes", "ste", "en", "em", "er", "es", "e"];

/** Linking morphemes at a compound seam: `Bahnhof|s|uhr`, `Sonne|n|schein`. */
const LINKING_MORPHEMES = ["", "s", "es", "n", "en", "er", "e"];

const MIN_COMPOUND_PART = 3;
const MAX_COMPOUND_PARTS = 3;

/**
 * Resolve one token to every dictionary entry it could represent, best first.
 */
export async function resolve(store: DictStore, token: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  const byId = new Map<string, Candidate>();
  const add = (candidate: Candidate) => {
    const id = `${candidate.lemma}|${candidate.pos}`;
    const existing = byId.get(id);
    if (existing) {
      // The same entry is reached twice: once as its own lemma (no readings) and
      // once through the form index (with them). Keep the union — dropping the
      // second would throw away every grammatical feature of an uninflected noun.
      for (const reading of candidate.readings) existing.readings.push(reading);
      return;
    }
    byId.set(id, candidate);
    candidates.push(candidate);
  };

  // 1. The token is a lemma in its own right.
  for (const entry of await store.lookupWord(token)) {
    add({ ...entry, readings: [], confidence: 1 });
  }

  // 2. The token is a stored inflection of something.
  for (const analysis of await store.lookupForm(token)) {
    for (const entry of await store.lookupWord(analysis.lemma)) {
      if (entry.pos !== analysis.pos) continue;
      add({ ...entry, readings: analysis.readings, confidence: 2 });
    }
  }

  if (candidates.length) return byPreference(token, candidates);

  // 3. Strip an adjective ending and try again.
  for (const stripped of strippedStems(token)) {
    for (const entry of await store.lookupWord(stripped)) {
      if (entry.pos !== "adjective" && entry.pos !== "adverb") continue;
      add({ ...entry, readings: [], confidence: 3 });
    }
    // `schnellere` → `schneller`, which the form index knows as a comparative.
    for (const analysis of await store.lookupForm(stripped)) {
      for (const entry of await store.lookupWord(analysis.lemma)) {
        if (entry.pos !== analysis.pos) continue;
        add({ ...entry, readings: analysis.readings, confidence: 3 });
      }
    }
    if (candidates.length) break;
  }

  if (candidates.length) return byPreference(token, candidates);

  // 4. Compound.
  const parts = await splitCompound(store, token);
  if (parts) {
    // The last element of a German compound determines its part of speech and
    // gender: `Bahnhofsuhr` is feminine because `Uhr` is.
    const head = parts[parts.length - 1];
    add({
      lemma: token,
      pos: head.pos,
      gender: head.gender,
      glosses: head.glosses,
      readings: [],
      confidence: 4,
      parts: parts.map((part) => ({ lemma: part.lemma, glosses: part.glosses })),
    });
  }

  return byPreference(token, candidates);
}

/**
 * Order candidates best-first: by how we found them, then by whether the lemma's
 * capitalization matches the token's.
 *
 * That second criterion does a lot of work in German, where capitalization is
 * grammar: `früh` written lowercase is the adjective "early", not the noun `Früh`,
 * and `fahren` is the verb, not the nominalized `Fahren`. Both spellings share a
 * dictionary key, so without this the choice would come down to shard order.
 */
function byPreference(token: string, candidates: Candidate[]): Candidate[] {
  const mismatch = (candidate: Candidate) =>
    isCapitalized(token) === isCapitalized(candidate.lemma) ? 0 : 1;
  return [...candidates].sort((a, b) => a.confidence - b.confidence || mismatch(a) - mismatch(b));
}

/** Every stem obtainable by removing one adjective/determiner ending. */
function strippedStems(token: string): string[] {
  const stems: string[] = [];
  for (const ending of ADJECTIVE_ENDINGS) {
    if (!token.endsWith(ending)) continue;
    const stem = token.slice(0, -ending.length);
    if (stem.length < MIN_COMPOUND_PART) continue;
    stems.push(stem);
    // Lemmas ending in `-e` lose it before an ending: `müden` → `müd` → `müde`.
    stems.push(stem + "e");
  }
  return stems;
}

type Part = { lemma: string; pos: Pos; gender: Gender | null; glosses: Glosses };

/**
 * Split a compound from the right: find the longest known head noun at the end
 * whose remainder is itself a known word, or another compound.
 *
 * Longest-tail-first matters — `Bahnhofsuhr` must not be read as `Bahn` +
 * `Hofsuhr`. So does preferring a shallow split: `Kaffeetassenrand` is
 * `Kaffeetasse` + `n` + `Rand`, and only trying recursion after every linking
 * morpheme has been tried directly stops it becoming `Kaff` + `ETA` + `Sen` +
 * `Rand`.
 */
async function splitCompound(
  store: DictStore,
  word: string,
  maxParts = MAX_COMPOUND_PARTS,
): Promise<Part[] | null> {
  if (maxParts < 2 || word.length < MIN_COMPOUND_PART * 2) return null;

  for (let start = MIN_COMPOUND_PART; start <= word.length - MIN_COMPOUND_PART; start++) {
    const tail = word.slice(start);
    // Compound heads are nouns; the head is capitalized in the compound's own
    // spelling only at the very start, so try the capitalized form too.
    const tailEntries = await lookupAny(store, [tail, capitalize(tail)]);
    // A capitalized compound is a noun, so its head must be one. Lowercase
    // compounds may head on a verb (`radfahren`) or adjective (`dunkelblau`).
    const head =
      tailEntries.find((entry) => entry.pos === "noun") ??
      (isCapitalized(word) ? undefined : tailEntries[0]);
    if (!head) continue;

    const rawHead = word.slice(0, start);
    const stems = LINKING_MORPHEMES.filter((morpheme) => !morpheme || rawHead.endsWith(morpheme))
      .map((morpheme) => (morpheme ? rawHead.slice(0, -morpheme.length) : rawHead))
      .filter((stem) => stem.length >= MIN_COMPOUND_PART);

    for (const stem of stems) {
      const stemEntries = await lookupAny(store, [stem, capitalize(stem)]);
      if (stemEntries.length) return [stemEntries[0], head];
    }

    for (const stem of stems) {
      const nested = await splitCompound(store, stem, maxParts - 1);
      if (nested) return [...nested, head];
    }
  }

  return null;
}

async function lookupAny(store: DictStore, spellings: string[]): Promise<Part[]> {
  for (const spelling of spellings) {
    const entries = (await store.lookupWord(spelling)).filter((entry) => !isAcronym(entry.lemma));
    if (entries.length) {
      return entries.map((entry) => ({
        lemma: entry.lemma,
        pos: entry.pos,
        gender: entry.gender,
        glosses: entry.glosses,
      }));
    }
  }
  return [];
}

/**
 * Lookup is case-insensitive, which means `eta` inside a compound matches the
 * acronym `ETA`. Acronyms are never compound elements, so exclude them.
 */
function isAcronym(lemma: string): boolean {
  return lemma.length <= 4 && lemma === lemma.toLocaleUpperCase("de-DE") && /\p{L}/u.test(lemma);
}

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase("de-DE") + word.slice(1);
}

export function isCapitalized(word: string): boolean {
  const first = word.charAt(0);
  return first === first.toLocaleUpperCase("de-DE") && first !== first.toLocaleLowerCase("de-DE");
}

// ---------------------------------------------------------------------------
// Multiword phenomena
// ---------------------------------------------------------------------------

/** `zum` → `zu` + `dem`, or null. */
export function expandContraction(token: string) {
  return CONTRACTIONS[token.toLowerCase()] ?? null;
}

/** `geht's` → `geht` + `es`, or null. */
export function expandClitic(token: string): { host: string; clitic: string } | null {
  const match = CLITIC.exec(token);
  return match ? { host: match[1], clitic: "es" } : null;
}

/**
 * Reunite a finite verb with a separated prefix: given `stehe` and a later `auf`,
 * ask the dictionary about `stehe auf`, which the build script indexed as a form
 * of `aufstehen`. Data, not guesswork — no rule has to know that `aufstehen`
 * exists but `aufmüssen` does not.
 */
export async function joinSeparableVerb(
  store: DictStore,
  verb: string,
  particle: string,
): Promise<Candidate[]> {
  if (!SEPARABLE_PARTICLES.has(particle.toLowerCase())) return [];

  const candidates: Candidate[] = [];
  for (const analysis of await store.lookupForm(`${verb} ${particle.toLowerCase()}`)) {
    for (const entry of await store.lookupWord(analysis.lemma)) {
      if (entry.pos !== "verb") continue;
      candidates.push({ ...entry, readings: analysis.readings, confidence: 2 });
    }
  }
  return candidates;
}
