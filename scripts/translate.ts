/**
 * Translate a sentence between German, English, Spanish and Chinese, from the
 * terminal.
 *
 *   pnpm translate "Wir müssen morgen früh zum Bahnhof fahren."
 *   pnpm translate "The dog jumps over the fence."
 *   pnpm translate --from es "No tengo ni idea."
 *   pnpm translate --targets de,zh --words "Mir ist kalt."
 *
 * The source language is detected unless `--from` says otherwise; detection is
 * reliable on sentences and a guess on bare words, so it is always printed.
 *
 * Runs the models in this process — no server needed. The first run downloads them
 * (~773MB for all seven); `pnpm models:fetch` does that ahead of time. For single
 * words, `pnpm dict:lookup` is instant and loads nothing.
 */

import { CASE_ABBREV, LANGS, LANG_META, TARGETS, type Lang, type Word } from "../src/lib/analysis.ts";
import { asLang, detectLanguage } from "../src/lib/detect.ts";
import { glossSentence } from "../src/lib/gloss.ts";
import { isPivoted, targetsFor } from "../src/lib/mtModels.ts";
import { dictStore } from "../src/server/dict.ts";
import { translate } from "../src/server/mt.ts";

const argv = process.argv.slice(2);

/** Read a `--flag value` pair, or null when the flag is absent. */
function flagValue(name: string): string | null {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : (argv[at + 1] ?? "");
}

const showWords = argv.includes("--words");

const fromFlag = flagValue("from");
const explicitSource = fromFlag === null ? null : asLang(fromFlag);
if (fromFlag !== null && !explicitSource) {
  console.error(`--from must be one of ${LANGS.join(",")}`);
  process.exit(1);
}

// Everything that is not a flag or a flag's value is the sentence.
const consumed = new Set<number>();
argv.forEach((argument, index) => {
  if (argument === "--words") consumed.add(index);
  if (argument === "--from" || argument === "--targets") {
    consumed.add(index);
    consumed.add(index + 1);
  }
});
const sentence = argv.filter((_, index) => !consumed.has(index)).join(" ").trim();

if (!sentence) {
  console.error('usage: pnpm translate [--from de|en|es|zh] [--targets …] [--words] "<sentence>"');
  process.exit(1);
}

const detected = detectLanguage(sentence);
const source = explicitSource ?? detected.lang;

const targetsFlag = flagValue("targets");
let targets: Lang[] = targetsFor(source);
if (targetsFlag !== null) {
  const requested = targetsFlag.split(",").map((value) => asLang(value.trim()));
  if (!requested.length || requested.some((target) => target === null)) {
    console.error(`--targets must be a comma-separated subset of ${LANGS.join(",")}`);
    process.exit(1);
  }
  targets = (requested as Lang[]).filter((target) => target !== source);
}

const how = explicitSource
  ? "given"
  : detected.confidence > 0
    ? `detected, confidence ${detected.confidence.toFixed(2)}`
    : "detected: no strong signal, using the default — pass --from to override";

console.log(`\n▌ ${sentence}`);
console.log(`  from ${LANG_META[source].label} (${how})\n`);

for (const target of targets) {
  const meta = LANG_META[target];
  // Printed as one line after the await: a model load can log, and a half-written
  // line would be split by it.
  try {
    const { text, fromDictionary } = await translate(source, target, sentence);
    const note = fromDictionary
      ? "   (dictionary)"
      : isPivoted(source, target)
        ? "   (via English)"
        : "";
    console.log(`  ${meta.label.padEnd(8)} ${text}${note}`);
  } catch (error) {
    console.log(`  ${meta.label.padEnd(8)} — ${error instanceof Error ? error.message : "failed"}`);
  }
}

if (showWords) {
  if (source !== "de") {
    console.log("\n  (--words is German-only: the grammar rules and dictionary are German)");
  } else {
    console.log();
    const { words } = await glossSentence(sentence, dictStore());
    for (const word of words) {
      if (word.pos === "punctuation") continue;
      console.log(`  ${word.text.padEnd(16)} ${describe(word)}`);
    }
  }
}

console.log();

function describe(word: Word): string {
  const grammar = [
    word.pos,
    word.lemma === word.text ? null : `→ ${word.lemma}`,
    word.gender,
    word.cases.length ? word.cases.map((c) => CASE_ABBREV[c]).join("/") : null,
    word.number,
    word.person && `${word.person}.person`,
    word.tense,
  ]
    .filter(Boolean)
    .join(" ");

  const glosses = TARGETS.map((target) => {
    const first = word.glosses[target][0];
    return first ? (first.pinyin ? `${first.text} [${first.pinyin}]` : first.text) : null;
  })
    .filter(Boolean)
    .join(" · ");

  return `${grammar.padEnd(46)} ${glosses}`;
}
