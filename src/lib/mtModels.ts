/**
 * Which model translates into which language.
 *
 * There is no ONNX build of a German → Chinese model, and the Helsinki
 * `opus-mt-de-ZH` pair it would come from is low-resource anyway. Chinese
 * therefore pivots through English, using two well-trained models instead of one
 * weak one. The pivot is surfaced in the UI rather than hidden — a translation
 * that went through English can drift, and the reader should know which row is
 * second-hand.
 *
 * Shared between the server, which loads these models, and the client, which only
 * needs to know which rows to label.
 */

import type { Target } from "./analysis.ts";

/** The chain of models a target language needs, in order. */
export const CHAINS: Record<Target, string[]> = {
  en: ["Xenova/opus-mt-de-en"],
  es: ["Xenova/opus-mt-de-es"],
  zh: ["Xenova/opus-mt-de-en", "Xenova/opus-mt-en-zh"],
};

/** Every model the server may need to load, deduplicated. */
export const ALL_MODELS = [...new Set(Object.values(CHAINS).flat())];

/** True when this target's output passed through another language. */
export function isPivoted(target: Target): boolean {
  return CHAINS[target].length > 1;
}
