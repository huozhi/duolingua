import Image from "next/image";

const RELEASES_URL = "https://github.com/huozhi/duolingua/releases/latest";
const REPOSITORY_URL = "https://github.com/huozhi/duolingua";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 bg-stone-50 font-sans text-neutral-900 dark:bg-neutral-950 dark:text-neutral-50">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-8 sm:px-10 sm:py-12">
        <header className="flex items-center gap-3">
          <Image src="/icon.svg" alt="" width={48} height={48} unoptimized />
          <span className="text-xl font-semibold tracking-tight">duolingua</span>
        </header>

        <section className="grid flex-1 items-center gap-10 py-16 lg:grid-cols-[1fr_22rem] lg:py-24">
          <div className="max-w-2xl">
            <p className="mb-5 text-sm font-medium uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
              Private. Offline. On your Mac.
            </p>
            <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
              Four languages,
              <br />
              one focused translator.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-neutral-600 dark:text-neutral-300">
              Translate between German, English, Spanish, and Chinese. German text also gets a
              word-by-word breakdown of grammar, case, gender, and tense.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <a
                href={RELEASES_URL}
                className="rounded-xl bg-neutral-900 px-5 py-3 font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                Download for macOS
              </a>
              <a
                href={REPOSITORY_URL}
                className="rounded-xl border border-neutral-300 px-5 py-3 font-medium text-neutral-700 transition hover:border-neutral-500 hover:text-neutral-950 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-white"
              >
                View on GitHub
              </a>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-xl shadow-neutral-900/5 dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/30">
            <Image
              src="/icon.svg"
              alt="duolingua app icon"
              width={320}
              height={320}
              unoptimized
              priority
              className="h-auto w-full rounded-2xl"
            />
            <div className="mt-6 grid grid-cols-2 gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <span>Deutsch</span>
              <span>English</span>
              <span>Español</span>
              <span>中文</span>
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap justify-between gap-3 border-t border-neutral-200 pt-6 text-sm text-neutral-500 dark:border-neutral-800">
          <span>Open source and built to run locally.</span>
          <a href={RELEASES_URL} className="underline hover:text-neutral-900 dark:hover:text-white">
            All releases
          </a>
        </footer>
      </main>
    </div>
  );
}
