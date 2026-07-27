import { NextResponse } from "next/server";
import { TARGETS, type Target } from "@/lib/analysis";
import { isPivoted } from "@/lib/mtModels";
import { translateAll } from "@/server/mt";

/** Native ONNX Runtime is a Node addon, so this cannot run on the edge. */
export const runtime = "nodejs";

/** Loading a cold model takes a few seconds; three of them can take longer. */
export const maxDuration = 120;

const MAX_LENGTH = 600;

function parseTargets(value: unknown): Target[] | null {
  if (value === undefined) return [...TARGETS];
  if (!Array.isArray(value)) return null;

  const targets = value.filter((item): item is Target => TARGETS.includes(item as Target));
  if (targets.length !== value.length) return null;
  return targets.length ? targets : [...TARGETS];
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { sentence, targets } = (body ?? {}) as { sentence?: unknown; targets?: unknown };

  if (typeof sentence !== "string" || !sentence.trim()) {
    return NextResponse.json({ error: "Please provide a sentence." }, { status: 400 });
  }
  if (sentence.length > MAX_LENGTH) {
    return NextResponse.json(
      { error: `Sentence is too long (max ${MAX_LENGTH} characters).` },
      { status: 400 },
    );
  }

  const wanted = parseTargets(targets);
  if (!wanted) {
    return NextResponse.json(
      { error: `targets must be a subset of ${TARGETS.join(", ")}.` },
      { status: 400 },
    );
  }

  try {
    const results = await translateAll(wanted, sentence.trim());

    const translations: Partial<Record<Target, string>> = {};
    const fromDictionary: Target[] = [];
    for (const target of wanted) {
      const result = results[target];
      if (!result) continue;
      translations[target] = result.text;
      if (result.fromDictionary) fromDictionary.push(target);
    }

    return NextResponse.json({
      translations,
      // Provenance, so the client can be explicit about it: a single word is
      // answered from the dictionary and never goes through English.
      fromDictionary,
      viaEnglish: wanted.filter((target) => isPivoted(target) && !fromDictionary.includes(target)),
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
