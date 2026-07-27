/**
 * Which model translates from which language into which, with English as the hub.
 *
 * OPUS-MT ships one model per ordered pair, and not every pair exists as an ONNX
 * build — there is no German → Chinese model at all, and the Helsinki `de-ZH` pair
 * it would come from is low-resource anyway. So directions we have are used
 * directly and the rest go through English, which costs a second hop but uses two
 * well-trained models instead of one weak one.
 *
 * The pivot is surfaced in the UI rather than hidden: a translation that passed
 * through English can drift, and the reader should know which row is second-hand.
 *
 * Shared between the server, which loads these models, and the client, which only
 * needs to know which rows to label.
 */

import { LANGS, type Lang } from "./analysis.ts";

/**
 * The pairs that exist as a single model. German → Spanish is kept even though
 * English could relay it: it is the app's most-used pair, and one hop beats two.
 */
const DIRECT: Partial<Record<string, string>> = {
  "de-en": "Xenova/opus-mt-de-en",
  "de-es": "Xenova/opus-mt-de-es",
  "en-de": "Xenova/opus-mt-en-de",
  "en-es": "Xenova/opus-mt-en-es",
  "en-zh": "Xenova/opus-mt-en-zh",
  "es-en": "Xenova/opus-mt-es-en",
  "zh-en": "Xenova/opus-mt-zh-en",
};

/** The hub every indirect route passes through. */
const HUB: Lang = "en";

/**
 * The models needed to get from `source` to `target`, in order. One entry for a
 * direct pair, two when the route goes through English.
 */
export function chainFor(source: Lang, target: Lang): string[] {
  if (source === target) return [];

  const direct = DIRECT[`${source}-${target}`];
  if (direct) return [direct];

  const toHub = DIRECT[`${source}-${HUB}`];
  const fromHub = DIRECT[`${HUB}-${target}`];
  if (!toHub || !fromHub) {
    throw new Error(`No route from ${source} to ${target}: every language needs a pair with English.`);
  }
  return [toHub, fromHub];
}

/** The three languages to translate into, given the one that was written. */
export function targetsFor(source: Lang): Lang[] {
  return LANGS.filter((lang) => lang !== source);
}

/** True when this route passes through English rather than translating directly. */
export function isPivoted(source: Lang, target: Lang): boolean {
  return chainFor(source, target).length > 1;
}

/** Every model the server may need to load, deduplicated. */
export const ALL_MODELS = [...new Set(Object.values(DIRECT))].filter(
  (model): model is string => Boolean(model),
);
