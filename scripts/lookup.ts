/**
 * Look up German words from the terminal, using the same resolution the app does.
 *
 *   pnpm dict:lookup gelesen Häuser zum Bahnhofskatze
 *
 * No models are loaded, so this stays instant. For whole sentences, use
 * `pnpm translate`.
 */

import { CASE_ABBREV, LANG_META, TARGETS, type Target } from "../src/lib/analysis.ts";
import type { Features } from "../src/lib/dictFormat.ts";
import { resolve, type Candidate } from "../src/lib/morphology.ts";
import { dictManifest, dictStore } from "../src/server/dict.ts";

const words = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));

if (!words.length) {
  console.error("usage: pnpm dict:lookup <word> [word…]");
  process.exit(1);
}

/** How the entry was reached, which is worth showing when it was not exact. */
const HOW: Record<Candidate["confidence"], string> = {
  1: "",
  2: "inflected form",
  3: "ending stripped",
  4: "compound",
};

function describeReadings(readings: Features[]): string {
  const described = readings
    .map((reading) =>
      [
        reading.person && `${reading.person}.`,
        reading.tense,
        reading.case && CASE_ABBREV[reading.case],
        reading.number,
        reading.gender,
        reading.degree,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean);

  return [...new Set(described)].join(" | ");
}

const store = dictStore();

try {
  const manifest = await dictManifest();
  console.log(
    `dictionary ${manifest.version} — ${manifest.coverage.lemmas.toLocaleString()} lemmas ` +
      `(en ${manifest.coverage.en.toLocaleString()}, es ${manifest.coverage.es.toLocaleString()}, ` +
      `zh ${manifest.coverage.zh.toLocaleString()})\n`,
  );
} catch {
  console.error("No dictionary found. Run `pnpm dict:build` first.\n");
  process.exit(1);
}

for (const word of words) {
  console.log(`══ ${word}`);

  const candidates = await resolve(store, word);
  if (!candidates.length) {
    console.log("   (not found)\n");
    continue;
  }

  for (const candidate of candidates) {
    const how = HOW[candidate.confidence];
    const head = [candidate.lemma, candidate.pos, candidate.gender].filter(Boolean).join(" · ");
    console.log(`   ${head}${how ? `   « ${how}` : ""}`);

    const readings = describeReadings(candidate.readings);
    if (readings) console.log(`     ${"form".padEnd(8)} ${readings}`);

    for (const target of TARGETS as readonly Target[]) {
      const glosses = candidate.glosses[target];
      if (!glosses.length) continue;
      const text = glosses.map((g) => (g.pinyin ? `${g.text} [${g.pinyin}]` : g.text)).join(", ");
      console.log(`     ${LANG_META[target].label.padEnd(8)} ${text}`);
    }

    // A compound is not in the dictionary at all; its parts are what carry meaning.
    if (candidate.parts) {
      console.log(`     ${"parts".padEnd(8)} ${candidate.parts.map((p) => p.lemma).join(" + ")}`);
      for (const part of candidate.parts) {
        const gloss = part.glosses.en.map((g) => g.text).slice(0, 3).join(", ") || "—";
        console.log(`       ${part.lemma.padEnd(20)} ${gloss}`);
      }
    }
  }

  console.log();
}
