"use client";

import { useMemo, useState } from "react";
import { LANGS, LANG_META, type Lang } from "@/lib/analysis";
import { detectLanguage } from "@/lib/detect";
import SentencePanel from "./sentence-panel";

const MAX_LENGTH = 600;

type SourceChoice = Lang | "auto";
type Submission = { sentence: string; source: Lang; run: number };

export default function Translator() {
  const [sentence, setSentence] = useState("");
  const [choice, setChoice] = useState<SourceChoice>("auto");
  const [submission, setSubmission] = useState<Submission | null>(null);

  const detected = useMemo(() => detectLanguage(sentence), [sentence]);
  const source: Lang = choice === "auto" ? detected.lang : choice;

  function submit(text: string, from: Lang) {
    const value = text.trim();
    if (!value) return;

    setSubmission((previous) => ({
      sentence: value,
      source: from,
      run: (previous?.run ?? 0) + 1,
    }));
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
        <div className="flex items-stretch gap-2">
          <textarea
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(sentence, source);
              }
            }}
            placeholder="Deutsch · English · Español · 中文"
            maxLength={MAX_LENGTH}
            className="h-24 min-w-0 flex-1 resize-none select-text rounded-xl border border-neutral-300 bg-white p-4 text-lg shadow-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="submit"
            disabled={!sentence.trim()}
            className="h-24 w-28 shrink-0 rounded-xl bg-neutral-900 px-4 font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Translate
          </button>
        </div>

        <SourcePicker choice={choice} detected={detected.lang} onChange={setChoice} />

        <span className="text-sm text-neutral-500">
          Press Enter to translate · Shift + Enter for a new line
        </span>
      </form>

      {submission && (
        <SentencePanel
          key={`${submission.run}:${submission.source}:${submission.sentence}`}
          source={submission.source}
          sentence={submission.sentence}
        />
      )}
    </div>
  );
}

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
        const label = option === "auto" ? "Auto" : LANG_META[option].native;
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
      {choice === "auto" && (
        <span className="ml-1 text-xs text-neutral-500">
          Detected: {LANG_META[detected].native}
        </span>
      )}
    </div>
  );
}
