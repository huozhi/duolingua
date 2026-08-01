import { NextResponse } from "next/server";
import { asLang, detectLanguage } from "@/lib/detect";
import { glossSentence } from "@/lib/gloss";
import { dictStore } from "@/server/dict";

export const runtime = "nodejs";

const MAX_LENGTH = 600;

/**
 * Word-by-word analysis: lemma, part of speech, gender, case, number, tense and
 * glosses in all three targets.
 *
 * This is what the app's word layer runs on — the browser posts here rather than
 * downloading 10MB of dictionary shards, which is why the shards are not
 * web-served at all. Cheap: no model is involved, only shard reads off disk.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL) return new NextResponse(null, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { sentence } = (body ?? {}) as { sentence?: unknown };

  if (typeof sentence !== "string" || !sentence.trim()) {
    return NextResponse.json({ error: "Please provide a sentence." }, { status: 400 });
  }
  if (sentence.length > MAX_LENGTH) {
    return NextResponse.json(
      { error: `Sentence is too long (max ${MAX_LENGTH} characters).` },
      { status: 400 },
    );
  }

  // German only, and worth refusing rather than obliging: the dictionary, the
  // determiner paradigms, the compound splitter and every tagging rule are
  // German. Fed Spanish, this would return a page of `other`-tagged tokens with
  // no glosses, which looks like an answer and is not one.
  const source = asLang((body as { source?: unknown }).source) ?? detectLanguage(sentence).lang;
  if (source !== "de") {
    return NextResponse.json(
      {
        error: "Word-by-word analysis is available for German only.",
        detected: source,
      },
      { status: 422 },
    );
  }

  try {
    return NextResponse.json(await glossSentence(sentence.trim(), dictStore()));
  } catch (error) {
    console.error("analyze failed:", error);
    return NextResponse.json(
      { error: "Analysis failed. Is the dictionary built? Run `pnpm dict:build`." },
      { status: 503 },
    );
  }
}
