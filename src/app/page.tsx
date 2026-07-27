import Link from "next/link";
import Translator from "./Translator";

export default function Home() {
  return (
    <div className="min-h-full bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-20">
        <header className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            Was&nbsp;das?
          </h1>
          <p className="mt-2 text-lg text-neutral-600 dark:text-neutral-400">
            Paste any German sentence and read it in English, Spanish and Chinese — word by
            word, with grammar. Nothing to download and no third-party service.
          </p>
        </header>

        <Translator />

        <footer className="mt-16 border-t border-neutral-200 pt-6 text-xs text-neutral-500 dark:border-neutral-800">
          <p>
            Word data from Wiktionary and HanDeDict, CC BY-SA. Sentence translation by OPUS-MT,
            running on your device.{" "}
            <Link href="/licenses" className="underline hover:text-neutral-800 dark:hover:text-neutral-200">
              Sources and licenses
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
