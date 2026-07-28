# q4 technical details

Paste a sentence in **German, English, Spanish or Chinese**; read it in the other three. German input
also gets a word-by-word breakdown with part of speech, case, gender and tense.

No API key and no third-party translation service: the models run on your own server, and nothing
is downloaded by the browser.

## Two layers

Both run on the server; the browser downloads nothing but the page.

**The sentence layer** is OPUS-MT with English as the hub. Seven models cover all twelve directions:
German, English and Spanish each have a direct pair with English, plus a direct German → Spanish, and
anything between two non-English languages goes through English in two hops. Rows that took the detour
say so. About 100ms per hop once warm.

**The word layer** is a 9.6MB dictionary compiled from Wiktionary and HanDeDict, queried through
`/api/analyze`. Lemma, part of speech, gender, case, number, tense and glosses in English, Spanish
and Chinese. No model is involved, so it answers in milliseconds. **German only** — the determiner
paradigms, preposition cases, compound splitter and the dictionary itself are all German-specific, so
other source languages get the three translations and nothing more.

## Detecting the source

The source language is detected in the browser as you type, from stopwords and orthography — no model,
no round trip. On real sentences it is reliable; on bare words it is not, because `no` is genuinely
both English and Spanish. So the guess is always shown as a selector you can override, and the API
reports its confidence (0 meaning "this is a default, not a finding").

A dictionary alone cannot do the sentence layer. German is verb-second in main clauses and verb-final
in subordinate ones, case is syncretic, verbs separate from their prefixes, and compounds are
unbounded — word-by-word substitution turns `Mir ist kalt` into "me is cold" where the model says
"I'm cold".

### Coverage

Measured against a frequency list of everyday German:

| Words | Found | English | Spanish | Chinese | All three |
|-------|-------|---------|---------|---------|-----------|
| top 1,000 | 97.7% | 95.9% | 94.1% | 94.0% | 92.4% |
| top 5,000 | 92.9% | 89.7% | 85.9% | 87.9% | 83.6% |
| top 20,000 | 86.5% | 81.3% | 73.0% | 78.0% | 69.3% |

Words outside the dictionary are still handled when they are compounds: `Bahnhofskatze` is split into
`Bahnhof` + `Katze` and takes the gender of its head.

Grammar comes from ordered rules over closed-class tables plus the dictionary's own inflection data,
not from a statistical tagger. Where case is genuinely ambiguous the card shows `nom/acc` rather than
guessing.

## Terminal

```bash
pnpm dict:lookup gelesen Häuser Bahnhofskatze   # instant; loads no models, German only
pnpm translate "Wir müssen morgen früh zum Bahnhof fahren."
pnpm translate "The dog jumps over the fence."   # detects English, gives de/es/zh
pnpm translate --from es "No tengo ni idea."     # override the detection
pnpm translate --targets en,zh --words "Mir ist kalt."
```

`dict:lookup` runs the same resolution the app does — inflections, adjective endings, compound
splitting — and never touches a model, so it answers immediately. `translate` loads the models into
the current process; the first run downloads them unless `pnpm models:fetch` has been run.

## Getting started

```bash
pnpm install
pnpm dict:fetch     # ~375MB of source data into data/raw/ (once)
pnpm dict:build     # compiles data/dict/ — about 20 seconds
pnpm models:fetch   # ~780MB of translation models (once)
pnpm dev
```

`data/dict/` is committed, so the two dictionary steps are only needed to rebuild it from newer
source data. `pnpm install` must be allowed to run `onnxruntime-node`'s install script — that is what
`onlyBuiltDependencies` in `pnpm-workspace.yaml` is for, and without it translation silently falls
back to WebAssembly.

```bash
pnpm build && pnpm start
pnpm test           # format round-trips, dictionary integrity, sentence fixtures
npx tsc --noEmit    # types; there is no linter in this project
```

## Desktop app

The desktop development app uses Vercel Labs' Native SDK and the system WebView
(WKWebView on macOS), with no Electron or bundled Chromium. Native SDK manages
the Next development server, opens the window and shuts the server down with it.

```bash
pnpm app             # native desktop window with Next.js hot reload
pnpm native:check    # validate the Native SDK manifest
pnpm native:build    # optimized native shell binary
```

The shell lives in `native-shell/`. Zig 0.16 is required (`brew install zig` on
macOS). A distributable offline package must additionally bundle Node, the
standalone Next server and the seven translation models because the translation
backend uses Transformers.js and ONNX Runtime; Native SDK itself deliberately
contains no JavaScript runtime.

Pushing a version tag publishes a macOS DMG and SHA-256 checksum to GitHub
Releases:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow supports Apple notarization when
`MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PASSWORD`, `MACOS_SIGNING_IDENTITY`,
`KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_APP_PASSWORD` and `APPLE_TEAM_ID` are
configured as repository secrets. Without them it publishes an ad-hoc-signed
DMG.

## Deploying

### Vercel

The repository includes `Dockerfile.vercel`, so importing it into Vercel or
running `vercel deploy` builds and deploys the complete container instead of a
regular serverless Next.js bundle. The container listens on Vercel's `$PORT` and
includes the dictionary, all seven translation models and native ONNX Runtime.
No model download happens while serving a request.

The image is about 1.15GB, so the deployment uses Vercel Large Functions on
Fluid compute. New projects are enrolled automatically. For an older project,
enable Large Functions when prompted or set `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`
in the Vercel project environment and redeploy.

For reliable access to every language direction, select 4GB memory under
**Project Settings → Functions → Function CPU**. The complete model set can
reach roughly 3GB after different translation directions have warmed the same
instance; Vercel Hobby is fixed at 2GB.

### Any Docker host

```bash
docker build -t q4 .
docker run -p 3000:3000 q4
```

The image bakes in both the dictionary and the models, so it runs with no outbound network:

```bash
docker run --network none -p 3000:3000 q4
```

Expect ~1.15GB on disk — the seven models are 780MB of it.

Memory is the number to plan around. Models load lazily and stay resident, and an ONNX session costs
far more than its weights on disk (~400MB of RSS per model against ~110MB of q8 weights). Measured in
the container:

| Loaded | Resident |
|--------|----------|
| none, just booted | 52 MiB |
| 1 model (German → English) | 514 MiB |
| 3 models (German → all) | 1.35 GiB |
| all 7 (every direction used) | 2.92 GiB |

So a container that only ever sees one direction is small, and one exercising all twelve wants ~3GB.
Do not set a 1GB limit and expect every language pair to work.

`MODEL_CACHE_DIR` points at the baked weights. `/api/health` reports the dictionary version and which
models are resident without loading any, so it is safe as a probe — and useful for watching the table
above fill up.

## API

```bash
curl -sX POST localhost:3000/api/translate -H 'content-type: application/json' \
  -d '{"sentence":"The dog jumps over the fence."}'
# {"source":"en","detected":{"lang":"en","confidence":0.33},"translations":{...},"viaEnglish":[]}

# `source` overrides detection; `targets` narrows the output.
curl -sX POST localhost:3000/api/translate -H 'content-type: application/json' \
  -d '{"sentence":"no","source":"es","targets":["de"]}'

curl -sX POST localhost:3000/api/translate -H 'content-type: application/json' -d '{"sentence":"Nein"}'
# {"translations":{"en":"no","es":"no","zh":"不是"},"fromDictionary":["en","es","zh"],"viaEnglish":[]}

curl -sX POST localhost:3000/api/analyze -H 'content-type: application/json' \
  -d '{"sentence":"Mir ist kalt."}'
```

The app itself uses both endpoints: `/api/analyze` for the word breakdown and `/api/translate` for
the sentence. The dictionary shards live in `data/dict` and are never web-served — nothing fetches
them over HTTP, so there is no `public/` directory at all.

## How it fits together

```
scripts/
  fetch-sources.ts   download Wiktionary, HanDeDict and a frequency list
  build-dict.ts      compile them into 512 gzipped TSV shards + a manifest in data/dict
  fetch-models.ts    warm the translation model cache
  lookup.ts          word lookup CLI
  translate.ts       sentence translation CLI
src/lib/             shared by browser, server and CLI
  dict-format.ts     the on-disk format, written by the build and read by everything
  dict-store.ts      shard loading and parsing, with the loader injected
  morphology.ts      surface form → lemma: form index, ending stripping, compounds
  german-tables.ts   closed-class words, determiner paradigms, preposition cases
  tagger.ts          part of speech and grammatical features, by ordered rules
  gloss.ts           the pipeline: tokenize → resolve → merge multiword → tag
src/server/
  mt.ts              the only place models are loaded
  degeneration.ts    removes the repetition these models emit on short inputs
  dict.ts            the dictionary, read from disk instead of over HTTP
src/app/api/         translate, analyze, health
```

Decisions worth knowing about:

- **gzip, not brotli**, for the dictionary shards: `DecompressionStream('gzip')` exists in every
  browser, so any static host works with no `Content-Encoding` negotiation to get wrong.
- **Adjective declensions are not stored.** German adjective endings are a closed set, so stripping
  them at runtime is exact and removes ~850k rows.
- **The package is ESM** (`"type": "module"`). Without it Node parses every `.ts` script as CommonJS,
  fails, and reparses — which is what the `MODULE_TYPELESS_PACKAGE_JSON` warning was about. Next
  notices the field and emits an ESM `server.js` for the standalone build, so the Docker image is
  unaffected.
- **English is the hub.** OPUS-MT publishes one model per ordered pair and not all of them exist —
  there is no German → Chinese model at all. Rather than ship a weak direct pair, routes between two
  non-English languages take two well-trained hops through English, and the UI says which rows did.
- **The bare-word dictionary net only covers German.** A single German word is answered from the
  dictionary because the models are unreliable on isolated words. There is no equivalent for English,
  Spanish or Chinese sources, so a bare word in those languages keeps the model's weakness.
- **A lowercase word never matches an all-caps abbreviation.** Lookup keys are case-folded so
  sentence-initial `Der` finds `der`, which also made `zum` match the abbreviation `ZUM` and offer
  "bus terminal" as a reading. `ARD` still resolves; `ard` no longer does.
- **A single word is answered from the dictionary, not the model.** These are sentence models and
  they are unreliable on bare words — `Nein` came back as "Yes", while every longer negation
  ("Nicht heute", "Kein Problem", "Nein danke") is correct. For one word the dictionary is simply the
  better tool, and the row says where the answer came from.
- **Input is split into sentences before translating.** These are sentence-level models: given two
  sentences at once they translate the first and silently drop the rest.
- **Degeneration is removed after generation, not prevented during it.** `opus-mt-en-zh` will not stop
  on short inputs — "Where is it?" comes back as 在哪里? 在哪里? 在哪里?. No decoding parameter fixes
  it, and `repetition_penalty` / `no_repeat_ngram_size` make it worse by turning the repeats into
  *paraphrases* ("I'm cold" → 你觉得冷吗?, "are you cold?"). `src/server/degeneration.ts` collapses it
  afterwards with rules that cannot delete meaning: drop a segment only when every character in it
  already appeared, and enforce one-sentence-in-one-sentence-out for Chinese.

## Licenses

The dictionary is built from [German Wiktionary](https://de.wiktionary.org) (CC BY-SA 4.0),
[HanDeDict](https://handedict.zydeo.net/) (CC BY-SA 3.0) and
[FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 4.0). The compiled files in
`data/dict/` are a derivative work and carry the same CC BY-SA terms. Sentence translation uses
[OPUS-MT](https://github.com/Helsinki-NLP/Opus-MT) models (CC BY 4.0) via
[transformers.js](https://github.com/huggingface/transformers.js).

Full attribution is on the `/licenses` page in the app.
