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

            <div className="mt-9 flex flex-wrap gap-x-7 gap-y-3">
              <a
                href={RELEASES_URL}
                className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-4 transition hover:decoration-neutral-900 dark:text-white dark:decoration-neutral-700 dark:hover:decoration-white"
              >
                Download for macOS ↗
              </a>
              <a
                href={REPOSITORY_URL}
                className="font-medium text-neutral-600 underline decoration-neutral-300 underline-offset-4 transition hover:text-neutral-900 hover:decoration-neutral-900 dark:text-neutral-300 dark:decoration-neutral-700 dark:hover:text-white dark:hover:decoration-white"
              >
                View on GitHub ↗
              </a>
            </div>
          </div>

          <div className="mx-auto w-full max-w-sm p-6">
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

        <footer className="flex flex-wrap justify-between gap-3 pt-6 text-sm text-neutral-500">
          <span>Open source and built to run locally.</span>
          <a href={RELEASES_URL} className="underline hover:text-neutral-900 dark:hover:text-white">
            All releases
          </a>
        </footer>
      </main>
    </div>
  );
}
