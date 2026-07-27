# Was das?

Paste a German sentence, read it in **English, Spanish and Chinese** — as a full sentence and word
by word, with part of speech, case, gender and tense.

No API key and no third-party translation service: the models run on your own server, and nothing
is downloaded by the browser.

## Two layers

Both run on the server; the browser downloads nothing but the page.

**The word layer** is a 9.6MB dictionary compiled from Wiktionary and HanDeDict, queried through
`/api/analyze`. Lemma, part of speech, gender, case, number, tense and glosses in all three
languages. No model is involved, so it answers in milliseconds.

**The sentence layer** is OPUS-MT, about 100ms per sentence once warm, 0.36s for all three languages.

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
pnpm dict:lookup gelesen Häuser Bahnhofskatze   # instant; loads no models
pnpm translate "Wir müssen morgen früh zum Bahnhof fahren."
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
pnpm models:fetch   # ~330MB of translation models (once)
pnpm dev
```

`data/dict/` is committed, so the two dictionary steps are only needed to rebuild it from newer
source data. `pnpm install` must be allowed to run `onnxruntime-node`'s install script — that is what
`onlyBuiltDependencies` in `pnpm-workspace.yaml` is for, and without it translation silently falls
back to WebAssembly.

```bash
pnpm build && pnpm start
pnpm test           # format round-trips, dictionary integrity, sentence fixtures
pnpm lint
```

## Deploying

```bash
docker build -t was-das .
docker run -p 3000:3000 was-das
```

The image bakes in both the dictionary and the models, so it runs with no outbound network:

```bash
docker run --network none -p 3000:3000 was-das
```

Expect roughly 900MB. `MODEL_CACHE_DIR` points at the baked weights; `/api/health` reports the
dictionary version and which models are resident without loading any, so it is safe as a probe.

## API

```bash
curl -sX POST localhost:3000/api/translate -H 'content-type: application/json' \
  -d '{"sentence":"Der Hund springt über den Zaun.","targets":["en","zh"]}'
# {"translations":{...},"fromDictionary":[],"viaEnglish":["zh"]}

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
  dictFormat.ts      the on-disk format, written by the build and read by everything
  dictStore.ts       shard loading and parsing, with the loader injected
  morphology.ts      surface form → lemma: form index, ending stripping, compounds
  germanTables.ts    closed-class words, determiner paradigms, preposition cases
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
- **Chinese is translated via English.** No German → Chinese ONNX model exists, and the Helsinki
  `de-ZH` pair it would come from is low-resource; two well-trained hops beat one weak one. Rows
  translated this way say so.
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
