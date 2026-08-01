/**
 * Sentence translation, on the server.
 *
 * The models are the same OPUS-MT exports the browser used to download, but Node
 * runs them through native ONNX Runtime rather than WebAssembly, which is roughly
 * an order of magnitude faster: a few seconds to load a model, then ~100ms per
 * sentence. That difference is the whole reason translation moved here — nobody
 * has to fetch 110MB to see a sentence.
 *
 * Node-only. Imported by the API routes and by `scripts/translate.ts`.
 */

import { env, pipeline, type TranslationPipeline } from "@huggingface/transformers";
import type { Lang, Target } from "../lib/analysis.ts";
import { ALL_MODELS, chainFor } from "../lib/mt-models.ts";
import { collapseRepetition, joinSentences, splitSentences } from "./degeneration.ts";
import { resolve } from "../lib/morphology.ts";
import { dictStore } from "./dict.ts";

/**
 * Where model weights live. The Docker image bakes them in and points this at
 * that directory, so a container can translate with no network at all.
 */
env.cacheDir = process.env.MODEL_CACHE_DIR ?? ".cache";

/**
 * transformers.js warns once per model that Marian tokenizers are not backed by
 * the "fast" Rust tokenizer. There is no alternative for these models and nothing
 * to act on, so the warning is dropped — it otherwise prints on every cold start
 * and interleaves with the CLI's output. Narrowly matched, so any other warning
 * still gets through.
 */
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("MarianTokenizer")) return;
  warn(...args);
};

/**
 * One pipeline per model, built at most once.
 *
 * Keyed by promise rather than by resolved value so that concurrent requests for
 * a cold model wait on the same load instead of each starting their own — two
 * sessions for one model is a fast route to an out-of-memory kill.
 */
const pipelines = new Map<string, Promise<TranslationPipeline>>();

function load(model: string): Promise<TranslationPipeline> {
  const existing = pipelines.get(model);
  if (existing) return existing;

  const pending = pipeline("translation", model, {
    // q8 is the smallest published variant — counter-intuitively smaller than q4,
    // which stores its scales uncompressed.
    dtype: "q8",
    // Without this, session creation aborts with "TransposeDQWeightsForMatMulNBits
    // Missing required scale": ONNX Runtime's extended optimizations try to
    // rewrite these models' quantized weights and fail. Basic optimizations load
    // fine and translate correctly.
    session_options: { graphOptimizationLevel: "basic" },
  }) as Promise<TranslationPipeline>;

  // A failed load must not be cached, or the process can never retry it.
  pending.catch(() => pipelines.delete(model));

  pipelines.set(model, pending);
  return pending;
}

/**
 * Generation limits — a length cap and nothing else.
 *
 * `opus-mt-en-zh` will not emit an end-of-sequence token for very short inputs and
 * pads out with repetitions: "I'm cold." becomes 我好冷,我冷,我冷,我冷… and
 * "Where is it?" becomes 在哪里? 在哪里? 在哪里?. No decoding parameter fixes it —
 * the model already uses four beams, and `repetition_penalty` or
 * `no_repeat_ngram_size` only force the repeats to be *paraphrased* instead,
 * which is worse: they turn "I'm cold" into 你觉得冷吗? ("are you cold?"), a
 * different sentence. So generation is left alone and the repetition is removed
 * afterwards, by `collapseRepetition`.
 */
const GENERATION = { max_new_tokens: 256 } as const;

export type Translation = {
  text: string;
  /** True when the answer came from the dictionary rather than a model. */
  fromDictionary: boolean;
};

/**
 * Translate text from one language into another.
 *
 * A single German word is answered from the dictionary, not the model. These are
 * *sentence* models, and on an isolated word they are unreliable in a way that is
 * hard to defend: `Nein` came back as "Yes". Every longer negation is fine —
 * "Nicht heute", "Kein Problem", "Nein danke" all translate correctly — so the
 * failure is specific to bare words, which is exactly the shape a dictionary
 * handles better. We happen to ship a good one, for German.
 *
 * That safety net therefore only covers German sources; a bare word in English,
 * Spanish or Chinese goes to the model and keeps the model's weakness.
 *
 * Anything longer is split into sentences and translated one at a time, because
 * these models handle exactly one sentence per call and quietly drop the rest.
 */
export async function translate(source: Lang, target: Lang, text: string): Promise<Translation> {
  const trimmed = text.trim();
  if (source === target || !/[\p{L}\p{N}]/u.test(trimmed)) {
    return { text: trimmed, fromDictionary: false };
  }

  const fromDictionary = await dictionaryGloss(source, target, trimmed);
  if (fromDictionary) return { text: fromDictionary, fromDictionary: true };

  const translated: string[] = [];
  for (const sentence of splitSentences(trimmed)) {
    translated.push(await translateSentence(source, target, sentence));
  }
  return { text: joinSentences(translated), fromDictionary: false };
}

/**
 * The dictionary's best gloss for a single word, or null.
 *
 * Only for German sources, and never into German: the dictionary maps German
 * headwords to English, Spanish and Chinese glosses, so it has nothing to say
 * about the other directions.
 */
async function dictionaryGloss(source: Lang, target: Lang, text: string): Promise<string | null> {
  if (source !== "de" || target === "de") return null;

  const word = text.trim().replace(/[.!?,;:¿¡]+$/u, "");
  // One word only; anything with a space is a phrase and belongs to the model.
  if (!word || /\s/.test(word)) return null;

  // Take the first reading that has something to say in *this* language, rather
  // than the single best reading overall. `Nein` is a capitalized noun and a
  // particle; only the particle carries a Chinese gloss, and insisting on the
  // noun would send Chinese back to the model that answers "yes".
  for (const candidate of await resolve(dictStore(), word)) {
    const gloss = candidate.glosses[target as Target][0];
    if (gloss) return gloss.text;
  }
  return null;
}

async function translateSentence(source: Lang, target: Lang, sentence: string): Promise<string> {
  let current = sentence;

  for (const model of chainFor(source, target)) {
    const translator = await load(model);
    const output = await translator(current, GENERATION);
    const first = Array.isArray(output) ? output[0] : output;
    const text = (first as { translation_text?: string })?.translation_text?.trim() ?? "";
    if (!text) throw new Error(`${model} returned nothing`);

    // Clean up after every hop, so a repetitive English intermediate is not fed
    // into the Chinese model and amplified there.
    current = collapseRepetition(text, {
      sourceSentences: 1,
      collapseSentences: target === "zh",
      sourceWords: sentence.split(/\s+/).filter(Boolean).length,
    });
  }

  return current;
}

/**
 * Translate into several languages.
 *
 * Sequential on purpose: the models share the process's memory and CPU, and
 * running them concurrently makes every request slower without finishing sooner.
 * Chinese reuses the German → English hop, which is already resident by then.
 */
export async function translateAll(
  source: Lang,
  targets: readonly Lang[],
  sentence: string,
): Promise<Partial<Record<Lang, Translation>>> {
  const translations: Partial<Record<Lang, Translation>> = {};
  for (const target of targets) translations[target] = await translate(source, target, sentence);
  return translations;
}

/** Load every model up front, for warmup and for `pnpm models:fetch`. */
export async function loadAllModels(
  onProgress?: (model: string, index: number, total: number) => void,
): Promise<void> {
  for (const [index, model] of ALL_MODELS.entries()) {
    onProgress?.(model, index, ALL_MODELS.length);
    await load(model);
  }
}

/** Which models are resident right now — for `/api/health`. */
export function residentModels(): string[] {
  return [...pipelines.keys()];
}
