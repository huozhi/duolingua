import assert from "node:assert/strict";
import { test } from "node:test";

import { collapseRepetition, joinSentences, splitSentences } from "./degeneration.ts";

const zh = { sourceSentences: 1, collapseSentences: true };
const en = { sourceSentences: 1, collapseSentences: false };

test("splits input into sentences so none is dropped", () => {
  assert.deepEqual(splitSentences("Mir ist kalt."), ["Mir ist kalt."]);
  assert.deepEqual(splitSentences("Wo ist es"), ["Wo ist es"]);
  // The bug this exists for: given both at once, the model translated only the first.
  assert.deepEqual(splitSentences("Es regnet. Ich bleibe hier."), ["Es regnet.", "Ich bleibe hier."]);
  assert.deepEqual(splitSentences("Wirklich? Ja! Gut."), ["Wirklich?", "Ja!", "Gut."]);
  assert.deepEqual(splitSentences("   "), []);
});

test("rejoins sentences without inventing spaces in Chinese", () => {
  assert.equal(joinSentences(["下雨了。", "我留在家里。"]), "下雨了。我留在家里。");
  assert.equal(joinSentences(["It's raining.", "I'm staying home."]), "It's raining. I'm staying home.");
  assert.equal(joinSentences(["Solo.", ""]), "Solo.");
});

test("a sentence repeated for one source sentence is reduced to one", () => {
  // The reported case: "Wo ist es" produced three phrasings of the same question.
  assert.equal(collapseRepetition("在哪里? 在哪里呢? 在哪儿?", zh), "在哪里?");
  assert.equal(collapseRepetition("在哪里? 在哪里? 在哪里?", zh), "在哪里?");
});

test("a clause repeated inside a sentence is dropped", () => {
  const looped = "我好冷," + "我冷,".repeat(25);
  assert.equal(collapseRepetition(looped, zh), "我好冷");
});

test("clauses that add meaning are kept", () => {
  // 狗 does not appear in the first clause, so the second is not a repetition.
  assert.equal(collapseRepetition("我喜欢猫,我喜欢狗", zh), "我喜欢猫,我喜欢狗");
  assert.equal(
    collapseRepetition("尽管天气恶劣,孩子们还是去散步。", zh),
    "尽管天气恶劣,孩子们还是去散步。",
  );
});

test("good translations pass through untouched", () => {
  for (const text of [
    "狗跳过围栏",
    "我们明早得去车站",
    "我读的书很好看",
    "The dog jumps over the fence.",
    "A pesar del mal tiempo, los niños se fueron a pasear.",
  ]) {
    assert.equal(collapseRepetition(text, zh), text, text);
  }
});

test("multi-sentence input keeps its multiple sentences", () => {
  const text = "狗跳过围栏。孩子们还是去散步。";
  assert.equal(collapseRepetition(text, { sourceSentences: 2, collapseSentences: true }), text);
});

test("English and Spanish are never truncated to one sentence", () => {
  // Splitting one long German sentence into two is legitimate for these, so the
  // sentence-level rule must not apply — only exact repeats are removed.
  const split = "He arrived late. Everyone had already left.";
  assert.equal(collapseRepetition(split, en), split);
  assert.equal(collapseRepetition("I'm cold. I'm cold.", en), "I'm cold.");
});

test("space-separated Chinese repetition is collapsed", () => {
  // `Ja` came back as this: Chinese has no word spaces, so the model was
  // segmenting its own repetition.
  assert.equal(collapseRepetition("是 是 是", zh), "是");
  assert.equal(collapseRepetition("谢谢 谢谢", zh), "谢谢");
});

test("a short source cannot justify several Chinese clauses", () => {
  // "It's raining." (two words) produced 下雨了,我还想说 — "it's raining, I still
  // want to say". The added clause is not a repetition, so only the source's
  // length reveals it as padding.
  assert.equal(
    collapseRepetition("下雨了,我还想说", { ...zh, sourceWords: 2 }),
    "下雨了",
  );
  // A longer source keeps its clauses.
  assert.equal(
    collapseRepetition("尽管天气恶劣,孩子们还是去散步。", { ...zh, sourceWords: 9 }),
    "尽管天气恶劣,孩子们还是去散步。",
  );
});

test("two Chinese phrasings separated by a space keep only the first", () => {
  // `Guten Tag` produced two different greetings side by side.
  assert.equal(collapseRepetition("下午好 午安", zh), "下午好");
  assert.equal(collapseRepetition("你好 " + "你好 ".repeat(50), zh), "你好");
});

test("Chinese containing Latin or digits keeps its spaces", () => {
  assert.equal(collapseRepetition("iPhone 15 很好", zh), "iPhone 15 很好");
  assert.equal(collapseRepetition("他在 2024 年去了北京", zh), "他在 2024 年去了北京");
});

test("Latin words are never deleted by the space rule", () => {
  // The same rule applied to English would eat words whose letters already
  // appeared — it must only run on Chinese.
  assert.equal(collapseRepetition("I saw a saw", en), "I saw a saw");
  assert.equal(collapseRepetition("Yes it is", en), "Yes it is");
  assert.equal(collapseRepetition("The dog jumps over the fence.", en), "The dog jumps over the fence.");
});

test("punctuation carried by a dropped clause is restored", () => {
  assert.equal(collapseRepetition("我好冷,我冷,我冷。", zh), "我好冷。");
});

test("whitespace and empty input are handled", () => {
  assert.equal(collapseRepetition("   ", zh), "");
  assert.equal(collapseRepetition("在哪里?  ", zh), "在哪里?");
});
