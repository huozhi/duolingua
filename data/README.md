# Dictionary sources

`data/raw/` holds the unmodified downloads the dictionary is compiled from. It is gitignored — the
files total around 375MB — and refetched with `pnpm dict:fetch`. The exact snapshot each build used
is recorded in `data/SOURCES.json`, which the fetch script writes and which is committed.

The build reads these and writes `data/dict/`, which is what the server queries at runtime. The
shards are never web-served: the browser asks `/api/analyze` instead of downloading them.

| File | Source | License |
|------|--------|---------|
| `dewiktionary-raw.jsonl.gz` | [kaikki.org](https://kaikki.org/dewiktionary/) extract of [German Wiktionary](https://de.wiktionary.org), produced with [wiktextract](https://github.com/tatuylonen/wiktextract) | CC BY-SA 4.0 |
| `handedict.u8` | [HanDeDict](https://github.com/gugray/HanDeDict), CEDICT format, updated nightly | CC BY-SA 3.0 |
| `de_50k.txt` | [FrequencyWords](https://github.com/hermitdave/FrequencyWords), German frequencies from OpenSubtitles | CC BY-SA 4.0 |

## What is taken from each

**German Wiktionary** is the spine. It is the only source carrying all three target languages under
one license, and it supplies parts of speech, noun gender, inflection tables, and translations. Two
kinds of entry matter: lemma entries with a `forms` table, and dedicated inflected-form entries that
point back at their lemma through `form_of`.

**HanDeDict** exists because Wiktionary's Chinese coverage is thin — about 6,000 German lemmas have a
Chinese translation there, against 80,000 with English. Inverting HanDeDict's Chinese → German
direction raises Chinese coverage to roughly 46,000 lemmas. Inversion is noisy by nature, so
candidates are ranked by how common their characters are across the whole dictionary, whether the
German word was the entry's primary gloss, and whether the entry is a proper noun or a technical
term. Function words never take a HanDeDict gloss: inverting one offers 何人 ("who") as a translation
of `der`.

**The frequency list** decides what is worth shipping. A lemma is kept if it appears in everyday
German or if we have a translation for it in at least one language.

## Share-alike

All three sources are CC BY-SA. The compiled files in `data/dict/` are a derivative work, so they
carry the same terms and the attribution shown on the app's `/licenses` page. If you redistribute a
rebuilt dictionary, keep both.
