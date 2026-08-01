import { NextResponse } from "next/server";
import { LANGS, type Lang } from "@/lib/analysis";
import { asLang, detectLanguage } from "@/lib/detect";
import { isPivoted, targetsFor } from "@/lib/mt-models";
import { translateAll } from "@/server/mt";

/** Native ONNX Runtime is a Node addon, so this cannot run on the edge. */
export const runtime = "nodejs";

/** Loading a cold model takes a few seconds; a two-hop route loads two. */
export const maxDuration = 120;

const MAX_LENGTH = 600;

/**
 * The languages asked for, defaulting to every language but the source. Returns
 * null when the request named something we do not translate.
 */
function parseTargets(value: unknown, source: Lang): Lang[] | null {
  if (value === undefined) return targetsFor(source);
  if (!Array.isArray(value)) return null;

  const targets = value.map(asLang);
  if (targets.some((target) => target === null)) return null;

  // Asking for the source language back is a no-op, not an error.
  const wanted = (targets as Lang[]).filter((target) => target !== source);
  return wanted.length ? [...new Set(wanted)] : targetsFor(source);
}

export async function POST(request: Request) {
  if (process.env.VERCEL) return new NextResponse(null, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { sentence, source, targets } = (body ?? {}) as {
    sentence?: unknown;
    source?: unknown;
    targets?: unknown;
  };

  if (typeof sentence !== "string" || !sentence.trim()) {
    return NextResponse.json({ error: "Please provide a sentence." }, { status: 400 });
  }
  if (sentence.length > MAX_LENGTH) {
    return NextResponse.json(
      { error: `Sentence is too long (max ${MAX_LENGTH} characters).` },
      { status: 400 },
    );
  }
  if (source !== undefined && asLang(source) === null) {
    return NextResponse.json(
      { error: `source must be one of ${LANGS.join(", ")}.` },
      { status: 400 },
    );
  }

  // Detection runs either way, so the response can report what it saw even when
  // the caller overrode it.
  const detected = detectLanguage(sentence);
  const from = asLang(source) ?? detected.lang;

  const wanted = parseTargets(targets, from);
  if (!wanted) {
    return NextResponse.json(
      { error: `targets must be a subset of ${LANGS.join(", ")}.` },
      { status: 400 },
    );
  }

  try {
    const results = await translateAll(from, wanted, sentence.trim());

    const translations: Partial<Record<Lang, string>> = {};
    const fromDictionary: Lang[] = [];
    for (const target of wanted) {
      const result = results[target];
      if (!result) continue;
      translations[target] = result.text;
      if (result.fromDictionary) fromDictionary.push(target);
    }

    return NextResponse.json({
      source: from,
      detected,
      translations,
      // Provenance, so the client can be explicit: a single German word is
      // answered from the dictionary and never goes through English.
      fromDictionary,
      viaEnglish: wanted.filter(
        (target) => isPivoted(from, target) && !fromDictionary.includes(target),
      ),
    });
  } catch (error) {
    console.error("translate failed:", error);
    // A failure here is the model, not the request: either the weights are missing
    // or the session could not be built.
    return NextResponse.json(
      { error: "The translation model is unavailable. Check the server logs." },
      { status: 503 },
    );
  }
}
