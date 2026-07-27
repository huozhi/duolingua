"use client";

import { useState } from "react";
import {
  CASE_ABBREV,
  POS_META,
  TARGETS,
  TARGET_META,
  type Analysis,
  type Gloss,
  type Word,
} from "@/lib/analysis";
import SentencePanel from "./SentencePanel";

const EXAMPLES = [
  "Der schnelle Hund springt über den faulen Zaun.",
  "Ich stehe jeden Tag früh auf.",
  "Wir müssen morgen früh zum Bahnhof fahren.",
  "Das Buch, das ich gelesen habe, war gut.",
];

const MAX_LENGTH = 600;

export default function Translator() {
  const [sentence, setSentence] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  /**
   * Counts submissions rather than tracking the text, so pressing Enter on an
   * unchanged sentence still re-runs it. The sentence panel is keyed on this, and
   * a new key is what makes it fetch again.
   */
  const [run, setRun] = useState(0);

  async function analyze(text: string) {
    const value = text.trim();
    if (!value || loading) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    setRun((previous) => previous + 1);
    try {
      setAnalysis(await analyzeSentence(value));
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Could not reach the server."
          : e instanceof Error
            ? e.message
            : "Something went wrong.",
      );
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }

  /** The word-by-word breakdown, analysed by the server against the dictionary. */
  async function analyzeSentence(sentence: string): Promise<Analysis> {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error ?? "Analysis failed.");
    return data as Analysis;
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          analyze(sentence);
        }}
        className="flex flex-col gap-3"
      >
        <textarea
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          onKeyDown={(e) => {
            // Enter translates — again, even if nothing changed. Shift+Enter is
            // still how you get a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              analyze(sentence);
            }
          }}
          placeholder="Gib einen deutschen Satz ein… (Enter a German sentence)"
          rows={3}
          maxLength={MAX_LENGTH}
          className="w-full resize-none rounded-xl border border-neutral-300 bg-white p-4 text-lg shadow-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={loading || !sentence.trim()}
            className="rounded-lg bg-neutral-900 px-5 py-2.5 font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {loading ? "Übersetze…" : "Translate"}
          </button>
          <span className="text-sm text-neutral-500">Press Enter to translate · Shift + Enter for a new line</span>
        </div>
      </form>

      {!analysis && !loading && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-500">Try an example:</p>
          <div className="flex flex-col gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setSentence(ex);
                  analyze(ex);
                }}
                className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm text-neutral-700 transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {analysis && (
        <div className="flex flex-col gap-5">
          {/* Keyed by the run counter as well as the sentence: a new sentence gets
              fresh rows rather than briefly showing the previous translation, and
              re-submitting the same sentence translates it again. */}
          <SentencePanel key={`${run}:${analysis.sentence}`} sentence={analysis.sentence} />

          <div className="flex flex-wrap gap-2 leading-loose">
            {analysis.words.map((word, i) => {
              const meta = POS_META[word.pos] ?? POS_META.other;
              const isActive = selected === i;
              return (
                <button
                  key={i}
                  onClick={() => setSelected(isActive ? null : i)}
                  className={`group relative rounded-md border px-2 py-1 text-lg transition ${meta.className} ${
                    isActive ? "ring-2 ring-neutral-900 dark:ring-white" : ""
                  }`}
                  title={meta.label}
                >
                  <span className="font-medium">{word.text}</span>
                  <span className="ml-1 align-top text-[10px] uppercase tracking-wide opacity-70">
                    {abbrev(word.pos)}
                  </span>
                </button>
              );
            })}
          </div>

          {selected !== null && analysis.words[selected] && (
            <WordCard word={analysis.words[selected]} />
          )}

          <Legend words={analysis.words} />
        </div>
      )}
    </div>
  );
}

function WordCard({ word }: { word: Word }) {
  const meta = POS_META[word.pos] ?? POS_META.other;
  const grammar: [string, string | null][] = [
    ["Part of speech", meta.label],
    ["Lemma", word.lemma === word.text ? null : word.lemma],
    ["Gender", word.gender],
    // Syncretic case is shown as such — "acc/dat" rather than a coin flip.
    ["Case", word.cases.length ? word.cases.map((c) => CASE_ABBREV[c]).join("/") : null],
    ["Number", word.number],
    ["Person", word.person],
    ["Tense", word.tense],
    ["Parts", word.parts?.map((part) => part.text).join(" + ") ?? null],
    ["Note", word.note],
  ];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-2xl font-semibold">{word.text}</span>
        <span className={`rounded-md border px-2 py-0.5 text-xs ${meta.className}`}>{meta.label}</span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        {TARGETS.map((target) => {
          const glosses = word.glosses[target];
          if (!glosses.length) return null;
          return (
            <div key={target} className="contents">
              <dt className="text-neutral-500">{TARGET_META[target].label}</dt>
              <dd className="text-neutral-900 dark:text-neutral-100">{formatGlosses(glosses)}</dd>
            </div>
          );
        })}
        {grammar
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-neutral-500">{label}</dt>
              <dd className="text-neutral-900 dark:text-neutral-100">{value}</dd>
            </div>
          ))}
      </dl>

      {word.compound && (
        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <p className="mb-1.5 text-xs text-neutral-500">
            Compound — not in the dictionary, split into parts
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {word.compound.map((part, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-medium">{part.lemma}</span>
                <span className="text-neutral-500">
                  {part.glosses.en.map((g) => g.text).slice(0, 2).join(", ") || "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Legend({ words }: { words: Word[] }) {
  const used = Array.from(new Set(words.map((w) => w.pos)));
  return (
    <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      {used.map((pos) => {
        const meta = POS_META[pos] ?? POS_META.other;
        return (
          <span key={pos} className={`rounded-md border px-2 py-0.5 text-xs ${meta.className}`}>
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

function formatGlosses(glosses: Gloss[]) {
  return glosses
    .map((gloss) => (gloss.pinyin ? `${gloss.text} (${gloss.pinyin})` : gloss.text))
    .join("; ");
}

function abbrev(pos: string) {
  return pos
    .split("-")
    .map((p) => p.slice(0, 3))
    .join(".");
}
