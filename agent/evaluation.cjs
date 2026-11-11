"use strict";

const { createHarness } = require("./harness.cjs");
const data = require("./data/index.cjs");
const engine = require("./forecast.cjs");
const textModel = require("./text-model.cjs");

function evaluate() {
  const harness = createHarness(":memory:", data, engine, textModel);
  const scenarioId = "01";
  const disabledSource = "zenodo-nepal-mseed";
  function replay(disabledSources) {
    const run = harness.start(scenarioId, disabledSources);
    harness.advance(run.id, run.duration);
    const events = harness.history(run.id);
    const forecasts = events.filter(event => event.type === "forecast" && event.data.source);
    const recipients = new Map();
    for (const event of events) {
      if (event.type !== "delivery" || event.data.status !== "delivered" || event.data.kind !== "Alert") continue;
      const { targetId, name } = event.data;
      if (!recipients.has(targetId)) recipients.set(targetId, { id: targetId, name, time: event.time });
    }
    return { firstForecast: forecasts[0]?.time ?? null, forecastCount: forecasts.length, receipts: [...recipients.values()] };
  }
  try {
    return {
      textModel: textModel.evaluate(),
      replayAblation: {
        scenarioId, disabledSource, full: replay([]), disabled: replay([disabledSource]),
        scope: "同一回放仅关闭上游波形输入。时刻为回放秒，观测送达延迟含演练设定。"
      }
    };
  } finally {
    harness.close();
  }
}
if (require.main === module) console.log(JSON.stringify(evaluate(), null, 2));
module.exports = { evaluate };
