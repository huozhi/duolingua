"use client";

import { useMemo, useState } from "react";
import {
  CASE_ABBREV,
  LANGS,
  LANG_META,
  POS_META,
  TARGETS,
  type Analysis,
  type Gloss,
  type Lang,
  type Word,
} from "@/lib/analysis";
import { detectLanguage } from "@/lib/detect";
import SentencePanel from "./SentencePanel";

/** One per language, so the source selector has something to demonstrate. */
const EXAMPLES: [Lang, string][] = [
  ["de", "Der schnelle Hund springt über den faulen Zaun."],
  ["de", "Ich stehe jeden Tag früh auf."],
  ["en", "I have no idea what you are talking about."],
  ["es", "A pesar del mal tiempo, los niños fueron a pasear."],
  ["zh", "我不知道你在说什么"],
];

const MAX_LENGTH = 600;

/** What the user asked for: a language, or let the app work it out. */
type SourceChoice = Lang | "auto";

/** A submitted sentence, pinned with the source it was translated as. */
type Submission = { sentence: string; source: Lang; run: number };

export default function Translator() {
  const [sentence, setSentence] = useState("");
  const [choice, setChoice] = useState<SourceChoice>("auto");
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  // Detection runs here, in the browser, as you type: it is a few set lookups, so
  // there is no reason to spend a round trip finding out what language this is.
  const detected = useMemo(() => detectLanguage(sentence), [sentence]);
  const source: Lang = choice === "auto" ? detected.lang : choice;

  async function submit(text: string, from: Lang) {
    const value = text.trim();
    if (!value || loading) return;

    setError(null);
    setSelected(null);
    setAnalysis(null);
    // The run counter makes an unchanged sentence re-translate: the panel is keyed
    // on it, and a new key is what makes it fetch again.
    setSubmission((previous) => ({ sentence: value, source: from, run: (previous?.run ?? 0) + 1 }));

    // The word-by-word layer is German-only, so there is nothing to fetch for the
    // other languages — the sentence panel does its own work.
    if (from !== "de") return;

    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(sentence, source);
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
              submit(sentence, source);
            }
          }}
          placeholder="Paste a sentence in German, English, Spanish or Chinese…"
          rows={3}
          maxLength={MAX_LENGTH}
          className="w-full resize-none rounded-xl border border-neutral-300 bg-white p-4 text-lg shadow-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
        />

        <SourcePicker choice={choice} detected={detected.lang} onChange={setChoice} />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={loading || !sentence.trim()}
            className="rounded-lg bg-neutral-900 px-5 py-2.5 font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {loading ? "Übersetze…" : "Translate"}
          </button>
          <span className="text-sm text-neutral-500">
            Press Enter to translate · Shift + Enter for a new line
          </span>
        </div>
      </form>

      {!submission && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-500">Try an example:</p>
          <div className="flex flex-col gap-2">
            {EXAMPLES.map(([lang, example]) => (
              <button
                key={example}
                onClick={() => {
                  setSentence(example);
                  setChoice("auto");
                  submit(example, lang);
                }}
                className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm text-neutral-700 transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
              >
                <span className="w-8 shrink-0 text-xs uppercase text-neutral-400">{lang}</span>
                <span>{example}</span>
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

      {submission && (
        <div className="flex flex-col gap-5">
          {/* Keyed by the run counter as well as the sentence, so re-submitting the
              same sentence translates it again instead of showing a stale answer. */}
          <SentencePanel
            key={`${submission.run}:${submission.source}:${submission.sentence}`}
            source={submission.source}
            sentence={submission.sentence}
          />

          {submission.source === "de" ? (
            analysis && (
              <>
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
              </>
            )
          ) : (
            <p className="text-sm text-neutral-500">
              The word-by-word breakdown — lemma, case, gender, tense, compound splitting — exists
              for German only. Those rules and the dictionary behind them are German-specific.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The word-by-word breakdown, analysed by the server against the dictionary. */
async function analyzeSentence(sentence: string): Promise<Analysis> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentence, source: "de" }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error ?? "Analysis failed.");
  return data as Analysis;
}

/**
 * The source language, detected but overridable.
 *
 * Detection is reliable on sentences and not on bare words — `no` is Spanish and
 * English both — so the guess is always visible and always correctable rather than
 * silently deciding which way to translate.
 */
function SourcePicker({
  choice,
  detected,
  onChange,
}: {
  choice: SourceChoice;
  detected: Lang;
  onChange: (choice: SourceChoice) => void;
}) {
  const options: SourceChoice[] = ["auto", ...LANGS];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-neutral-500">From</span>
      {options.map((option) => {
        const isActive = choice === option;
        const label = option === "auto" ? `Auto (${LANG_META[detected].native})` : LANG_META[option].native;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={isActive}
            className={`rounded-md border px-2 py-1 text-xs transition ${
              isActive
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                : "border-neutral-300 text-neutral-600 hover:border-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
            }`}
          >
            {label}
          </button>
        );
      })}
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
              <dt className="text-neutral-500">{LANG_META[target].label}</dt>
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
