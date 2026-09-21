const assert = require("node:assert/strict");

require("./portfolio-model.js");

const { WORKLOADS, forecast } = globalThis.PortfolioModel;

for (const workloadId of Object.keys(WORKLOADS)) {
  const result = forecast(workloadId);
  assert.equal(result.rows.length, 12, `${workloadId} should return 12 months`);
  assert.equal(result.rows[0].month, "Month 1");
  assert.equal(result.rows[11].month, "Month 12");
  assert.ok(result.rows.every((row) => Number.isFinite(row.primary) && row.primary >= 0));
  assert.ok(result.summary.length === 4);
  assert.ok(result.guidance.length > 20);
  assert.ok(result.caveat.length > 20);
}

const code = forecast("genie-code");
assert.ok(code.rows[11].weightedTokens > code.rows[0].weightedTokens);
assert.equal(code.rows[0].genieDbu, 0, "Genie DBUs require pilot calibration");

const calibratedCode = forecast("genie-code", {
  ...WORKLOADS["genie-code"].defaults,
  dbuPerMillionTokens: 2,
  listPricePerDbu: 0.5,
  discountRate: 20,
});
assert.ok(calibratedCode.annualDbu > 0);
assert.ok(calibratedCode.annualCost > 0);
assert.ok(calibratedCode.annualListCost > calibratedCode.annualCost);
assert.ok(Math.abs(calibratedCode.annualDiscountSavings / calibratedCode.annualListCost - 0.2) < 1e-9);

const low = forecast("genie-api", {}, "low");
const high = forecast("genie-api", {}, "high");
assert.ok(high.rows[0].weightedTokens > low.rows[0].weightedTokens);
assert.ok(high.rows[11].peakRpm > low.rows[11].peakRpm);

const aibi = forecast("aibi");
assert.ok(aibi.rows[0].queries > 0);
assert.ok(aibi.rows[0].clusters >= 1);

const apps = forecast("apps");
assert.ok(Math.abs(apps.rows[0].appDbu - 729.6) < 1e-9);

const lakehouse = forecast("lakehouse");
assert.ok(lakehouse.rows[11].storageTb > lakehouse.rows[0].storageTb);
assert.ok(lakehouse.rows[11].totalDbu > lakehouse.rows[0].totalDbu);
const largerLakehouse = forecast("lakehouse", {
  ...WORKLOADS.lakehouse.defaults,
  ingestionGbDay: 1000,
});
assert.ok(largerLakehouse.rows[0].totalDbu > lakehouse.rows[0].totalDbu);

console.log("Portfolio model tests passed");
