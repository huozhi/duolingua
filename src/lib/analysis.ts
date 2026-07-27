/** Coarse part-of-speech categories, tuned for German. */
export const POS = [
  "noun",
  "verb",
  "auxiliary-verb",
  "modal-verb",
  "adjective",
  "adverb",
  "article",
  "pronoun",
  "preposition",
  "conjunction",
  "numeral",
  "particle",
  "interjection",
  "punctuation",
  "other",
] as const;

export type Pos = (typeof POS)[number];

export const GENDER = ["masculine", "feminine", "neuter"] as const;
export const CASE = ["nominative", "accusative", "dative", "genitive"] as const;
export const NUMBER = ["singular", "plural"] as const;

export type Gender = (typeof GENDER)[number];
export type Case = (typeof CASE)[number];
export type GrammaticalNumber = (typeof NUMBER)[number];
export type Person = "1" | "2" | "3";

/** The languages we gloss and translate into. */
export const TARGETS = ["en", "es", "zh"] as const;
export type Target = (typeof TARGETS)[number];

export const TARGET_META: Record<Target, { label: string; native: string; bcp47: string }> = {
  en: { label: "English", native: "English", bcp47: "en" },
  es: { label: "Spanish", native: "Español", bcp47: "es" },
  zh: { label: "Chinese", native: "中文", bcp47: "zh-Hans" },
};

/** One dictionary candidate for a word in one target language. */
export type Gloss = {
  /** The translated word or short phrase. */
  text: string;
  /** Mandarin reading, only ever set for Chinese glosses. */
  pinyin?: string;
};

/** Per-target gloss candidates, most likely first. Empty array means "not found". */
export type Glosses = Record<Target, Gloss[]>;

export type Word = {
  /** The token exactly as it appears in the sentence, including capitalization. */
  text: string;
  pos: Pos;
  /** Dictionary form: infinitive for verbs, nominative singular for nouns. */
  lemma: string;
  /** Dictionary candidates per target language. */
  glosses: Glosses;
  /** Grammatical gender — nouns and articles only. */
  gender: Gender | null;
  /**
   * Grammatical case. A list because German case is frequently syncretic: an
   * undetermined `Frauen` is genuinely nominative/accusative/genitive at once,
   * and we render that ambiguity instead of guessing. Empty when not applicable.
   */
  cases: Case[];
  number: GrammaticalNumber | null;
  person: Person | null;
  /** Tense/mood for verbs, e.g. "present", "Präteritum", "Perfekt". */
  tense: string | null;
  /** Short extra grammatical note in English, or null. */
  note: string | null;
  /**
   * Set when this token was resolved by splitting a compound, e.g.
   * `Bahnhofsuhr` → ["Bahnhof", "Uhr"]. The parts carry their own glosses.
   */
  compound: { lemma: string; glosses: Glosses }[] | null;
  /**
   * Set for contractions like `zum` → `zu` + `dem`, and for a finite verb whose
   * separable particle was found later in the clause.
   */
  parts: { text: string; lemma: string; pos: Pos }[] | null;
};

export type Analysis = {
  /** The original sentence, echoed back. */
  sentence: string;
  /** Every token in the sentence, in order, including punctuation. */
  words: Word[];
};

/** An empty gloss set, for tokens with nothing to look up (punctuation, unknowns). */
export function emptyGlosses(): Glosses {
  return { en: [], es: [], zh: [] };
}

/** Color + label metadata for each POS, used by the UI. */
export const POS_META: Record<Pos, { label: string; className: string }> = {
  noun: { label: "Noun", className: "bg-rose-100 text-rose-900 border-rose-300" },
  verb: { label: "Verb", className: "bg-sky-100 text-sky-900 border-sky-300" },
  "auxiliary-verb": { label: "Aux. verb", className: "bg-sky-50 text-sky-800 border-sky-200" },
  "modal-verb": { label: "Modal verb", className: "bg-cyan-100 text-cyan-900 border-cyan-300" },
  adjective: { label: "Adjective", className: "bg-amber-100 text-amber-900 border-amber-300" },
  adverb: { label: "Adverb", className: "bg-yellow-100 text-yellow-900 border-yellow-300" },
  article: { label: "Article", className: "bg-violet-100 text-violet-900 border-violet-300" },
  pronoun: { label: "Pronoun", className: "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-300" },
  preposition: { label: "Preposition", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  conjunction: { label: "Conjunction", className: "bg-teal-100 text-teal-900 border-teal-300" },
  numeral: { label: "Numeral", className: "bg-lime-100 text-lime-900 border-lime-300" },
  particle: { label: "Particle", className: "bg-orange-100 text-orange-900 border-orange-300" },
  interjection: { label: "Interjection", className: "bg-pink-100 text-pink-900 border-pink-300" },
  punctuation: { label: "Punctuation", className: "bg-neutral-100 text-neutral-500 border-neutral-300" },
  other: { label: "Other", className: "bg-neutral-100 text-neutral-700 border-neutral-300" },
};

/** Short case labels, so an ambiguous token can render as "acc/dat". */
export const CASE_ABBREV: Record<Case, string> = {
  nominative: "nom",
  accusative: "acc",
  dative: "dat",
  genitive: "gen",
};
