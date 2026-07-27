/**
 * Integration test against the real artifacts in `data/dict/`, so that a
 * change to the build script which breaks the read path fails here rather than
 * silently in the browser.
 *
 * Skipped when the dictionary has not been built yet.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { createDictStore } from "./dictStore.ts";

const DICT_DIR = join(import.meta.dirname, "..", "..", "data", "dict");
const built = existsSync(join(DICT_DIR, "manifest.json"));

const store = createDictStore(async (name) => {
  try {
    return await readFile(join(DICT_DIR, name));
  } catch {
    return null;
  }
});

test("a missing shard yields no results rather than an error", async () => {
  const empty = createDictStore(async () => null);
  assert.deepEqual(await empty.lookupWord("Buch"), []);
  assert.deepEqual(await empty.lookupForm("Häuser"), []);
});

test("nouns carry gender and glosses in all three targets", { skip: !built }, async () => {
  const [entry] = await store.lookupWord("Buch");
  assert.equal(entry.lemma, "Buch");
  assert.equal(entry.pos, "noun");
  assert.equal(entry.gender, "neuter");
  assert.ok(entry.glosses.en.some((g) => g.text === "book"));
  assert.ok(entry.glosses.es.some((g) => g.text === "libro"));
  assert.ok(entry.glosses.zh.length > 0, "expected a Chinese gloss");
  assert.ok(entry.glosses.zh[0].pinyin, "expected pinyin alongside the Chinese gloss");
});

test("lookup is case-insensitive", { skip: !built }, async () => {
  assert.deepEqual(await store.lookupWord("buch"), await store.lookupWord("Buch"));
});

test("a lowercase word does not match an all-caps abbreviation", { skip: !built }, async () => {
  // `ZUM` is an abbreviation of `Busbahnhof`; case-folded keys made `zum` — one of
  // the most frequent words in German — offer "bus terminal" as a reading.
  const forms = await store.lookupForm("zum");
  assert.ok(!forms.some((analysis) => analysis.lemma === "Busbahnhof"));

  // Asking in capitals still finds it.
  assert.ok((await store.lookupWord("DAS")).some((entry) => entry.lemma === "DAS"));
  assert.ok(!(await store.lookupWord("das")).some((entry) => entry.lemma === "DAS"));
});

test("irregular plurals resolve to their lemma with case readings", { skip: !built }, async () => {
  const analyses = await store.lookupForm("Häuser");
  const haus = analyses.find((a) => a.lemma === "Haus");
  assert.ok(haus, "Häuser should be a form of Haus");
  assert.equal(haus.pos, "noun");
  assert.ok(
    haus.readings.some((r) => r.case === "nominative" && r.number === "plural"),
    "expected a nominative plural reading",
  );
});

test("strong verb participles resolve to the infinitive", { skip: !built }, async () => {
  const analyses = await store.lookupForm("gelesen");
  assert.ok(analyses.some((a) => a.lemma === "lesen" && a.pos === "verb"));
});

test("separable verb forms are indexed as the merged lemma", { skip: !built }, async () => {
  const analyses = await store.lookupForm("stehe auf");
  assert.ok(
    analyses.some((a) => a.lemma === "aufstehen"),
    "'stehe auf' should resolve to aufstehen",
  );
});

test("a part of speech never claims features it cannot bear", { skip: !built }, async () => {
  // Regression: German Wiktionary shares one Flexion page per spelling, which
  // handed the adjective `buchen` the verb's conjugation table.
  const analyses = await store.lookupForm("buch");
  const adjective = analyses.find((a) => a.lemma === "buchen" && a.pos === "adjective");
  assert.ok(
    !adjective?.readings.some((r) => r.person || r.tense),
    "an adjective must not have person or tense readings",
  );
});
