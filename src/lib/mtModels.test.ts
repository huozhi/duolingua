import assert from "node:assert/strict";
import { test } from "node:test";

import { LANGS, type Lang } from "./analysis.ts";
import { ALL_MODELS, chainFor, isPivoted, targetsFor } from "./mtModels.ts";

const PAIRS: [Lang, Lang][] = LANGS.flatMap((source) =>
  LANGS.filter((target) => target !== source).map((target) => [source, target] as [Lang, Lang]),
);

test("every ordered pair of languages has a route", () => {
  assert.equal(PAIRS.length, 12);
  for (const [source, target] of PAIRS) {
    const chain = chainFor(source, target);
    assert.ok(chain.length >= 1, `${source}→${target} has no route`);
    assert.ok(chain.length <= 2, `${source}→${target} needs ${chain.length} hops`);
  }
});

test("pairs we ship a model for are a single hop", () => {
  for (const [source, target] of [
    ["de", "en"],
    ["de", "es"],
    ["en", "de"],
    ["en", "es"],
    ["en", "zh"],
    ["es", "en"],
    ["zh", "en"],
  ] as [Lang, Lang][]) {
    assert.equal(chainFor(source, target).length, 1, `${source}→${target}`);
    assert.equal(isPivoted(source, target), false);
  }
});

test("routes between two non-English languages go through English", () => {
  for (const [source, target] of [
    ["de", "zh"],
    ["es", "zh"],
    ["zh", "es"],
    ["es", "de"],
    ["zh", "de"],
  ] as [Lang, Lang][]) {
    const chain = chainFor(source, target);
    assert.equal(chain.length, 2, `${source}→${target}`);
    assert.ok(chain[0].endsWith("-en"), `first hop of ${source}→${target} should reach English`);
    assert.ok(chain[1].includes("-en-"), `second hop of ${source}→${target} should leave English`);
    assert.equal(isPivoted(source, target), true);
  }
});

test("translating a language into itself needs no model", () => {
  for (const lang of LANGS) assert.deepEqual(chainFor(lang, lang), []);
});

test("targetsFor is the other three languages, never the source", () => {
  for (const source of LANGS) {
    const targets = targetsFor(source);
    assert.equal(targets.length, 3);
    assert.ok(!targets.includes(source));
  }
});

test("ALL_MODELS covers every model any route needs", () => {
  assert.equal(ALL_MODELS.length, 7);
  for (const [source, target] of PAIRS) {
    for (const model of chainFor(source, target)) {
      assert.ok(ALL_MODELS.includes(model), `${model} is missing from ALL_MODELS`);
    }
  }
  assert.equal(new Set(ALL_MODELS).size, ALL_MODELS.length, "ALL_MODELS should be deduplicated");
});
