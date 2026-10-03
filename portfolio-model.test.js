const assert = require("node:assert/strict");

require("./portfolio-model.js");

const {
  WORKLOADS, forecast, mixFactor, GENIE_FREE_DBU_PER_USER,
  DEFAULT_SQL_PRICE, DEFAULT_GENIE_PRICE,
} = globalThis.PortfolioModel;

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
assert.ok(code.rows[11].genieGrossDbu > code.rows[0].genieGrossDbu);
assert.ok(code.rows[0].genieBilledDbu > 0, "Genie Code bills above the 150 DBU allowance");
assert.ok(code.rows[0].genieBilledDbu < code.rows[0].genieGrossDbu);

const one = forecast("genie-one");
assert.equal(one.rows[0].genieBilledDbu, 0, "Human Genie One is free during promo");
assert.ok(one.rows[0].genieGrossDbu > 0);
assert.ok(one.annualShadowListCost > one.annualListCost, "Would-be Genie cost is shown separately");

const onePost = forecast("genie-one", {
  ...WORKLOADS["genie-one"].defaults,
  dbuPerUserMonth: 400,
  pricingHorizon: "post-promo",
});
const users = WORKLOADS["genie-one"].defaults.activeUsers;
const intensity = mixFactor("regular");
const expectedGross = users * intensity * 400;
const expectedBilled = Math.max(0, expectedGross - users * GENIE_FREE_DBU_PER_USER);
assert.ok(Math.abs(onePost.rows[0].genieGrossDbu - expectedGross) < 1e-6);
assert.ok(Math.abs(onePost.rows[0].genieBilledDbu - expectedBilled) < 1e-6);

const sqlOnly = forecast("genie-code", {
  ...WORKLOADS["genie-code"].defaults,
  dbuPerUserMonth: 0,
  sqlDbuPer1000Queries: 10,
  sqlListPricePerDbu: 0.91,
  genieListPricePerDbu: 0.084,
  pricingHorizon: "post-promo",
});
const genieOnly = forecast("genie-code", {
  ...WORKLOADS["genie-code"].defaults,
  dbuPerUserMonth: 400,
  queriesPerPrompt: 0,
  sqlDbuPer1000Queries: 0,
  sqlListPricePerDbu: 0.91,
  genieListPricePerDbu: 0.084,
  pricingHorizon: "post-promo",
});
assert.equal(sqlOnly.config.sqlListPricePerDbu, DEFAULT_SQL_PRICE);
assert.equal(genieOnly.config.genieListPricePerDbu, DEFAULT_GENIE_PRICE);
assert.ok(genieOnly.rows[0].listCost > 0);
assert.ok(
  sqlOnly.rows[0].sqlDbu * 0.91 / Math.max(sqlOnly.rows[0].listCost, 1e-9) > 0.99,
  "SQL DBUs must use the SQL SKU price"
);

const sameDbuGenie = forecast("genie-api", {
  ...WORKLOADS["genie-api"].defaults,
  requestsPerDay: 1000,
  activeDays: 30,
  dbuPerThousandRequests: 1000,
  queriesPerPrompt: 0,
  nonEnglishShare: 0,
  pricingHorizon: "post-promo",
  genieListPricePerDbu: 0.07,
  sqlListPricePerDbu: 0.91,
});
assert.ok(Math.abs(sameDbuGenie.rows[0].genieBilledDbu - 30000) < 1);
assert.ok(Math.abs(sameDbuGenie.rows[0].listCost - 30000 * 0.07) < 1);

const api = forecast("genie-api");
assert.ok(api.rows[0].genieBilledDbu > 0, "API traffic has no human free allowance");

const english = forecast("genie-code", { ...WORKLOADS["genie-code"].defaults, nonEnglishShare: 0 });
const german = forecast("genie-code", { ...WORKLOADS["genie-code"].defaults, nonEnglishShare: 100 });
assert.ok(Math.abs(german.rows[0].genieGrossDbu / english.rows[0].genieGrossDbu - 2.9) < 1e-9);

const light = forecast("genie-one", {}, "light");
const power = forecast("genie-one", {}, "power");
assert.ok(power.rows[0].genieGrossDbu / light.rows[0].genieGrossDbu > 5,
  "Power mix must be much wider than a 1.5× high scenario");

const discounted = forecast("genie-code", {
  ...WORKLOADS["genie-code"].defaults,
  discountRate: 20,
});
assert.ok(Math.abs(discounted.annualDiscountSavings / discounted.annualListCost - 0.2) < 1e-9);

const aibi = forecast("aibi");
assert.ok(aibi.rows[0].queries > 0);
assert.ok(aibi.rows[0].clusters >= 1);
assert.equal(aibi.config.sqlListPricePerDbu, 0.91);
assert.equal(aibi.config.pricingRegion, "azure-north-europe");
assert.equal(aibi.calibration.profile.label, "Medium");

const apps = forecast("apps");
assert.ok(Math.abs(apps.rows[0].appDbu - 364.8) < 1e-9);
assert.equal(apps.rows[0].sqlQueries, 12160);
assert.ok(Math.abs(apps.rows[0].sqlDbu - 97.28) < 1e-9);
assert.equal(apps.rows[0].lakebaseDbu, 0);
assert.equal(apps.config.sqlListPricePerDbu, 0.91);

const writebackApp = forecast("apps", {
  ...WORKLOADS.apps.defaults,
  activeUsers: 200,
  requestsPerUserDay: 20,
  queriesPerRequest: 4,
  queryComplexity: "heavy",
  dataScannedGbPerQuery: 20,
  lakebaseEnabled: "yes",
  lakebaseDbuMonth: 1000,
});
assert.ok(writebackApp.rows[0].sqlDbu > apps.rows[0].sqlDbu);
assert.equal(writebackApp.rows[0].lakebaseDbu, 1000);

const observation = {
  label: "dqx-studio-v2", queries: 100000, dbu_per_1k: 49.5,
  p10_dbu_per_1k: 14.3, p90_dbu_per_1k: 102.2,
};
const calibratedApp = forecast("apps", { ...WORKLOADS.apps.defaults, calibration: observation });
const expectedWeight = 100000 / 105000;
assert.ok(Math.abs(calibratedApp.calibration.weight - expectedWeight) < 1e-9);
assert.ok(Math.abs(calibratedApp.calibration.rate - (expectedWeight * 49.5 + (1 - expectedWeight) * 8)) < 1e-9);
assert.ok(calibratedApp.annualCostRange.low < calibratedApp.annualCost);
assert.ok(calibratedApp.annualCostRange.high > calibratedApp.annualCost);
assert.equal(apps.annualCostRange, null, "Uncalibrated forecasts have no observed band");

const thinEvidence = forecast("aibi", {
  ...WORKLOADS.aibi.defaults,
  calibration: { label: "pilot", queries: 50, dbu_per_1k: 219, p10_dbu_per_1k: 60, p90_dbu_per_1k: 400 },
});
assert.ok(thinEvidence.calibration.weight < 0.01, "Small samples barely move the preset");
assert.ok(thinEvidence.calibration.rate < 45);

const lakehouse = forecast("lakehouse");
assert.ok(lakehouse.rows[11].storageTb > lakehouse.rows[0].storageTb);
assert.ok(lakehouse.rows[11].totalDbu > lakehouse.rows[0].totalDbu);

for (const workloadId of ["genie-one", "genie-agents", "genie-code", "genie-api", "aibi", "apps"]) {
  const example = forecast(workloadId);
  assert.ok(example.config.valueExample, `${workloadId} ships with labelled example values`);
  assert.ok(example.value.hasInputs && example.value.economic > 0, `${workloadId} example shows numbers`);
}

const valueCase = forecast("genie-one", {
  ...WORKLOADS["genie-one"].defaults,
  implementationCostEur: 0,
  minutesSavedPerUserDay: 30,
  affectedUsers: 100,
  fullyLoadedHourlyEur: 55,
  workingDaysYear: 220,
  productivityRecapture: 50,
  teiBenefitRisk: 15,
  timeCaptureMode: "reinvested",
  hardLicenseSavingsEur: 80000,
  avoidedLicenseEur: 70000,
  incrementalRevenueEur: 250000,
  contributionMargin: 40,
  revenueRisk: 20,
  fxUsdToEur: 1,
});
assert.equal(valueCase.value.theoreticalHours, 11000);
assert.ok(Math.abs(valueCase.value.theoreticalValue - 605000) < 1e-6);
assert.ok(valueCase.value.theoreticalValue !== valueCase.value.productivityValue,
  "Hours × wage must not equal booked productivity");
assert.ok(valueCase.value.productivityValue < valueCase.value.theoreticalValue * 0.5);
assert.ok(Math.abs(valueCase.value.hardSavings - 80000) < 1e-6);
assert.ok(Math.abs(valueCase.value.costAvoidance - 70000) < 1e-6);
assert.ok(Math.abs(valueCase.value.revenueContribution - 80000) < 1e-6);
assert.ok(valueCase.value.lines.some((line) => line.excludedFromTotal && line.id === "theoretical"));
assert.ok(valueCase.value.cashLike < valueCase.value.economic);
assert.ok(valueCase.value.economic > 0 && valueCase.value.platformCost >= 0);

const hiringSplit = forecast("apps", {
  ...WORKLOADS.apps.defaults,
  incidentsPerYear: 0,
  minutesSavedPerUserDay: 30,
  affectedUsers: 10,
  fullyLoadedHourlyEur: 50,
  workingDaysYear: 200,
  hoursPerDay: 8,
  productivityRecapture: 50,
  teiBenefitRisk: 0,
  timeCaptureMode: "mixed",
  avoidedHiringShare: 40,
  fxUsdToEur: 1,
});
const hours = 10 * 0.5 * 200;
const captured = hours * 0.5;
assert.ok(Math.abs(hiringSplit.value.costAvoidance - captured * 0.4 * 50) < 1e-6);
assert.ok(Math.abs(hiringSplit.value.productivityValue - captured * 0.6 * 50) < 1e-6);

console.log("Portfolio model tests passed");
