import assert from "node:assert/strict";
import { test } from "node:test";

import { translate } from "./mt.ts";

test("symbol-only input is preserved without asking a language model", async () => {
  assert.deepEqual(await translate("de", "en", "  😊?!  "), {
    text: "😊?!",
    fromDictionary: false,
  });
});
