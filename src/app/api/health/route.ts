import { NextResponse } from "next/server";
import { ALL_MODELS } from "@/lib/mt-models";
import { dictManifest } from "@/server/dict";
import { residentModels } from "@/server/mt";

export const runtime = "nodejs";

/**
 * Readiness for the desktop app's bundled local server.
 *
 * Reports the dictionary version and which models are loaded — deliberately
 * without loading any, so a probe stays cheap. A cold server is healthy; its
 * first translation is just slower.
 */
export async function GET() {
  if (process.env.VERCEL) return new NextResponse(null, { status: 404 });

  try {
    const manifest = await dictManifest();
    return NextResponse.json({
      status: "ok",
      dictionary: { version: manifest.version, lemmas: manifest.coverage.lemmas },
      models: { expected: ALL_MODELS, loaded: residentModels() },
    });
  } catch {
    return NextResponse.json(
      { status: "degraded", error: "Dictionary manifest missing. Run `pnpm dict:build`." },
      { status: 503 },
    );
  }
}
