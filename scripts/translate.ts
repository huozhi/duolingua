/**
 * Translate a German sentence from the terminal.
 *
 *   pnpm translate "Wir müssen morgen früh zum Bahnhof fahren."
 *   pnpm translate --targets en,zh "Mir ist kalt."
 *   pnpm translate --words "Das Buch, das ich gelesen habe, war gut."
 *
 * Runs the models in this process — no server needed. The first run downloads
 * them (~330MB for all three); `pnpm models:fetch` does that ahead of time.
 * For single words, `pnpm dict:lookup` is instant and loads nothing.
 */

import { CASE_ABBREV, TARGETS, TARGET_META, type Target, type Word } from "../src/lib/analysis.ts";
import { glossSentence } from "../src/lib/gloss.ts";
import { isPivoted } from "../src/lib/mtModels.ts";
import { dictStore } from "../src/server/dict.ts";
import { translate } from "../src/server/mt.ts";

const argv = process.argv.slice(2);
const showWords = argv.includes("--words");

const targetsFlag = argv.findIndex((argument) => argument === "--targets");
let targets: Target[] = [...TARGETS];
if (targetsFlag !== -1) {
  const requested = (argv[targetsFlag + 1] ?? "").split(",").map((value) => value.trim());
  const unknown = requested.filter((value) => !TARGETS.includes(value as Target));
  if (!requested.length || unknown.length) {
    console.error(`--targets must be a comma-separated subset of ${TARGETS.join(",")}`);
    process.exit(1);
  }
  targets = requested as Target[];
}

// Everything that is not a flag or a flag's value is the sentence.
const consumed = new Set<number>();
argv.forEach((argument, index) => {
  if (argument === "--words") consumed.add(index);
  if (argument === "--targets") {
    consumed.add(index);
    consumed.add(index + 1);
  }
});
const sentence = argv.filter((_, index) => !consumed.has(index)).join(" ").trim();

if (!sentence) {
  console.error('usage: pnpm translate [--targets en,es,zh] [--words] "<German sentence>"');
  process.exit(1);
}

console.log(`\n▌ ${sentence}\n`);

for (const target of targets) {
  const meta = TARGET_META[target];
  // Printed as one line after the await: a model load can log, and a half-written
  // line would be split by it.
  try {
    const { text, fromDictionary } = await translate(target, sentence);
    const note = fromDictionary ? "   (dictionary)" : isPivoted(target) ? "   (via English)" : "";
    console.log(`  ${meta.label.padEnd(8)} ${text}${note}`);
  } catch (error) {
    console.log(`  ${meta.label.padEnd(8)} — ${error instanceof Error ? error.message : "failed"}`);
  }
}

if (showWords) {
  console.log();
  const { words } = await glossSentence(sentence, dictStore());
  for (const word of words) {
    if (word.pos === "punctuation") continue;
    console.log(`  ${word.text.padEnd(16)} ${describe(word)}`);
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
