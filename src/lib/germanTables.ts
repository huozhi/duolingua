/**
 * Hand-written German closed-class data.
 *
 * Everything here could in principle be read out of the dictionary, but function
 * words are exactly where a dictionary is least useful: `der` has one Wiktionary
 * entry and nine grammatical readings, `sie` is three different pronouns, and
 * getting them wrong is very visible because they are the most frequent words in
 * the language. The sets are small, closed and stable, so they are written out.
 */

import type { Case, Gender, GrammaticalNumber, Person, Pos } from "./analysis.ts";

/** One fully specified reading of a determiner or pronoun. */
export type Agreement = {
  case: Case;
  number: GrammaticalNumber;
  gender?: Gender;
};

const n = "nominative" as const;
const g = "genitive" as const;
const d = "dative" as const;
const a = "accusative" as const;
const sg = "singular" as const;
const pl = "plural" as const;

// ---------------------------------------------------------------------------
// Determiners
// ---------------------------------------------------------------------------

/**
 * The definite article, spelled out because it is syncretic in every direction:
 * `der` alone is nominative singular masculine, genitive singular feminine,
 * dative singular feminine, or genitive plural.
 */
export const DEFINITE_ARTICLE: Record<string, Agreement[]> = {
  der: [
    { case: n, number: sg, gender: "masculine" },
    { case: g, number: sg, gender: "feminine" },
    { case: d, number: sg, gender: "feminine" },
    { case: g, number: pl },
  ],
  die: [
    { case: n, number: sg, gender: "feminine" },
    { case: a, number: sg, gender: "feminine" },
    { case: n, number: pl },
    { case: a, number: pl },
  ],
  das: [
    { case: n, number: sg, gender: "neuter" },
    { case: a, number: sg, gender: "neuter" },
  ],
  des: [
    { case: g, number: sg, gender: "masculine" },
    { case: g, number: sg, gender: "neuter" },
  ],
  dem: [
    { case: d, number: sg, gender: "masculine" },
    { case: d, number: sg, gender: "neuter" },
  ],
  den: [
    { case: a, number: sg, gender: "masculine" },
    { case: d, number: pl },
  ],
};

/**
 * Endings of the `dieser` paradigm (also `jeder`, `welcher`, `mancher`, `aller`,
 * `solcher`) — the same endings the definite article carries.
 */
const DER_TYPE_ENDINGS: Record<string, Agreement[]> = {
  er: [{ case: n, number: sg, gender: "masculine" }],
  e: [
    { case: n, number: sg, gender: "feminine" },
    { case: a, number: sg, gender: "feminine" },
    { case: n, number: pl },
    { case: a, number: pl },
  ],
  es: [
    { case: n, number: sg, gender: "neuter" },
    { case: a, number: sg, gender: "neuter" },
  ],
  en: [
    { case: a, number: sg, gender: "masculine" },
    { case: d, number: pl },
  ],
  em: [
    { case: d, number: sg, gender: "masculine" },
    { case: d, number: sg, gender: "neuter" },
  ],
};

/**
 * Endings of the `ein` paradigm: possessives and `kein`. Differs from the
 * `dieser` paradigm in the bare nominative/accusative forms.
 */
const EIN_TYPE_ENDINGS: Record<string, Agreement[]> = {
  "": [
    { case: n, number: sg, gender: "masculine" },
    { case: n, number: sg, gender: "neuter" },
    { case: a, number: sg, gender: "neuter" },
  ],
  e: [
    { case: n, number: sg, gender: "feminine" },
    { case: a, number: sg, gender: "feminine" },
    { case: n, number: pl },
    { case: a, number: pl },
  ],
  en: [
    { case: a, number: sg, gender: "masculine" },
    { case: d, number: pl },
  ],
  em: [
    { case: d, number: sg, gender: "masculine" },
    { case: d, number: sg, gender: "neuter" },
  ],
  er: [
    { case: g, number: sg, gender: "feminine" },
    { case: d, number: sg, gender: "feminine" },
    { case: g, number: pl },
  ],
  es: [
    { case: g, number: sg, gender: "masculine" },
    { case: g, number: sg, gender: "neuter" },
  ],
};

const DER_TYPE_STEMS = ["dies", "jen", "jed", "welch", "manch", "solch", "all"];
const EIN_TYPE_STEMS = ["ein", "kein", "mein", "dein", "sein", "ihr", "unser", "euer", "eur", "Ihr"];

/**
 * Resolve a determiner to its possible agreements, or null if the word is not a
 * determiner. Handles the definite article directly and the two productive
 * paradigms by stem + ending.
 */
export function determinerAgreements(word: string): Agreement[] | null {
  const lower = word.toLowerCase();
  if (DEFINITE_ARTICLE[lower]) return DEFINITE_ARTICLE[lower];

  for (const stem of DER_TYPE_STEMS) {
    if (!lower.startsWith(stem)) continue;
    const ending = lower.slice(stem.length);
    const agreements = DER_TYPE_ENDINGS[ending];
    if (agreements?.length) return agreements;
    // `dieses` is also genitive singular masculine/neuter.
    if (ending === "es") return [...DER_TYPE_ENDINGS.es, ...EIN_TYPE_ENDINGS.es];
  }

  for (const stem of EIN_TYPE_STEMS) {
    if (!lower.startsWith(stem)) continue;
    const ending = lower.slice(stem.length);
    const agreements = EIN_TYPE_ENDINGS[ending];
    if (agreements) return agreements;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pronouns
// ---------------------------------------------------------------------------

export type PronounReading = Agreement & { person?: Person };

/**
 * Personal and reflexive pronouns. Person and number feed verb agreement, which
 * is how `ich stehe` picks the 1st-person-singular reading of `stehe` out of the
 * four the dictionary offers.
 */
export const PRONOUNS: Record<string, PronounReading[]> = {
  ich: [{ case: n, number: sg, person: "1" }],
  du: [{ case: n, number: sg, person: "2" }],
  er: [{ case: n, number: sg, person: "3", gender: "masculine" }],
  sie: [
    { case: n, number: sg, person: "3", gender: "feminine" },
    { case: a, number: sg, person: "3", gender: "feminine" },
    { case: n, number: pl, person: "3" },
    { case: a, number: pl, person: "3" },
  ],
  es: [
    { case: n, number: sg, person: "3", gender: "neuter" },
    { case: a, number: sg, person: "3", gender: "neuter" },
  ],
  wir: [{ case: n, number: pl, person: "1" }],
  ihr: [
    { case: n, number: pl, person: "2" },
    { case: d, number: sg, person: "3", gender: "feminine" },
  ],
  mich: [{ case: a, number: sg, person: "1" }],
  dich: [{ case: a, number: sg, person: "2" }],
  ihn: [{ case: a, number: sg, person: "3", gender: "masculine" }],
  uns: [
    { case: a, number: pl, person: "1" },
    { case: d, number: pl, person: "1" },
  ],
  euch: [
    { case: a, number: pl, person: "2" },
    { case: d, number: pl, person: "2" },
  ],
  mir: [{ case: d, number: sg, person: "1" }],
  dir: [{ case: d, number: sg, person: "2" }],
  ihm: [{ case: d, number: sg, person: "3", gender: "masculine" }],
  ihnen: [{ case: d, number: pl, person: "3" }],
  sich: [
    { case: a, number: sg, person: "3" },
    { case: d, number: sg, person: "3" },
  ],
  man: [{ case: n, number: sg, person: "3" }],
  wer: [{ case: n, number: sg }],
  wen: [{ case: a, number: sg }],
  wem: [{ case: d, number: sg }],
  was: [
    { case: n, number: sg },
    { case: a, number: sg },
  ],
};

// ---------------------------------------------------------------------------
// Prepositions and their case
// ---------------------------------------------------------------------------

/**
 * Case governed by each preposition. The two-way prepositions take accusative
 * for movement and dative for location, which cannot be decided from morphology
 * alone — so both are listed and the determiner narrows it down.
 */
export const PREPOSITION_CASE: Record<string, Case[]> = {
  // Accusative
  bis: [a], durch: [a], für: [a], gegen: [a], ohne: [a], um: [a], wider: [a], entlang: [a],
  // Dative
  ab: [d], aus: [d], außer: [d], bei: [d], binnen: [d], entgegen: [d], gegenüber: [d],
  gemäß: [d], laut: [d], mit: [d], nach: [d], nebst: [d], samt: [d], seit: [d], von: [d], zu: [d],
  // Genitive
  abseits: [g], angesichts: [g], anlässlich: [g], anstatt: [g], aufgrund: [g], außerhalb: [g],
  bezüglich: [g], diesseits: [g], hinsichtlich: [g], infolge: [g], innerhalb: [g], jenseits: [g],
  mittels: [g], oberhalb: [g], statt: [g], trotz: [g], unterhalb: [g], unweit: [g], während: [g],
  wegen: [g], zwecks: [g],
  // Two-way: accusative on movement, dative on location
  an: [a, d], auf: [a, d], hinter: [a, d], in: [a, d], neben: [a, d], über: [a, d],
  unter: [a, d], vor: [a, d], zwischen: [a, d],
};

/**
 * Preposition + article fused into one word. Splitting these is what lets `zum
 * Bahnhof` be understood as dative, and it is also the only honest way to show
 * the learner what the word contains.
 */
export const CONTRACTIONS: Record<string, { preposition: string; article: string; case: Case }> = {
  am: { preposition: "an", article: "dem", case: d },
  ans: { preposition: "an", article: "das", case: a },
  aufs: { preposition: "auf", article: "das", case: a },
  beim: { preposition: "bei", article: "dem", case: d },
  durchs: { preposition: "durch", article: "das", case: a },
  fürs: { preposition: "für", article: "das", case: a },
  hinterm: { preposition: "hinter", article: "dem", case: d },
  hinters: { preposition: "hinter", article: "das", case: a },
  im: { preposition: "in", article: "dem", case: d },
  ins: { preposition: "in", article: "das", case: a },
  überm: { preposition: "über", article: "dem", case: d },
  übers: { preposition: "über", article: "das", case: a },
  ums: { preposition: "um", article: "das", case: a },
  unterm: { preposition: "unter", article: "dem", case: d },
  unters: { preposition: "unter", article: "das", case: a },
  vom: { preposition: "von", article: "dem", case: d },
  vorm: { preposition: "vor", article: "dem", case: d },
  vors: { preposition: "vor", article: "das", case: a },
  zum: { preposition: "zu", article: "dem", case: d },
  zur: { preposition: "zu", article: "der", case: d },
};

/** Clitic `es`: `geht's` is `geht` + `es`. */
export const CLITIC = /^(.+?)['’ʼ]s$/;

// ---------------------------------------------------------------------------
// Verbs and conjunctions
// ---------------------------------------------------------------------------

export const MODAL_LEMMAS = new Set(["können", "müssen", "dürfen", "sollen", "wollen", "mögen"]);
export const AUXILIARY_LEMMAS = new Set(["sein", "haben", "werden"]);

/** Coordinating conjunctions — these do not move the verb. */
export const COORDINATING = new Set(["und", "oder", "aber", "denn", "sondern", "sowie", "beziehungsweise"]);

/** Subordinating conjunctions — these send the finite verb to the end of the clause. */
export const SUBORDINATING = new Set([
  "als", "bevor", "bis", "da", "damit", "dass", "ehe", "falls", "indem", "nachdem", "ob",
  "obgleich", "obwohl", "seit", "seitdem", "sobald", "sodass", "solange", "sooft", "soweit",
  "während", "weil", "wenn", "wie", "wo", "wobei", "wodurch", "wogegen", "womit", "worauf", "wozu",
]);

/** Frequent adverbs and particles the dictionary often labels only as adjectives. */
export const PARTICLES = new Set([
  "auch", "denn", "doch", "eben", "eigentlich", "etwa", "halt", "ja", "mal", "nur", "schon",
  "vielleicht", "wohl", "bloß", "überhaupt", "ruhig",
]);

export const NEGATION = new Set(["nein", "nicht", "nie", "niemals", "nirgends", "kaum"]);

/**
 * Separable verb prefixes. A finite separable verb leaves its prefix at the end
 * of the clause — `Ich stehe früh auf` — and the two have to be reunited before
 * the verb can be looked up.
 */
export const SEPARABLE_PARTICLES = new Set([
  "ab", "an", "auf", "aus", "bei", "da", "dabei", "dar", "durch", "ein", "empor", "entgegen",
  "entlang", "fort", "gegenüber", "her", "herab", "heran", "herauf", "heraus", "herbei", "herein",
  "herum", "herunter", "hervor", "hin", "hinab", "hinauf", "hinaus", "hinein", "hinter", "hinunter",
  "hinzu", "los", "mit", "nach", "nieder", "über", "um", "unter", "vor", "voran", "vorbei",
  "vorüber", "weg", "weiter", "wieder", "zu", "zurecht", "zurück", "zusammen",
]);

/**
 * Words that are genuinely both preposition and conjunction — `während des
 * Krieges` versus `während ich schlief`. `closedClassPos` refuses to guess for
 * these; the tagger decides from what follows.
 */
export const PREPOSITION_OR_CONJUNCTION = new Set(
  Object.keys(PREPOSITION_CASE).filter((word) => SUBORDINATING.has(word)),
);

/**
 * Closed-class words whose part of speech we assert rather than look up. The
 * tagger consults this first: these are the most frequent words in German and
 * the dictionary's labels for them are the least reliable — `der` has one entry
 * and nine readings.
 *
 * Returns null when the word is ambiguous enough that context must decide.
 */
export function closedClassPos(word: string): Pos | null {
  const lower = word.toLowerCase();

  if (PREPOSITION_OR_CONJUNCTION.has(lower)) return null;
  if (CONTRACTIONS[lower]) return "preposition";
  if (PREPOSITION_CASE[lower]) return "preposition";
  if (DEFINITE_ARTICLE[lower]) return "article";
  if (PRONOUNS[lower]) return "pronoun";
  if (COORDINATING.has(lower) || SUBORDINATING.has(lower)) return "conjunction";
  if (NEGATION.has(lower) || PARTICLES.has(lower)) return "particle";
  return null;
}
