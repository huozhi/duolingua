/**
 * End-to-end fixtures: German sentence in, analysed tokens out, against the real
 * dictionary in `data/dict/`.
 *
 * Each case pins the phenomenon it is there to protect, so a regression names
 * itself — "separable verb" failing is a different bug from "compound" failing.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import type { Analysis, Word } from "./analysis.ts";
import { createDictStore } from "./dict-store.ts";
import { glossSentence } from "./gloss.ts";

const DICT_DIR = join(import.meta.dirname, "..", "..", "data", "dict");
const built = existsSync(join(DICT_DIR, "manifest.json"));

const store = createDictStore(async (name) => {
  try {
    return await readFile(join(DICT_DIR, name));
  } catch {
    return null;
  }
});

function find(analysis: Analysis, text: string): Word {
  const word = analysis.words.find((w) => w.text === text);
  assert.ok(word, `expected a token "${text}" in "${analysis.sentence}"`);
  return word;
}

/** Every token is present, in order, punctuation included. */
test("tokens round-trip the sentence", { skip: !built }, async () => {
  const sentence = "Der schnelle Hund springt über den faulen Zaun.";
  const analysis = await glossSentence(sentence, store);
  assert.equal(analysis.words.map((w) => w.text).join(" "), sentence.replace(".", " ."));
  assert.equal(analysis.words.at(-1)?.pos, "punctuation");
});

test("a simple main clause gets case, gender and number right", { skip: !built }, async () => {
  const analysis = await glossSentence("Der schnelle Hund springt über den faulen Zaun.", store);

  const hund = find(analysis, "Hund");
  assert.equal(hund.pos, "noun");
  assert.equal(hund.gender, "masculine");
  assert.deepEqual(hund.cases, ["nominative"]);
  assert.equal(hund.number, "singular");
  assert.ok(hund.glosses.en.some((g) => g.text === "dog"));

  // `über` + movement takes the accusative, and `den` agrees.
  const zaun = find(analysis, "Zaun");
  assert.deepEqual(zaun.cases, ["accusative"]);
  assert.equal(find(analysis, "den").pos, "article");
  assert.deepEqual(find(analysis, "den").cases, ["accusative"]);

  // The attributive adjective inherits the phrase's features.
  const schnelle = find(analysis, "schnelle");
  assert.equal(schnelle.pos, "adjective");
  assert.equal(schnelle.lemma, "schnell");

  const springt = find(analysis, "springt");
  assert.equal(springt.pos, "verb");
  assert.equal(springt.lemma, "springen");
  assert.equal(springt.person, "3");
  assert.equal(springt.tense, "present");
});

test("a preposition that looks like a verb prefix stays a preposition", { skip: !built }, async () => {
  // `springt über` is a genuine form of `überspringen`, so only the clause-final
  // position rule keeps this sentence honest.
  const analysis = await glossSentence("Der Hund springt über den Zaun.", store);
  assert.equal(find(analysis, "über").pos, "preposition");
  assert.equal(find(analysis, "springt").lemma, "springen");
});

test("separable verbs are reunited with their prefix", { skip: !built }, async () => {
  const analysis = await glossSentence("Ich stehe jeden Tag früh auf.", store);

  const stehe = find(analysis, "stehe");
  assert.equal(stehe.lemma, "aufstehen");
  assert.equal(stehe.person, "1");
  assert.ok(stehe.note?.includes("separable"));
  assert.deepEqual(stehe.parts?.map((p) => p.text), ["stehe", "auf"]);

  const auf = find(analysis, "auf");
  assert.equal(auf.pos, "particle");
  assert.ok(auf.note?.includes("aufstehen"));
});

test("contractions are split and govern their noun phrase", { skip: !built }, async () => {
  const analysis = await glossSentence("Wir müssen morgen früh zum Bahnhof fahren.", store);

  const zum = find(analysis, "zum");
  assert.equal(zum.pos, "preposition");
  assert.deepEqual(zum.parts?.map((p) => p.text), ["zu", "dem"]);

  // `zu` is dative, so the noun after the contraction must be too.
  assert.deepEqual(find(analysis, "Bahnhof").cases, ["dative"]);

  assert.equal(find(analysis, "müssen").pos, "modal-verb");
  assert.equal(find(analysis, "morgen").pos, "adverb");
  // Lowercase `früh` is the adjective, not the noun `Früh`.
  assert.equal(find(analysis, "früh").lemma, "früh");
  assert.equal(find(analysis, "fahren").pos, "verb");
});

test("compound tenses are named on the participle", { skip: !built }, async () => {
  const analysis = await glossSentence("Das Buch, das ich gelesen habe, war gut.", store);

  const gelesen = find(analysis, "gelesen");
  assert.equal(gelesen.pos, "verb");
  assert.equal(gelesen.lemma, "lesen");
  assert.equal(gelesen.tense, "Perfekt");
  assert.ok(gelesen.note?.includes("haben"));

  assert.equal(find(analysis, "habe").pos, "auxiliary-verb");
  assert.equal(find(analysis, "war").tense, "Präteritum");
  // `war` is first *or* third person; claiming either would be a guess.
  assert.equal(find(analysis, "war").person, null);
  // Lowercase `gut` is the adjective, not the noun `Gut`.
  assert.equal(find(analysis, "gut").pos, "adjective");
});

test("a definite article after a comma is a relative pronoun", { skip: !built }, async () => {
  const analysis = await glossSentence("Das Buch, das ich gelesen habe, war gut.", store);
  const [first, second] = analysis.words.filter((w) => w.text.toLowerCase() === "das");
  assert.equal(first.pos, "article");
  assert.equal(second.pos, "pronoun");
  assert.ok(second.glosses.en.length > 0, "the relative pronoun should still be glossed");
});

test("unknown compounds are split and take the head's gender", { skip: !built }, async () => {
  // Not in Wiktionary — German compounding is unbounded, so this is the normal
  // case for real text rather than an edge case.
  const analysis = await glossSentence("Die Bahnhofskatze ist weg.", store);

  const compound = find(analysis, "Bahnhofskatze");
  assert.equal(compound.pos, "noun");
  // `Katze` is feminine, so the compound is, and the linking `-s-` is absorbed.
  assert.equal(compound.gender, "feminine");
  assert.deepEqual(compound.compound?.map((p) => p.lemma), ["Bahnhof", "Katze"]);
  assert.ok(compound.glosses.en.some((g) => g.text === "cat"));
});

test("compound splitting prefers the shallowest reading", { skip: !built }, async () => {
  // Regression: recursing before trying every linking morpheme read this as
  // `Kaff` + `ETA` + `Sen` + `Rand`, four parts of nonsense.
  const analysis = await glossSentence("Der Kaffeetassenrand war schmutzig.", store);
  assert.deepEqual(find(analysis, "Kaffeetassenrand").compound?.map((p) => p.lemma), [
    "Kaffeetasse",
    "Rand",
  ]);
});

test("a known compound is used whole rather than split", { skip: !built }, async () => {
  const analysis = await glossSentence("Die Bahnhofsuhr ist kaputt.", store);
  const word = find(analysis, "Bahnhofsuhr");
  assert.equal(word.compound, null);
  assert.ok(word.glosses.en.some((g) => g.text === "station clock"));
});

test("syncretism is reported, not guessed away", { skip: !built }, async () => {
  const analysis = await glossSentence("Das Buch war gut.", store);
  // `das Buch` is nominative or accusative and nothing in the sentence decides it.
  assert.deepEqual(find(analysis, "Buch").cases, ["nominative", "accusative"]);
});

test("dative experiencers keep their case", { skip: !built }, async () => {
  const analysis = await glossSentence("Mir ist kalt.", store);
  const mir = find(analysis, "Mir");
  assert.equal(mir.pos, "pronoun");
  assert.deepEqual(mir.cases, ["dative"]);
  assert.equal(mir.person, "1");
  assert.equal(find(analysis, "ist").pos, "auxiliary-verb");
});

test("irregular plurals resolve and report plural", { skip: !built }, async () => {
  const analysis = await glossSentence("Die Häuser sind alt.", store);
  const haeuser = find(analysis, "Häuser");
  assert.equal(haeuser.lemma, "Haus");
  assert.equal(haeuser.number, "plural");
  assert.ok(haeuser.glosses.en.some((g) => g.text === "house"));
});

test("clitics are expanded", { skip: !built }, async () => {
  const analysis = await glossSentence("Wie geht's dir?", store);
  const token = find(analysis, "geht's");
  assert.deepEqual(token.parts?.map((p) => p.text), ["geht", "es"]);
  assert.equal(token.lemma, "gehen");
});

test("an unknown word degrades to a noun rather than throwing", { skip: !built }, async () => {
  const analysis = await glossSentence("Der Xyzzyquux ist da.", store);
  const unknown = find(analysis, "Xyzzyquux");
  assert.equal(unknown.pos, "noun");
  assert.deepEqual(unknown.glosses.en, []);
});

test("an empty sentence yields no words", { skip: !built }, async () => {
  assert.deepEqual((await glossSentence("   ", store)).words, []);
});
