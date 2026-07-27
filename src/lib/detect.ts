/**
 * Which of the four languages was written.
 *
 * Deliberately a heuristic and not a model. Measured on real sentences it is
 * right, and on bare words it is not — `no` is genuinely both English and
 * Spanish, so no detector of any size resolves that. A 280MB classifier would buy
 * nothing here. What matters instead is that the uncertainty is *reported*, so the
 * UI can show the guess and let it be corrected.
 *
 * Pure and dependency-free, so the browser can run it as you type and the server
 * can run it on API requests that omit a source.
 */

import { LANGS, type Lang } from "./analysis.ts";
import { COORDINATING, DEFINITE_ARTICLE, PRONOUNS, SUBORDINATING } from "./germanTables.ts";

export type Detection = {
  lang: Lang;
  /**
   * How much clearer the winner was than the runner-up, per token: 0 means no
   * evidence at all and the answer is a default rather than a finding.
   */
  confidence: number;
};

/** Han characters, which settle Chinese on their own. */
const HAN = /[㐀-鿿]/g;
/** Above this share of Han characters, the text is Chinese. */
const HAN_SHARE = 0.2;

/**
 * German function words come from the tables the tagger already maintains, rather
 * than being typed out a second time and left to drift.
 */
const GERMAN = new Set<string>([
  ...Object.keys(DEFINITE_ARTICLE),
  ...Object.keys(PRONOUNS),
  ...COORDINATING,
  ...SUBORDINATING,
  "ist", "nicht", "ein", "eine", "einen", "einem", "einer", "mit", "auf", "für", "von", "im",
  "haben", "hat", "sein", "werden", "wird", "war", "auch", "aus", "nach", "bei", "noch", "nur",
  "kann", "muss", "schon", "sehr", "zum", "zur",
  "ja", "nein", "hallo", "danke", "bitte", "entschuldigung", "guten", "morgen", "tag", "tschüss",
]);

const ENGLISH = new Set<string>([
  "the", "is", "and", "of", "to", "a", "an", "in", "that", "it", "for", "on", "with", "as", "was",
  "are", "this", "be", "have", "has", "not", "but", "they", "you", "at", "from", "or", "by", "will",
  "can", "would", "there", "their", "what", "about", "which", "when", "all", "my", "your", "do",
  // Words people type on their own, which is otherwise the blind spot.
  "yes", "no", "hello", "hi", "thanks", "please", "sorry", "good", "morning", "afternoon", "goodbye",
]);

const SPANISH = new Set<string>([
  "el", "la", "los", "las", "de", "que", "y", "es", "en", "un", "una", "por", "con", "para", "se",
  "su", "lo", "al", "como", "más", "pero", "sus", "le", "ya", "este", "esta", "son", "está", "muy",
  "sin", "sobre", "tengo", "tiene", "hay", "ser", "estar", "todo", "nos", "mi", "yo",
  "no", "sí", "hola", "gracias", "por favor", "perdón", "buenos", "buenas", "días", "tardes", "adiós",
]);

const STOPWORDS: Record<"de" | "en" | "es", Set<string>> = {
  de: GERMAN,
  en: ENGLISH,
  es: SPANISH,
};

/** Letters only one of the languages uses, worth more than a single stopword hit. */
const ORTHOGRAPHY: [RegExp, "de" | "es", number][] = [
  [/[äöüß]/i, "de", 2],
  [/[ñ¿¡]/i, "es", 2],
  [/[áíóúÁÍÓÚ]/, "es", 2],
];

/**
 * The language the app falls back to when there is no evidence either way — its
 * home language, and the only one with a word-by-word layer.
 */
const DEFAULT_LANG: Lang = "de";

export function detectLanguage(text: string): Detection {
  const trimmed = text.trim();
  if (!trimmed) return { lang: DEFAULT_LANG, confidence: 0 };

  // Script first: Han characters are decisive and no scoring is needed.
  const characters = [...trimmed];
  const han = trimmed.match(HAN)?.length ?? 0;
  if (han / characters.length > HAN_SHARE) return { lang: "zh", confidence: 1 };

  const tokens = trimmed.toLowerCase().match(/\p{L}+/gu) ?? [];
  const scores: Record<"de" | "en" | "es", number> = { de: 0, en: 0, es: 0 };

  for (const token of tokens) {
    for (const lang of ["de", "en", "es"] as const) {
      if (STOPWORDS[lang].has(token)) scores[lang] += 1;
    }
  }
  for (const [pattern, lang, weight] of ORTHOGRAPHY) {
    if (pattern.test(trimmed)) scores[lang] += weight;
  }

  // Sorted with a fixed tiebreak, so a tie always resolves the same way rather
  // than depending on the engine's sort.
  const order = ["de", "en", "es"] as const;
  const ranked = [...order].sort((a, b) => scores[b] - scores[a] || order.indexOf(a) - order.indexOf(b));
  const best = ranked[0];
  const margin = scores[best] - scores[ranked[1]];

  // No signal at all: a word we do not recognise. Say so rather than guess.
  if (scores[best] === 0) return { lang: DEFAULT_LANG, confidence: 0 };

  // A tie — `no` is Spanish and English both — keeps its guess but reports no
  // confidence, which is what makes the UI offer the override.
  return { lang: best, confidence: Math.min(1, margin / Math.max(1, tokens.length)) };
}

/** Narrow an untrusted string to a language, for API input. */
export function asLang(value: unknown): Lang | null {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value)
    ? (value as Lang)
    : null;
}
