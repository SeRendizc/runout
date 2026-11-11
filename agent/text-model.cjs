"use strict";

const corpus = require("./data/posts.cjs");
const modelId = "runout-multilingual-bayes-v1";
const segmenters = new Map();

function tokens(text, language) {
  const locale = ["zh", "en", "ne"].includes(language) ? language : "en";
  if (!segmenters.has(locale)) segmenters.set(locale, new Intl.Segmenter(locale, { granularity: "word" }));
  return Array.from(segmenters.get(locale).segment(text.normalize("NFKC").toLowerCase()))
    .filter(part => part.isWordLike)
    .map(part => part.segment);
}

const labels = ["candidate", "other"];
const stats = Object.fromEntries(labels.map(label => [label, { docs: 0, total: 0, words: new Map() }]));
const vocabulary = new Set();
const training = corpus.filter(record => record.truth.partition === "train");
for (const { observation, truth } of training) {
  const bucket = stats[truth.label === "clue" ? "candidate" : "other"];
  bucket.docs++;
  for (const word of tokens(observation.text, observation.language)) {
    vocabulary.add(word);
    bucket.total++;
    bucket.words.set(word, (bucket.words.get(word) ?? 0) + 1);
  }
}

function classify(text, language) {
  const known = tokens(text, language).filter(word => vocabulary.has(word));
  const scores = labels.map(label => {
    const bucket = stats[label];
    return known.reduce((score, word) =>
      score + Math.log(((bucket.words.get(word) ?? 0) + 1) / (bucket.total + vocabulary.size)),
      Math.log((bucket.docs + 1) / (training.length + labels.length)));
  });
  return { modelId, status: known.length && scores[0] > scores[1] ? "candidate" : "irrelevant", matchedTokens: known.length };
}

function evaluate() {
  const heldOut = corpus.filter(record => record.truth.partition === "test");
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const { observation, truth } of heldOut) {
    const actual = truth.label === "clue";
    const predicted = classify(observation.text, observation.language).status === "candidate";
    if (actual && predicted) tp++;
    else if (predicted) fp++;
    else if (actual) fn++;
    else tn++;
  }
  return {
    modelId, dataset: "合成贴文，按场景分组", training: training.length, test: heldOut.length,
    tp, fp, fn, tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null
  };
}
module.exports = { classify, evaluate };
