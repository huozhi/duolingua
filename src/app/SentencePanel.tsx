"use client";

import { useEffect, useState } from "react";
import { TARGETS, TARGET_META, type Target } from "@/lib/analysis";
import { isPivoted } from "@/lib/mtModels";

type Result = {
  translations: Partial<Record<Target, string>>;
  /** Targets answered from the dictionary rather than by a model. */
  fromDictionary: Target[];
};

type State =
  | { status: "translating" }
  | ({ status: "done" } & Result)
  | { status: "error"; message: string };

/**
 * Full-sentence translation, fetched from the server.
 *
 * The models run server-side, so there is nothing for the reader to download and
 * nothing to consent to — all three languages are requested as soon as a sentence
 * is analysed, in one request.
 *
 * This is the one part of the app that needs the network. The word layer below it
 * is served from a precached dictionary and keeps working without one, which is
 * why a failure here is reported as its own small message rather than as an error
 * for the whole page.
 */
export default function SentencePanel({ sentence }: { sentence: string }) {
  const [state, setState] = useState<State>({ status: "translating" });

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sentence }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? "Translation failed.");
        setState({
          status: "done",
          translations: data.translations ?? {},
          fromDictionary: data.fromDictionary ?? [],
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message:
            error instanceof TypeError
              ? "Could not reach the server."
              : error instanceof Error
                ? error.message
                : "Translation failed.",
        });
      }
    })();

    return () => controller.abort();
  }, [sentence]);

  if (state.status === "error") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {state.message}
      </div>
    );
  }

  const anyFromDictionary = state.status === "done" && state.fromDictionary.length > 0;

  return (
    <div className="flex flex-col divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      {TARGETS.map((target) => {
        const meta = TARGET_META[target];
        const text = state.status === "done" ? state.translations[target] : undefined;
        const fromDictionary = state.status === "done" && state.fromDictionary.includes(target);

        return (
          <div key={target} className="flex items-start gap-4 p-4">
            <div className="w-24 shrink-0">
              <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {meta.label}
              </div>
              <div className="text-xs text-neutral-500">{meta.native}</div>
            </div>

            <div className="min-w-0 flex-1">
              {text ? (
                <div className="flex flex-col gap-1">
                  <p lang={meta.bcp47} className="text-lg text-neutral-900 dark:text-neutral-100">
                    {text}
                  </p>
                  {fromDictionary
                    ? null
                    : isPivoted(target) && (
                        <p className="text-xs text-neutral-400">
                          via English — no direct German → {meta.label} model exists
                        </p>
                      )}
                </div>
              ) : (
                <div className="text-sm text-neutral-500">Translating…</div>
              )}
            </div>
          </div>
        );
      })}

      {anyFromDictionary && (
        <p className="px-4 py-2.5 text-xs text-neutral-400">
          From the dictionary: a single word is not a sentence, and the translation models are
          unreliable on bare words.
        </p>
      )}
    </div>
  );
}
