import assert from "node:assert/strict";
import { test } from "node:test";

import { asLang, detectLanguage } from "./detect.ts";

/** Real sentences — the case the app is actually for. All of these must be right. */
const SENTENCES: [string, string][] = [
  ["de", "Der schnelle Hund springt über den faulen Zaun."],
  ["de", "Wir müssen morgen früh zum Bahnhof fahren."],
  ["de", "Ich weiß nicht, wovon du sprichst."],
  ["de", "Trotz des schlechten Wetters gingen die Kinder spazieren."],
  ["en", "The dog jumps over the lazy fence."],
  ["en", "I have no idea what you are talking about."],
  ["en", "It is raining, so I will stay at home."],
  ["es", "El perro salta sobre la cerca perezosa."],
  ["es", "No tengo ni idea de lo que estás hablando."],
  ["es", "A pesar del mal tiempo, los niños fueron a pasear."],
  ["zh", "狗跳过懒惰的栅栏"],
  ["zh", "我不知道你在说什么"],
  ["zh", "尽管天气恶劣,孩子们还是去散步。"],
];

for (const [expected, sentence] of SENTENCES) {
  test(`detects ${expected}: ${sentence.slice(0, 32)}…`, () => {
    const { lang, confidence } = detectLanguage(sentence);
    assert.equal(lang, expected);
    assert.ok(confidence > 0, "a real sentence should carry some confidence");
  });
}

test("Chinese is decided by script, not by word lists", () => {
  assert.deepEqual(detectLanguage("狗跳过围栏"), { lang: "zh", confidence: 1 });
  // Latin punctuation and digits mixed in do not change that.
  assert.equal(detectLanguage("他在 2024 年去了北京。").lang, "zh");
});

/**
 * Bare words are where this cannot work, and the tests say so rather than
 * pretending otherwise: the answer is German because that is the documented
 * fallback, and the confidence is 0 so the UI can offer the override.
 */
test("an unrecognised bare word falls back to German at zero confidence", () => {
  for (const word of ["Xyzzyquux", "Kaffee", "Fahrrad"]) {
    assert.deepEqual(detectLanguage(word), { lang: "de", confidence: 0 }, word);
  }
});

test("the words people type on their own are recognised", () => {
  // The blind spot the prototype exposed: greetings and one-word replies.
  const cases: [string, string][] = [
    ["de", "Hallo"], ["en", "Hello"], ["es", "Hola"],
    ["de", "Danke"], ["en", "Thanks"], ["es", "Gracias"],
    ["de", "Ja"], ["en", "Yes"], ["es", "Sí"],
    ["de", "Guten Tag"], ["en", "Good afternoon"], ["es", "Buenos días"],
    ["de", "Nein"],
  ];
  for (const [expected, word] of cases) {
    assert.equal(detectLanguage(word).lang, expected, word);
  }
});

test("detects a short English phrase without relying on the German fallback", () => {
  const detection = detectLanguage("any language");
  assert.equal(detection.lang, "en");
  assert.ok(detection.confidence > 0);
});

test("a word belonging to two languages keeps its guess but claims no confidence", () => {
  // `no` is Spanish and English both, and nothing can resolve that. What matters
  // is that it does not claim certainty a user would have to fight.
  const detection = detectLanguage("no");
  assert.ok(["es", "en"].includes(detection.lang));
  assert.equal(detection.confidence, 0);
});

test("orthography alone is enough", () => {
  assert.equal(detectLanguage("Straßenbahn").lang, "de");
  assert.equal(detectLanguage("mañana").lang, "es");
});

test("empty input is the default language, not a crash", () => {
  assert.deepEqual(detectLanguage(""), { lang: "de", confidence: 0 });
  assert.deepEqual(detectLanguage("   \n "), { lang: "de", confidence: 0 });
  assert.deepEqual(detectLanguage("!?..."), { lang: "de", confidence: 0 });
});

test("asLang accepts only the four languages", () => {
  assert.equal(asLang("de"), "de");
  assert.equal(asLang("zh"), "zh");
  assert.equal(asLang("fr"), null);
  assert.equal(asLang(""), null);
  assert.equal(asLang(undefined), null);
  assert.equal(asLang(7), null);
});
