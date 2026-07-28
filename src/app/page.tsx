import Link from "next/link";
import Translator from "./translator";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pb-10 pt-6 sm:pt-8">
        <header className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            q4
          </h1>
        </header>

        <Translator />

        <div className="min-h-16 flex-1" />

        <footer className="border-t border-neutral-200 pt-6 text-xs text-neutral-500 dark:border-neutral-800">
          <p>
            Word data from Wiktionary and HanDeDict, CC BY-SA. Sentence translation by OPUS-MT,
            running on your device. Language pairs without a direct model are translated via
            English.{" "}
            <Link href="/licenses" className="underline hover:text-neutral-800 dark:hover:text-neutral-200">
              Sources and licenses
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
