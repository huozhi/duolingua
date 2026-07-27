/**
 * Turning a German sentence into per-token analysis.
 *
 * The order of work matters: multiword phenomena have to be handled before the
 * tagger runs, because a separated verb prefix changes what the verb *is*
 * (`stehe … auf` is `aufstehen`, not `stehen`), and a contraction changes the
 * case of the noun phrase after it (`zum Bahnhof` is dative).
 */

import type { Analysis } from "./analysis.ts";
import type { DictStore } from "./dictStore.ts";
import { SEPARABLE_PARTICLES } from "./germanTables.ts";
import { expandClitic, expandContraction, joinSeparableVerb, resolve } from "./morphology.ts";
import { tag, type Slot } from "./tagger.ts";
import { tokenize } from "./tokenize.ts";

/**
 * Punctuation that ends a clause. Commas count: a separated prefix belongs to its
 * own clause, as in `Ich rufe dich an, wenn ich Zeit habe`.
 */
const CLAUSE_END = /^[.!?;:,]$/;

export async function glossSentence(sentence: string, store: DictStore): Promise<Analysis> {
  const slots: Slot[] = [];

  for (const token of tokenize(sentence)) {
    if (!token.isWord) {
      slots.push({ text: token.text, isWord: false, candidates: [] });
      continue;
    }

    const contraction = expandContraction(token.text);
    if (contraction) {
      slots.push({
        text: token.text,
        isWord: true,
        candidates: await resolve(store, token.text),
        parts: [
          { text: contraction.preposition, lemma: contraction.preposition, pos: "preposition" },
          { text: contraction.article, lemma: contraction.article, pos: "article" },
        ],
        forcedCase: contraction.case,
        forcedPos: "preposition",
        note: `contraction of ${contraction.preposition} + ${contraction.article}`,
      });
      continue;
    }

    const clitic = expandClitic(token.text);
    if (clitic) {
      slots.push({
        text: token.text,
        isWord: true,
        candidates: await resolve(store, clitic.host),
        parts: [
          { text: clitic.host, lemma: clitic.host, pos: "verb" },
          { text: clitic.clitic, lemma: "es", pos: "pronoun" },
        ],
        note: `spoken contraction of ${clitic.host} + es`,
      });
      continue;
    }

    slots.push({ text: token.text, isWord: true, candidates: await resolve(store, token.text) });
  }

  await mergeSeparableVerbs(store, slots);

  return { sentence, words: tag(slots) };
}

/**
 * Reunite finite verbs with their separated prefixes.
 *
 * Two things keep this honest. The prefix must be the *last* word of the clause,
 * which is where German puts it — otherwise `Der Hund springt über den Zaun`
 * would be read as `überspringen` with a stray noun phrase, since `springt über`
 * is a real form of a real verb. And the combination is looked up as data
 * (`stehe auf` was indexed as a form of `aufstehen`), so no rule has to know
 * which verb + particle pairs exist.
 */
async function mergeSeparableVerbs(store: DictStore, slots: Slot[]) {
  for (let i = 0; i < slots.length; i++) {
    const verb = slots[i];
    if (!verb.isWord || verb.parts) continue;
    if (!verb.candidates.some((c) => c.pos === "verb")) continue;

    const particle = clauseFinalWord(slots, i);
    if (!particle || particle.forcedPos) continue;
    if (!SEPARABLE_PARTICLES.has(particle.text.toLocaleLowerCase("de-DE"))) continue;

    const joined = await joinSeparableVerb(store, verb.text, particle.text);
    if (!joined.length) continue;

    const lemma = joined[0].lemma;
    verb.candidates = [...joined, ...verb.candidates];
    verb.parts = [
      { text: verb.text, lemma, pos: "verb" },
      { text: particle.text, lemma, pos: "particle" },
    ];
    verb.note = `separable verb: ${lemma}`;

    particle.forcedPos = "particle";
    particle.note = `separated prefix of ${lemma}`;
  }
}

/** The last word of the clause containing `from`, or null if that is `from` itself. */
function clauseFinalWord(slots: Slot[], from: number): Slot | null {
  let last: Slot | null = null;
  for (let j = from + 1; j < slots.length; j++) {
    if (!slots[j].isWord) {
      if (CLAUSE_END.test(slots[j].text)) break;
      continue;
    }
    last = slots[j];
  }
  return last;
}
