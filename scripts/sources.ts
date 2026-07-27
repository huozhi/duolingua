/**
 * Where the dictionary data comes from. Kept in one place because the license
 * page and `data/SOURCES.json` are generated from it — attribution is a
 * requirement of the CC BY-SA sources, not a nicety.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RAW_DIR = join(ROOT, "data", "raw");
export const OUT_DIR = join(ROOT, "data", "dict");

export type Source = {
  id: string;
  file: string;
  url: string;
  title: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  /** What we take from it, for the license page. */
  use: string;
};

export const SOURCES: Source[] = [
  {
    id: "dewiktionary",
    file: "dewiktionary-raw.jsonl.gz",
    url: "https://kaikki.org/dewiktionary/raw-wiktextract-data.jsonl.gz",
    title: "German Wiktionary, extracted by wiktextract (kaikki.org)",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    attribution: "de.wiktionary.org contributors; extraction by Tatu Ylönen (wiktextract)",
    use: "German lemmas, parts of speech, noun gender, inflected forms, and translations into English, Spanish and Chinese",
  },
  {
    id: "handedict",
    file: "handedict.u8",
    url: "https://raw.githubusercontent.com/gugray/HanDeDict/master/handedict.u8",
    title: "HanDeDict — collaborative Chinese-German dictionary",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    attribution: "HanDeDict contributors; originally supported by Chinesisch-Deutsche Gesellschaft e.V. Hamburg",
    use: "German → Chinese glosses with pinyin, inverted from the Chinese → German direction",
  },
  {
    id: "frequency",
    file: "de_50k.txt",
    url: "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_50k.txt",
    title: "FrequencyWords — German word frequencies from OpenSubtitles",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    attribution: "Hermit Dave, derived from the OpenSubtitles corpus",
    use: "frequency ranking, used to decide which lemmas are worth shipping",
  },
];
