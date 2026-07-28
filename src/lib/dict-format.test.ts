import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SHARD_COUNT,
  decodeFeatures,
  dictKey,
  encodeFeatures,
  encodeFormLine,
  encodeWordLine,
  parseFormLine,
  parseWordLine,
  sanitize,
  shardOf,
  type Features,
} from "./dict-format.ts";
import { emptyGlosses } from "./analysis.ts";

test("word lines survive a round trip", () => {
  const glosses = emptyGlosses();
  glosses.en = [{ text: "book" }, { text: "volume" }];
  glosses.es = [{ text: "libro" }];
  glosses.zh = [{ text: "书", pinyin: "shū" }, { text: "书本", pinyin: "shūběn" }];

  const entry = { lemma: "Buch", pos: "noun" as const, gender: "neuter" as const, glosses };
  const parsed = parseWordLine(encodeWordLine(entry));

  assert.deepEqual(parsed, entry);
});

test("word lines handle absent gender and empty targets", () => {
  const glosses = emptyGlosses();
  glosses.en = [{ text: "read" }];

  const entry = { lemma: "lesen", pos: "verb" as const, gender: null, glosses };
  const parsed = parseWordLine(encodeWordLine(entry));

  assert.deepEqual(parsed, entry);
  assert.deepEqual(parsed?.glosses.zh, []);
});

test("separator characters in source data cannot break a line", () => {
  const glosses = emptyGlosses();
  // A gloss containing our field, list and sub separators, plus a newline.
  glosses.en = [{ text: "a\tb;c|d\ne" }];

  const line = encodeWordLine({ lemma: "test", pos: "other", gender: null, glosses });
  assert.equal(line.split("\n").length, 1);

  const parsed = parseWordLine(line);
  assert.equal(parsed?.glosses.en[0].text, "a b c d e");
  assert.equal(parsed?.lemma, "test");
});

test("every feature field survives encoding", () => {
  const features: Features = {
    case: "dative",
    number: "plural",
    person: "3",
    tense: "Konjunktiv II",
    degree: "superlative",
    gender: "feminine",
  };
  assert.deepEqual(decodeFeatures(encodeFeatures(features)), features);
});

test("unknown feature codes are ignored rather than throwing", () => {
  assert.deepEqual(decodeFeatures("ZZCn"), { case: "nominative" });
  assert.deepEqual(decodeFeatures(""), {});
});

test("form lines carry several lemmas, each with several readings", () => {
  const analyses = [
    {
      lemma: "Haus",
      pos: "noun" as const,
      readings: [
        { case: "nominative" as const, number: "plural" as const },
        { case: "genitive" as const, number: "plural" as const },
      ],
    },
    { lemma: "hausen", pos: "verb" as const, readings: [{ person: "1" as const, tense: "present" }] },
  ];

  const parsed = parseFormLine(encodeFormLine("Häuser", analyses));
  assert.equal(parsed?.form, "Häuser");
  assert.deepEqual(parsed?.analyses, analyses);
});

test("form lines with no readings still resolve the lemma", () => {
  const parsed = parseFormLine(encodeFormLine("buch", [{ lemma: "buchen", pos: "verb", readings: [] }]));
  assert.deepEqual(parsed?.analyses, [{ lemma: "buchen", pos: "verb", readings: [] }]);
});

test("malformed lines parse to null instead of throwing", () => {
  assert.equal(parseWordLine(""), null);
  assert.equal(parseFormLine("noTabHere"), null);
  assert.equal(parseFormLine("\tstartsWithTab"), null);
});

test("lookup keys ignore case, because German capitalization is data", () => {
  assert.equal(dictKey("Buch"), dictKey("buch"));
  assert.equal(dictKey("STRASSE"), "strasse");
  assert.equal(shardOf(dictKey("Buch")), shardOf(dictKey("buch")));
});

test("sharding is stable and spreads across all buckets", () => {
  assert.equal(shardOf("Buch"), shardOf("Buch"));

  // A realistic alphabet of German-ish keys should touch most buckets; a hash
  // that collapsed onto a few would make lazy shard loading pointless.
  const used = new Set<number>();
  for (let i = 0; i < 20_000; i++) used.add(shardOf(`wort${i}`));
  assert.equal(used.size, SHARD_COUNT);
});

test("sanitize collapses whitespace and strips structure characters", () => {
  assert.equal(sanitize("  zwei   Wörter\t"), "zwei Wörter");
  assert.equal(sanitize("a|b;c"), "a b c");
});
