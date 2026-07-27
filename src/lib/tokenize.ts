/**
 * German tokenizer built on Intl.Segmenter — no dependency, and it already knows
 * about Unicode word boundaries, so we only have to patch the few places where
 * German disagrees with the default segmentation.
 */

export type Token = {
  /** The token exactly as written. */
  text: string;
  /** False for punctuation, symbols and anything else we should not look up. */
  isWord: boolean;
  /** Offset into the original sentence, so callers can map back. */
  start: number;
};

/**
 * Abbreviations the segmenter would otherwise shatter into letters and periods
 * (`z.B.` → `z` `.` `B` `.`). Compared lowercased.
 */
const ABBREVIATIONS = new Set([
  "z.b.",
  "d.h.",
  "u.a.",
  "u.ä.",
  "z.t.",
  "i.d.r.",
  "v.a.",
  "s.o.",
  "s.u.",
  "usw.",
  "bzw.",
  "ca.",
  "etc.",
  "vgl.",
  "evtl.",
  "ggf.",
  "inkl.",
  "max.",
  "min.",
  "nr.",
  "od.",
  "sog.",
  "u.s.w.",
]);

/** How many raw segments an abbreviation may span (`i.d.r.` is 6). */
const MAX_ABBREV_SEGMENTS = 6;

const APOSTROPHES = new Set(["'", "’", "ʼ"]);

type RawSegment = { text: string; isWord: boolean; start: number };

function segment(sentence: string): RawSegment[] {
  const out: RawSegment[] = [];

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("de", { granularity: "word" });
    for (const seg of segmenter.segment(sentence)) {
      if (!seg.segment.trim()) continue;
      out.push({ text: seg.segment, isWord: seg.isWordLike === true, start: seg.index });
    }
    return out;
  }

  // Fallback for environments without Intl.Segmenter.
  const re = /[\p{L}\p{N}]+(?:[\p{L}\p{N}]*)|[^\s\p{L}\p{N}]/gu;
  for (const m of sentence.matchAll(re)) {
    const text = m[0];
    out.push({ text, isWord: /[\p{L}\p{N}]/u.test(text), start: m.index });
  }
  return out;
}

/**
 * Split a German sentence into tokens, punctuation included, in reading order.
 *
 * Two merges are applied on top of plain word segmentation:
 * - clitics: `geht` `'` `s` → `geht's`, so the contraction table can expand it
 * - abbreviations: `z` `.` `B` `.` → `z.B.`
 */
export function tokenize(sentence: string): Token[] {
  const segments = segment(sentence);
  const tokens: Token[] = [];

  for (let i = 0; i < segments.length; i++) {
    const abbrev = matchAbbreviation(segments, i);
    if (abbrev) {
      tokens.push({ text: abbrev.text, isWord: true, start: segments[i].start });
      i = abbrev.lastIndex;
      continue;
    }

    const current = segments[i];

    // `geht` + `'` + `s` — only when all three are adjacent in the source.
    const apostrophe = segments[i + 1];
    const clitic = segments[i + 2];
    if (
      current.isWord &&
      apostrophe &&
      APOSTROPHES.has(apostrophe.text) &&
      clitic?.isWord &&
      apostrophe.start === current.start + current.text.length &&
      clitic.start === apostrophe.start + apostrophe.text.length
    ) {
      tokens.push({
        text: current.text + apostrophe.text + clitic.text,
        isWord: true,
        start: current.start,
      });
      i += 2;
      continue;
    }

    tokens.push({ text: current.text, isWord: current.isWord, start: current.start });
  }

  return tokens;
}

/**
 * Greedily match the longest known abbreviation starting at `from`. Returns the
 * joined text and the index of its final segment, or null.
 */
function matchAbbreviation(
  segments: RawSegment[],
  from: number,
): { text: string; lastIndex: number } | null {
  if (!segments[from].isWord) return null;

  let best: { text: string; lastIndex: number } | null = null;
  let text = "";

  for (let i = from; i < segments.length && i - from < MAX_ABBREV_SEGMENTS; i++) {
    // Abbreviations never span whitespace, so require source adjacency.
    if (i > from && segments[i].start !== segments[i - 1].start + segments[i - 1].text.length) break;
    text += segments[i].text;
    if (ABBREVIATIONS.has(text.toLowerCase())) best = { text, lastIndex: i };
  }

  return best;
}
