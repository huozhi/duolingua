/**
 * Deciding what each token actually is, given the candidates morphology found.
 *
 * There is no statistical model here — the accuracy comes from ordered rules
 * over closed-class tables, agreement, and German's very informative
 * orthography. Roughly, in descending order of how much they contribute:
 *
 *  - closed-class lookup: the ~200 most frequent German words are decided outright
 *  - capitalization: a capitalized word that is not sentence-initial is a noun
 *  - agreement: a preceding pronoun or determiner narrows a verb or noun reading
 *  - position: an adjective between a determiner and a noun is attributive
 *
 * Where the language is genuinely ambiguous — `den Frauen` is dative plural but
 * `die Frauen` is nominative *or* accusative — the ambiguity is preserved as a
 * list of cases rather than resolved by coin flip. The UI renders it as
 * "nom/acc", which is the truthful answer.
 */

import type { Case, Gender, GrammaticalNumber, Person, Pos, Word } from "./analysis.ts";
import { emptyGlosses } from "./analysis.ts";
import type { Features } from "./dictFormat.ts";
import type { Candidate } from "./morphology.ts";
import { isCapitalized } from "./morphology.ts";
import {
  AUXILIARY_LEMMAS,
  MODAL_LEMMAS,
  PREPOSITION_CASE,
  PREPOSITION_OR_CONJUNCTION,
  PRONOUNS,
  closedClassPos,
  determinerAgreements,
  type Agreement,
} from "./germanTables.ts";

/** A token plus everything known about it before context is applied. */
export type Slot = {
  text: string;
  isWord: boolean;
  candidates: Candidate[];
  /** Set by the caller for contractions and clitics. */
  parts?: { text: string; lemma: string; pos: Pos }[];
  /** Case forced by a contraction like `zum` (dative). */
  forcedCase?: Case;
  /** Set when the caller already knows better — a separated verb prefix, say. */
  forcedPos?: Pos;
  note?: string;
};

const VERB_POS = new Set<Pos>(["verb", "auxiliary-verb", "modal-verb"]);

/**
 * Assign a part of speech and grammatical features to every slot.
 */
export function tag(slots: Slot[]): Word[] {
  // Whether the sentence contains a finite auxiliary at all: this decides whether
  // `gelesen` is the participle of a compound tense or a plain adjective.
  const context: Context = {
    hasAuxiliary: slots.some((slot) =>
      slot.candidates.some((c) => AUXILIARY_LEMMAS.has(c.lemma) && c.readings.some((r) => r.person || r.tense)),
    ),
  };

  const words: Word[] = slots.map((slot, index) => ({
    text: slot.text,
    pos: choosePos(slot, index, slots, context),
    lemma: slot.text,
    glosses: emptyGlosses(),
    gender: null,
    cases: [],
    number: null,
    person: null,
    tense: null,
    note: slot.note ?? null,
    compound: null,
    parts: slot.parts ?? null,
  }));

  // Attach the candidate matching the chosen part of speech, so glosses and
  // gender come from the right entry rather than the first one.
  slots.forEach((slot, index) => {
    const word = words[index];
    const candidate = pickCandidate(slot, word.pos);
    if (!candidate) return;

    word.lemma = candidate.lemma;
    word.glosses = candidate.glosses;
    // A determiner or pronoun has no lexical gender of its own — the dictionary
    // entry for `der` happens to say feminine, which means nothing here. Its
    // gender comes from agreement instead, further down.
    if (word.pos !== "article" && word.pos !== "pronoun") word.gender = candidate.gender;
    if (candidate.parts) word.compound = candidate.parts;
  });

  assignNounPhrases(words, slots);
  assignVerbFeatures(words, slots);
  assignAnalyticTenses(words);

  return words;
}

// ---------------------------------------------------------------------------
// Part of speech
// ---------------------------------------------------------------------------

/** Sentence-level facts computed once and consulted by the per-token rules. */
type Context = { hasAuxiliary: boolean };

function choosePos(slot: Slot, index: number, slots: Slot[], context: Context): Pos {
  if (!slot.isWord) return "punctuation";
  if (slot.forcedPos) return slot.forcedPos;
  if (/^\p{N}[\p{N}.,:]*$/u.test(slot.text)) return "numeral";

  const lower = slot.text.toLocaleLowerCase("de-DE");

  // `während des Krieges` versus `während ich schlief`: a clause follows the
  // conjunction, a noun phrase follows the preposition.
  if (PREPOSITION_OR_CONJUNCTION.has(lower)) {
    return introducesClause(slots, index) ? "conjunction" : "preposition";
  }

  // `, das ich gelesen habe` — after a comma, a definite article is relative.
  if (isRelativePronoun(slot, index, slots)) return "pronoun";

  const closed = closedClassPos(slot.text);
  if (closed) return closed;

  const candidates = slot.candidates;

  // A determiner the dictionary files as a pronoun — `jeden Tag`, `dieses Buch`.
  if (determinerAgreements(slot.text) && startsNounPhrase(slots, index)) return "article";

  // `gelesen` is the participle of `lesen` when the sentence has an auxiliary to
  // build a compound tense with, and the adjective "read" otherwise.
  if (context.hasAuxiliary) {
    const participle = candidates.find(
      (c) => c.pos === "verb" && c.readings.some((r) => r.tense === "Partizip II"),
    );
    if (participle) return "verb";
  }

  // Lemma-level overrides: the dictionary calls these plain verbs.
  const verbLemma = candidates.find((c) => VERB_POS.has(c.pos));
  if (verbLemma) {
    if (MODAL_LEMMAS.has(verbLemma.lemma)) return "modal-verb";
    if (AUXILIARY_LEMMAS.has(verbLemma.lemma)) return "auxiliary-verb";
  }

  // A capitalized word mid-sentence is a noun. This single rule is worth more in
  // German than any amount of suffix guessing.
  const capitalizedMidSentence = isCapitalized(slot.text) && index > 0 && !afterSentenceBreak(slots, index);
  if (capitalizedMidSentence) {
    const noun = candidates.find((c) => c.pos === "noun");
    if (noun) return "noun";
    // Unknown capitalized word: still a noun, just not one we have.
    if (!candidates.length) return "noun";
  }

  if (!candidates.length) return "other";

  // An adjective sitting between a determiner and a noun is attributive.
  if (candidates.some((c) => c.pos === "adjective") && isAttributivePosition(slots, index)) {
    return "adjective";
  }

  // Prefer the most confident candidate; on a tie, the earlier part of speech in
  // the dictionary's own ordering wins.
  const best = [...candidates].sort((a, b) => a.confidence - b.confidence)[0];
  return best.pos;
}

/** True when the token after this one starts a clause rather than a noun phrase. */
function introducesClause(slots: Slot[], index: number): boolean {
  for (let i = index + 1; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot.isWord) break;
    const lower = slot.text.toLocaleLowerCase("de-DE");
    if (PRONOUNS[lower]) return true;
    if (determinerAgreements(slot.text)) return false;
    if (slot.candidates.some((c) => c.pos === "noun")) return false;
    if (slot.candidates.some((c) => VERB_POS.has(c.pos))) return true;
  }
  return false;
}

/**
 * `das` in `Das Buch, das ich gelesen habe` is a relative pronoun the second
 * time: it directly follows a comma and is followed by something other than a
 * noun phrase.
 */
function isRelativePronoun(slot: Slot, index: number, slots: Slot[]): boolean {
  const lower = slot.text.toLocaleLowerCase("de-DE");
  if (!["der", "die", "das", "dem", "den", "denen", "dessen", "deren"].includes(lower)) return false;
  if (index === 0 || slots[index - 1].text !== ",") return false;

  const next = slots[index + 1];
  if (!next?.isWord) return false;
  const nextLower = next.text.toLocaleLowerCase("de-DE");
  return Boolean(PRONOUNS[nextLower]) || next.candidates.some((c) => VERB_POS.has(c.pos));
}

function afterSentenceBreak(slots: Slot[], index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    if (slots[i].isWord) return false;
    if (/^[.!?:;]$/.test(slots[i].text)) return true;
  }
  return true;
}

/** True when an adjective or noun follows closely enough to form one phrase. */
function startsNounPhrase(slots: Slot[], index: number): boolean {
  return slots
    .slice(index + 1, index + 4)
    .some(
      (slot) =>
        slot.isWord &&
        (isCapitalized(slot.text) || slot.candidates.some((c) => c.pos === "noun" || c.pos === "adjective")),
    );
}

function isAttributivePosition(slots: Slot[], index: number): boolean {
  const hasDeterminerBefore = slots
    .slice(Math.max(0, index - 3), index)
    .some((slot) => determinerAgreements(slot.text) !== null);
  const hasNounAfter = slots
    .slice(index + 1, index + 4)
    .some((slot) => isCapitalized(slot.text) || slot.candidates.some((c) => c.pos === "noun"));
  return hasDeterminerBefore && hasNounAfter;
}

function pickCandidate(slot: Slot, pos: Pos): Candidate | undefined {
  const wanted =
    pos === "modal-verb" || pos === "auxiliary-verb"
      ? slot.candidates.filter((c) => VERB_POS.has(c.pos))
      : slot.candidates.filter((c) => c.pos === pos);

  const pool = wanted.length ? wanted : slot.candidates;

  // Among candidates of the right part of speech, prefer one that can actually
  // say something. Wiktionary has an entry for the pronoun `das` with no
  // translations at all, which would otherwise shadow the entry for `der` that
  // has them — and an empty gloss is the one thing this app must not produce.
  const informative = (candidate: Candidate) =>
    candidate.glosses.en.length + candidate.glosses.es.length + candidate.glosses.zh.length > 0 ? 0 : 1;

  return [...pool].sort((a, b) => informative(a) - informative(b) || a.confidence - b.confidence)[0];
}

// ---------------------------------------------------------------------------
// Noun phrases: case, number, gender
// ---------------------------------------------------------------------------

/**
 * Walk each noun phrase and intersect three sources of case information: the
 * determiner's paradigm, the governing preposition, and the noun's own stored
 * readings. What survives is the answer; if several survive, all are kept.
 */
function assignNounPhrases(words: Word[], slots: Slot[]) {
  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (word.pos === "article" || word.pos === "pronoun") {
      applyAgreements(word, agreementsFor(slots[i], word));
    }

    if (word.pos !== "noun") continue;

    // Collect the phrase: determiner and adjectives immediately before the noun.
    let start = i;
    while (start > 0 && (words[start - 1].pos === "article" || words[start - 1].pos === "adjective")) {
      start--;
    }

    const determiner = words.slice(start, i).find((w) => w.pos === "article");
    const determinerSlot = determiner ? slots[words.indexOf(determiner)] : undefined;

    // What the noun's own form says — `Häuser` is plural and never dative.
    const nounReadings = readingsOf(slots[i], word);
    const nounCases = unique(nounReadings.map((r) => r.case).filter(Boolean) as Case[]);
    const nounNumbers = unique(nounReadings.map((r) => r.number).filter(Boolean) as GrammaticalNumber[]);

    let cases: Case[] | null = null;
    let number: GrammaticalNumber | null = null;
    const gender: Gender | null =
      word.gender ?? onlyValue(nounReadings.map((r) => r.gender).filter(Boolean) as Gender[]);

    if (determiner && determinerSlot) {
      // Narrow the determiner's readings by everything the noun already fixes.
      // `der` has four readings; `der Hund` has one, because `Hund` is masculine
      // and its bare form is singular.
      let agreements = agreementsFor(determinerSlot, determiner);
      agreements = narrow(agreements, (ag) => !ag.gender || !gender || ag.gender === gender);
      agreements = narrow(agreements, (ag) => !nounCases.length || nounCases.includes(ag.case));
      agreements = narrow(agreements, (ag) => !nounNumbers.length || nounNumbers.includes(ag.number));

      cases = unique(agreements.map((ag) => ag.case));
      number = onlyValue(agreements.map((ag) => ag.number));
    } else {
      cases = nounCases.length ? nounCases : null;
      number = onlyValue(nounNumbers);
    }

    // A preposition before the phrase governs its case.
    const preposition = start > 0 ? prepositionCase(words[start - 1], slots[start - 1]) : null;
    if (preposition) cases = cases ? intersect(cases, preposition) : preposition;

    number ??= onlyValue(nounNumbers);

    word.cases = cases ?? [];
    word.number = number;
    word.gender = gender;

    // Adjectives and the determiner inherit the phrase's resolved features.
    for (let j = start; j < i; j++) {
      if (words[j].pos !== "adjective" && words[j].pos !== "article") continue;
      words[j].cases = word.cases;
      words[j].number ??= word.number;
      words[j].gender ??= word.gender;
    }
  }
}

function agreementsFor(slot: Slot, word: Word): Agreement[] {
  const lower = slot.text.toLocaleLowerCase("de-DE");
  const fromTable = word.pos === "pronoun" ? PRONOUNS[lower] : determinerAgreements(slot.text);
  if (fromTable?.length) return fromTable;

  // Fall back to whatever the dictionary stored for the form.
  return readingsOf(slot, word)
    .filter((r) => r.case)
    .map((r) => ({ case: r.case!, number: r.number ?? "singular", gender: r.gender }));
}

function applyAgreements(word: Word, agreements: Agreement[]) {
  if (!agreements.length) return;
  word.cases = unique(agreements.map((ag) => ag.case));
  word.number ??= onlyValue(agreements.map((ag) => ag.number));
  word.gender ??= onlyValue(agreements.map((ag) => ag.gender).filter(Boolean) as Gender[]);

  const lower = word.text.toLocaleLowerCase("de-DE");
  const readings = PRONOUNS[lower];
  if (readings) word.person ??= onlyValue(readings.map((r) => r.person).filter(Boolean) as Person[]);
}

function prepositionCase(word: Word, slot: Slot): Case[] | null {
  if (word.pos !== "preposition") return null;
  if (slot.forcedCase) return [slot.forcedCase];
  return PREPOSITION_CASE[word.text.toLocaleLowerCase("de-DE")] ?? null;
}

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

/**
 * Pick a verb reading, using the subject pronoun when there is one: the
 * dictionary says `stehe` is present tense in several persons, but `ich stehe`
 * can only be first person singular.
 */
function assignVerbFeatures(words: Word[], slots: Slot[]) {
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!VERB_POS.has(word.pos)) continue;

    const readings = readingsOf(slots[i], word);
    if (!readings.length) continue;

    const subject = nearbySubject(words, i);
    const agreeing = subject
      ? readings.filter(
          (r) =>
            (!r.person || !subject.person || r.person === subject.person) &&
            (!r.number || !subject.number || r.number === subject.number),
        )
      : readings;


    const pool = agreeing.length ? agreeing : readings;
    word.person = onlyValue(pool.map((r) => r.person).filter(Boolean) as Person[]);
    word.number = onlyValue(pool.map((r) => r.number).filter(Boolean) as GrammaticalNumber[]);
    word.tense = onlyValue(pool.map((r) => r.tense).filter(Boolean) as string[]);
  }
}

/**
 * The nearest pronoun or noun that could be the subject of a verb, reduced to the
 * person and number it imposes. A noun subject is always third person, which is
 * what picks `springt` apart into third singular rather than second.
 */
function nearbySubject(
  words: Word[],
  verbIndex: number,
): { person: Person | null; number: GrammaticalNumber | null } | null {
  for (const offset of [-1, 1, -2, 2]) {
    const candidate = words[verbIndex + offset];
    if (!candidate) continue;
    if (!candidate.cases.includes("nominative")) continue;

    if (candidate.pos === "pronoun") {
      return { person: candidate.person, number: candidate.number };
    }
    if (candidate.pos === "noun") {
      return { person: "3", number: candidate.number };
    }
  }
  return null;
}

/**
 * German builds its perfect and future from an auxiliary plus a non-finite verb
 * at the other end of the clause. Name the construction on the participle, which
 * is where a learner looks for it.
 */
function assignAnalyticTenses(words: Word[]) {
  const auxiliaries = words.filter((w) => w.pos === "auxiliary-verb");
  if (!auxiliaries.length) return;

  for (const word of words) {
    if (word.pos !== "verb") continue;

    if (word.tense === "Partizip II") {
      const haben = auxiliaries.some((a) => a.lemma === "haben");
      const sein = auxiliaries.some((a) => a.lemma === "sein");
      const werden = auxiliaries.some((a) => a.lemma === "werden");
      if (werden) word.note ??= "passive, with werden";
      else if (haben || sein) {
        word.tense = "Perfekt";
        word.note ??= `Perfekt, with ${haben ? "haben" : "sein"}`;
      }
    } else if (word.tense === "infinitive" && auxiliaries.some((a) => a.lemma === "werden")) {
      word.tense = "Futur I";
    }
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Every grammatical reading the chosen lemma has for this surface form.
 *
 * Merged across candidates rather than taken from the first match: the same lemma
 * arrives twice, once as an exact dictionary hit with no readings and once from
 * the form index with them, and only the union is the whole picture.
 */
function readingsOf(slot: Slot, word: Word): Features[] {
  const matching = slot.candidates.filter((c) => c.lemma === word.lemma);
  const pool = matching.length ? matching : slot.candidates.slice(0, 1);
  return pool.flatMap((c) => c.readings);
}

/** Apply a filter unless it would leave nothing — evidence should never subtract. */
function narrow<T>(values: T[], predicate: (value: T) => boolean): T[] {
  const kept = values.filter(predicate);
  return kept.length ? kept : values;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * Intersection that never empties: when two sources of case information
 * contradict each other, keep the one accumulated so far rather than claiming the
 * word has no case at all.
 */
function intersect<T>(accumulated: T[], incoming: T[]): T[] {
  const both = accumulated.filter((value) => incoming.includes(value));
  return both.length ? both : accumulated;
}

/** The single distinct value in a list, or null when absent or ambiguous. */
function onlyValue<T>(values: T[]): T | null {
  const distinct = unique(values.filter((v) => v !== undefined && v !== null));
  return distinct.length === 1 ? distinct[0] : null;
}
