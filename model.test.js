const assert = require("node:assert/strict");

require("./model.js");

const result = globalThis.FinOpsModel.simulate();
const closeTo = (actual, expected, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );

closeTo(result.averageConcurrent, 0.8333333333);
closeTo(result.peakConcurrent, 4.1666666667);
closeTo(result.averageQpm, 0.5555555556);
closeTo(result.peakQpm, 2.7777777778);
closeTo(Math.max(...result.weekday), 2.7777777778);
closeTo(result.weekday.reduce((sum, value) => sum + value, 0) * 15, 1443.393807, 1e-5);
closeTo(result.metrics.utilizationPercent, 7.732466824, 1e-6);
assert.equal(result.metrics.queuedPercent, 0);
assert.equal(result.metrics.timeAbovePercent, 0);
assert.equal(result.recommendedQpm, 2.9);
closeTo(result.monthlyInteractions, 31177.306235, 1e-5);
closeTo(result.peakConcurrentQueries, 1.3888888889);

const constrained = globalThis.FinOpsModel.simulate({ reservationQpm: 1 });
assert.ok(constrained.metrics.queuedPercent > 0);
assert.ok(constrained.metrics.timeAbovePercent > 0);
assert.ok(constrained.metrics.utilizationPercent > result.metrics.utilizationPercent);

const noDemand = globalThis.FinOpsModel.simulate({
  averageUsers: 0,
  peakUsers: 0,
  reservationQpm: 0,
});
assert.equal(noDemand.metrics.queuedPercent, 0);
assert.equal(noDemand.metrics.utilizationPercent, 0);

const aibi = globalThis.FinOpsModel.simulate({
  workload: "aibi",
  peakUsers: 400,
  sessionMinutes: 15,
  adoptionRate: 25,
  scenario: "Standard",
  scenarioSeconds: { Fast: 30, Standard: 120, Slow: 300 },
  queryRuntimeSeconds: 30,
});
closeTo(aibi.peakConcurrentQueries, 6.25);
assert.ok(aibi.monthlyInteractions > 0);

console.log("Model tests passed");
