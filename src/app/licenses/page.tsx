import type { Metadata } from "next";
import Link from "next/link";
import manifest from "../../../data/dict/manifest.json";

export const metadata: Metadata = {
  title: "Sources and licenses — duolingua",
  description: "Where the dictionary and the translation models come from, and under which licenses.",
};

/**
 * Attribution page.
 *
 * This is not decoration: the dictionary is built from CC BY-SA sources, so the
 * generated shards in `data/dict/` are a derivative work that must credit its
 * sources and carry the same license.
 */
export default function Licenses() {
  const { coverage, version, generatedAt, sources } = manifest;

  return (
    <div className="min-h-full bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-20">
        <Link href="/translate" className="text-sm text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200">
          ← Back
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          Sources and licenses
        </h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Everything this app knows about German comes from the freely licensed sources below.
        </p>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Dictionary</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Version {version}, built {new Date(generatedAt).toISOString().slice(0, 10)} —{" "}
            {coverage.lemmas.toLocaleString()} entries: {coverage.en.toLocaleString()} with English,{" "}
            {coverage.es.toLocaleString()} with Spanish, {coverage.zh.toLocaleString()} with Chinese.
          </p>

          <ul className="mt-4 flex flex-col gap-4">
            {sources.map((source) => (
              <li
                key={source.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <a
                  href={source.url}
                  className="font-medium text-neutral-900 underline dark:text-neutral-100"
                  rel="noreferrer"
                >
                  {source.title}
                </a>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{source.use}.</p>
                <p className="mt-2 text-xs text-neutral-500">
                  {source.attribution} —{" "}
                  <a href={source.licenseUrl} className="underline" rel="noreferrer">
                    {source.license}
                  </a>
                </p>
              </li>
            ))}
          </ul>

          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            The dictionary files this app ships are a derivative of the sources above and are
            therefore made available under the same{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" className="underline" rel="noreferrer">
              CC BY-SA 4.0
            </a>{" "}
            terms, with attribution as listed.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Translation models
          </h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Full-sentence translation uses{" "}
            <a href="https://github.com/Helsinki-NLP/Opus-MT" className="underline" rel="noreferrer">
              OPUS-MT
            </a>{" "}
            models from the Helsinki-NLP group, converted to ONNX and run by{" "}
            <a href="https://github.com/huggingface/transformers.js" className="underline" rel="noreferrer">
              transformers.js
            </a>{" "}
            on this server rather than in your browser — so there is nothing to download, and no
            third-party translation service involved. Sentences are translated in memory and are
            not stored. OPUS-MT models are released under the{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/" className="underline" rel="noreferrer">
              CC BY 4.0
            </a>{" "}
            license.
          </p>
          <ul className="mt-3 flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
            <li>Xenova/opus-mt-de-en · opus-mt-de-es</li>
            <li>Xenova/opus-mt-en-de · opus-mt-en-es · opus-mt-en-zh</li>
            <li>Xenova/opus-mt-es-en · opus-mt-zh-en</li>
            <li>
              English is the hub: not every pair exists — there is no German → Chinese model — so
              routes between two non-English languages run two of these in sequence.
            </li>
          </ul>
          <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
            The dictionary covers German → English, Spanish and Chinese, which is why the
            word-by-word breakdown appears for German input only.
          </p>
        </section>
      </main>
    </div>
  );
}
