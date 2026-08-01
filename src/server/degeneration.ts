/**
 * Removing repetition that the translation models produce on short inputs.
 *
 * `opus-mt-en-zh` does not stop cleanly when given a fragment: it emits the same
 * clause several times, or the same sentence several times. Decoding parameters
 * cannot fix it (see the note on `GENERATION` in `mt.ts`), so the repetition is
 * removed from the finished string.
 *
 * The hard requirement is that this must never silently delete meaning. Both rules
 * below are therefore conservative: they only drop material that adds no
 * characters the output does not already contain, or that violates the
 * one-sentence-in-one-sentence-out invariant for a language where multi-sentence
 * output is not idiomatic.
 */

/** Clause separators inside a sentence. Chinese leans on these heavily. */
const CLAUSE_SPLIT = /([,，、;；]\s*)/;
/** Does this text contain Han characters or kana? */
const CJK = /[぀-ヿ㐀-䶿一-鿿]/;
/** At or below this many source words, multi-clause output is padding. */
const SHORT_SOURCE_WORDS = 4;

/**
 * Split text into sentences.
 *
 * These are sentence-level models: given two sentences in one call they translate
 * the first and silently drop the rest — "Es regnet. Ich bleibe zu Hause." came
 * back as just "It's raining." So the caller splits, translates each, and rejoins.
 */
export function splitSentences(text: string): string[] {
  const matched = text.match(/[^.!?。！？]+[.!?。！？]*\s*/g);
  return (matched ?? [text]).map((sentence) => sentence.trim()).filter(Boolean);
}

/**
 * Rejoin translated sentences. Chinese does not separate sentences with spaces,
 * and its punctuation already provides the break.
 */
export function joinSentences(sentences: string[]): string {
  const kept = sentences.filter(Boolean);
  if (!kept.some((sentence) => CJK.test(sentence))) return kept.join(" ").trim();

  // These models often omit final punctuation in Chinese. Concatenating without it
  // would run two sentences together — 下雨了我会待在家里 — so supply the stop the
  // model left out.
  return kept
    .map((sentence, index) =>
      index === kept.length - 1 || /[。！？.!?]$/.test(sentence) ? sentence : sentence + "。",
    )
    .join("")
    .trim();
}

/**
 * Split into sentences, keeping terminating punctuation *and* trailing whitespace
 * attached. Keeping the whitespace means the pieces can be rejoined by
 * concatenation — inventing a separator would put spaces between Chinese
 * sentences, which do not take them.
 */
function intoSentences(text: string): string[] {
  const matched = text.match(/[^.!?。！？]+[.!?。！？]*\s*/g);
  return (matched ?? [text]).filter((sentence) => sentence.trim());
}

/** The set of meaning-bearing characters in a fragment, ignoring punctuation. */
function characters(fragment: string): Set<string> {
  return new Set(fragment.replace(/[\s\p{P}\p{S}]/gu, ""));
}

function isSubsetOf(inner: Set<string>, outer: Set<string>): boolean {
  if (!inner.size) return true;
  for (const character of inner) if (!outer.has(character)) return false;
  return true;
}

/**
 * Drop segments that repeat material already present.
 *
 * The test is character-set containment, not similarity: a segment is dropped only
 * when every character in it already appeared in a segment we kept. That removes
 * `我好冷,我冷,我冷,我冷…` down to `我好冷` while leaving `我喜欢猫,我喜欢狗`
 * ("I like cats, I like dogs") intact, because 狗 is a character the first clause
 * does not have.
 */
function dedupeSegments(sentence: string, splitter: RegExp): string {
  const pieces = sentence.split(splitter);
  if (pieces.length < 3) return sentence;

  let kept = "";
  let seen = new Set<string>();
  let pendingSeparator = "";

  for (let i = 0; i < pieces.length; i += 2) {
    const clause = pieces[i];
    const separator = pieces[i + 1] ?? "";
    const chars = characters(clause);

    if (!kept) {
      kept = clause;
      seen = chars;
      pendingSeparator = separator;
      continue;
    }

    if (isSubsetOf(chars, seen)) continue;

    kept += pendingSeparator + clause;
    for (const character of chars) seen.add(character);
    pendingSeparator = separator;
  }

  return kept;
}

/**
 * Chinese does not put spaces between words, so a space between two chunks of pure
 * Chinese inside a single sentence is the model padding rather than writing: `Guten
 * Tag` came back as `下午好 午安`, two separate greetings. Keep the first chunk.
 *
 * Guarded on every chunk being free of Latin letters and digits, because those do
 * take spaces in Chinese text — `iPhone 15 很好` must survive intact.
 */
function firstChunkIfAllChinese(sentence: string): string {
  const chunks = sentence.trim().split(/\s+/);
  if (chunks.length < 2) return sentence;
  if (chunks.some((chunk) => /[A-Za-z0-9]/.test(chunk))) return sentence;
  return chunks[0];
}

/**
 * Collapse repetition within one sentence.
 *
 * Clause separators first, then — for Chinese only — whitespace. Chinese does not
 * separate words with spaces, so a space inside Chinese output is the model
 * segmenting its own repetition: `Ja` came back as `是 是 是`. Latin text is left
 * alone here, because there the same rule would happily delete words.
 */
function collapseClauses(sentence: string): string {
  let kept = dedupeSegments(sentence, CLAUSE_SPLIT);
  if (CJK.test(kept)) {
    kept = dedupeSegments(kept, /(\s+)/);
    kept = firstChunkIfAllChinese(kept);
  }

  // If the dropped tail carried the sentence's punctuation, put it back.
  const trailing = /([.!?。！？]+)\s*$/.exec(sentence);
  if (trailing && !kept.trimEnd().endsWith(trailing[1])) kept = kept.trimEnd() + trailing[1];
  return kept;
}

/**
 * Clean up one translation.
 *
 * `sourceSentences` is how many sentences the input had. When the input was a
 * single sentence and `collapseSentences` is set, only the first output sentence
 * is kept — a single German sentence rendered as three Chinese ones is
 * degeneration rather than style, and Chinese would use clause commas anyway.
 * That truncation is deliberately *not* applied to English or Spanish, where
 * splitting one long source sentence into two is a legitimate thing for a
 * translator to do.
 */
export function collapseRepetition(
  text: string,
  {
    sourceSentences,
    collapseSentences,
    sourceWords = Infinity,
    sourceText = "",
  }: {
    sourceSentences: number;
    collapseSentences: boolean;
    sourceWords?: number;
    sourceText?: string;
  },
): string {
  const sentences = intoSentences(text);

  let chosen = sentences;
  if (collapseSentences && sourceSentences <= 1 && sentences.length > 1) {
    chosen = [sentences[0]];
  } else {
    // Even where truncation does not apply, an exactly repeated sentence is never
    // meaningful.
    const seen = new Set<string>();
    chosen = sentences.filter((sentence) => {
      const key = sentence.replace(/[\s\p{P}\p{S}]/gu, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  let result = chosen.map(collapseClauses).join("").trim();

  // A source of a few words cannot legitimately need several clauses. Short inputs
  // are where these models pad, and the padding is not always a repetition: "It's
  // raining." produced 下雨了,我还想说 — "it's raining, I still want to say".
  // Nothing about that clause is detectable as noise from its characters alone, so
  // the guard is the length of the source instead.
  if (collapseSentences && sourceWords <= SHORT_SOURCE_WORDS) {
    result = result.split(CLAUSE_SPLIT)[0];
  }

  // Unknown Latin tokens can make the English → Chinese model emit a character
  // followed by the input over and over with no separator: `bibi` became
  // `二bibibibibibi…`. With no word boundary, the clause rules above cannot see
  // the loop. If the complete source text appears at least three times, the model
  // has not translated it; preserving the source is more honest than displaying
  // fabricated repetition.
  const echo = sourceText.trim();
  if (collapseSentences && echo.length >= 2) {
    const haystack = result.toLocaleLowerCase();
    const needle = echo.toLocaleLowerCase();
    let count = 0;
    let offset = 0;
    while ((offset = haystack.indexOf(needle, offset)) !== -1 && count < 3) {
      count += 1;
      offset += needle.length;
    }
    if (count >= 3) return echo;
  }

  return result.trim();
}
