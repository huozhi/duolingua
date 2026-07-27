/**
 * HanDeDict stores pinyin CEDICT-style, with tones as trailing digits and `u:`
 * for ü — `zhi2 qian2`. Learners want `zhíqián`, so convert once at build time.
 *
 * (Wiktionary already ships diacritics in its `roman` field, so this is only
 * needed for the HanDeDict half of the Chinese glosses.)
 */

/** Toned vowels indexed by tone 1-5; tone 5 (neutral) is the bare vowel. */
const TONED: Record<string, string> = {
  a: "āáǎàa",
  e: "ēéěèe",
  i: "īíǐìi",
  o: "ōóǒòo",
  u: "ūúǔùu",
  ü: "ǖǘǚǜü",
};

/**
 * Which vowel carries the mark: a, then o, then e; failing those, the last
 * vowel in the syllable — which is what makes `iu` → `iù` but `ui` → `uì`.
 */
function toneTarget(syllable: string): number {
  for (const vowel of ["a", "o", "e"]) {
    const at = syllable.indexOf(vowel);
    if (at !== -1) return at;
  }
  for (let i = syllable.length - 1; i >= 0; i--) {
    if ("iuü".includes(syllable[i])) return i;
  }
  return -1;
}

function convertSyllable(raw: string): string {
  const match = /^([a-zA-ZüÜ:]+?)([1-5])$/.exec(raw);
  if (!match) return raw.replace(/u:/g, "ü").replace(/v/g, "ü");

  const [, letters, toneDigit] = match;
  const normalized = letters.replace(/u:/g, "ü").replace(/v/g, "ü");
  const tone = Number(toneDigit);
  if (tone === 5) return normalized;

  const lower = normalized.toLowerCase();
  const at = toneTarget(lower);
  if (at === -1) return normalized;

  const vowel = lower[at];
  const toned = TONED[vowel]?.[tone - 1];
  if (!toned) return normalized;

  // Preserve the original casing of the marked letter (proper nouns: Běijīng).
  const replacement = normalized[at] === normalized[at].toUpperCase() ? toned.toUpperCase() : toned;
  return normalized.slice(0, at) + replacement + normalized.slice(at + 1);
}

/**
 * `zhi2 qian2` → `zhíqián`. Syllables are joined, with an apostrophe inserted
 * where pinyin orthography needs one to keep the boundary readable (`Xī'ān`).
 */
export function toDiacriticPinyin(numeric: string): string {
  const syllables = numeric.trim().split(/\s+/).filter(Boolean).map(convertSyllable);

  let out = "";
  for (const syllable of syllables) {
    if (out && /^[aeoāáǎàēéěèōóǒò]/i.test(syllable)) out += "'";
    out += syllable;
  }
  return out;
}
