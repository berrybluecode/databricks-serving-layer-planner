(function (root) {
  "use strict";

  const DAYS_PER_MONTH = 30.4;
  const MONTH_NAMES = [
    "Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6",
    "Month 7", "Month 8", "Month 9", "Month 10", "Month 11", "Month 12",
  ];
  const COMPLEXITY_PROFILES = {
    light: { label: "Light", dbuPer1000Queries: 8, referenceGbPerQuery: 0.1 },
    medium: { label: "Medium", dbuPer1000Queries: 40, referenceGbPerQuery: 2 },
    heavy: { label: "Heavy", dbuPer1000Queries: 180, referenceGbPerQuery: 20 },
    extreme: { label: "Extreme", dbuPer1000Queries: 702, referenceGbPerQuery: 100 },
  };
  const DEFAULT_SQL_PRICE = 0.91;
  const DEFAULT_GENIE_PRICE = 0.084;
  const GENIE_FREE_DBU_PER_USER = 150;
  const NON_ENGLISH_MULTIPLIER = 2.9;
  const PROMO_METERING = 0.75;
  const USER_TIER_MULTIPLIERS = { light: 0.3, regular: 1, power: 12 };
  const USER_MIX = {
    light: { light: 0.80, regular: 0.18, power: 0.02 },
    regular: { light: 0.55, regular: 0.35, power: 0.10 },
    power: { light: 0.20, regular: 0.40, power: 0.40 },
  };
  const PRICING_REGIONS = {
    "azure-north-europe": {
      label: "Azure North Europe",
      sqlListPricePerDbu: DEFAULT_SQL_PRICE,
      genieListPricePerDbu: DEFAULT_GENIE_PRICE,
      genieSku: "ENTERPRISE_SERVERLESS_REAL_TIME_INFERENCE (regional)",
      sqlSku: "Serverless SQL / SQL compute",
    },
    "aws-us-east-1": {
      label: "AWS US East (N. Virginia)",
      sqlListPricePerDbu: 0.70,
      genieListPricePerDbu: 0.07,
      genieSku: "ENTERPRISE_SERVERLESS_REAL_TIME_INFERENCE_US_EAST_N_VIRGINIA",
      sqlSku: "Serverless SQL / SQL compute",
    },
    "azure-germany-west-central": {
      label: "Azure Germany West Central / Frankfurt class",
      sqlListPricePerDbu: DEFAULT_SQL_PRICE,
      genieListPricePerDbu: 0.084,
      genieSku: "ENTERPRISE_SERVERLESS_REAL_TIME_INFERENCE (Frankfurt class)",
      sqlSku: "Serverless SQL / SQL compute",
    },
  };

  const WORKLOADS = {
    "genie-one": {
      family: "genie",
      label: "Genie One",
      description: "Natural-language analytics for business users",
      genieSurface: "GENIE_ONE",
      defaults: {
        activeUsers: 100, promptsPerUserMonth: 20, promptsPerConversation: 5,
        inputTokens: 2500, outputTokens: 600, agentShare: 0, agentTurns: 1,
        surfaceMultiplier: 1, contextGrowth: 5, contextCap: 3,
        monthlyGrowth: 5, queriesPerPrompt: 1, sqlDbuPer1000Queries: 0,
        dbuPerUserMonth: 40, nonEnglishShare: 0, pricingHorizon: "promo",
        sqlListPricePerDbu: DEFAULT_SQL_PRICE, genieListPricePerDbu: DEFAULT_GENIE_PRICE,
        listPricePerDbu: DEFAULT_SQL_PRICE, discountRate: 0,
        pricingRegion: "azure-north-europe",
      },
    },
    "genie-agents": {
      family: "genie",
      label: "Genie Agents",
      description: "Chat and multi-step agent workloads",
      genieSurface: "GENIE_AGENTS",
      defaults: {
        activeUsers: 60, promptsPerUserMonth: 18, promptsPerConversation: 6,
        inputTokens: 3500, outputTokens: 900, agentShare: 60, agentTurns: 4,
        surfaceMultiplier: 1.1, contextGrowth: 5, contextCap: 3,
        monthlyGrowth: 6, queriesPerPrompt: 1.5, sqlDbuPer1000Queries: 0,
        dbuPerUserMonth: 90, nonEnglishShare: 0, pricingHorizon: "promo",
        sqlListPricePerDbu: DEFAULT_SQL_PRICE, genieListPricePerDbu: DEFAULT_GENIE_PRICE,
        listPricePerDbu: DEFAULT_SQL_PRICE, discountRate: 0,
        pricingRegion: "azure-north-europe",
      },
    },
    "genie-code": {
      family: "genie",
      label: "Genie Code",
      description: "Agentic development and data work",
      genieSurface: "GENIE_CODE",
      defaults: {
        activeUsers: 50, promptsPerUserMonth: 40, promptsPerConversation: 10,
        inputTokens: 6000, outputTokens: 1500, agentShare: 80, agentTurns: 5,
        surfaceMultiplier: 1.5, contextGrowth: 7, contextCap: 4,
        monthlyGrowth: 6, queriesPerPrompt: 0.5, sqlDbuPer1000Queries: 0,
        dbuPerUserMonth: 180, nonEnglishShare: 0, pricingHorizon: "promo",
        sqlListPricePerDbu: DEFAULT_SQL_PRICE, genieListPricePerDbu: DEFAULT_GENIE_PRICE,
        listPricePerDbu: DEFAULT_SQL_PRICE, discountRate: 0,
        pricingRegion: "azure-north-europe",
      },
    },
    "genie-api": {
      family: "genie",
      label: "Genie API",
      description: "Programmatic Genie Agent traffic",
      genieSurface: "GENIE_AGENTS",
      defaults: {
        requestsPerDay: 1000, activeDays: 30.4, promptsPerConversation: 4,
        inputTokens: 3000, outputTokens: 800, agentShare: 40, agentTurns: 4,
        surfaceMultiplier: 1, contextGrowth: 5, contextCap: 3,
        monthlyGrowth: 8, peakFactor: 4, activeHours: 12,
        queriesPerPrompt: 1.2, sqlDbuPer1000Queries: 0,
        dbuPerThousandRequests: 8, nonEnglishShare: 0, pricingHorizon: "promo",
        sqlListPricePerDbu: DEFAULT_SQL_PRICE, genieListPricePerDbu: DEFAULT_GENIE_PRICE,
        listPricePerDbu: DEFAULT_SQL_PRICE, discountRate: 0,
        pricingRegion: "azure-north-europe",
      },
    },
    aibi: {
      family: "aibi",
      label: "AI/BI",
      description: "Interactive dashboards and scheduled refreshes",
      defaults: {
        viewers: 500, sessionsPerDay: 1.5, queriesPerSession: 5,
        activeDays: 22, refreshQueriesMonth: 3000,
        activeHours: 10, peakFactor: 4, p95RuntimeSeconds: 8,
        headroom: 25, queryComplexity: "medium", dataScannedGbPerQuery: 2,
        sqlListPricePerDbu: DEFAULT_SQL_PRICE, listPricePerDbu: DEFAULT_SQL_PRICE,
        discountRate: 0, initialStorageTb: 1, storageGrowth: 3, storagePriceTb: 0,
        monthlyGrowth: 5, pricingRegion: "azure-north-europe",
      },
    },
    apps: {
      family: "apps",
      label: "Databricks Apps",
      description: "App runtime plus AI and SQL dependencies",
      defaults: {
        appSize: "medium", replicas: 1, runtimeHoursDay: 24, activeDays: 30.4,
        activeUsers: 5, requestsPerUserDay: 20, queriesPerRequest: 4,
        queryComplexity: "light", dataScannedGbPerQuery: 0.1,
        aiEnabled: "no", aiRequestsDay: 0, inputTokens: 2000, outputTokens: 500,
        inputPriceMillion: 0, outputPriceMillion: 0,
        lakebaseEnabled: "no", lakebaseDbuMonth: 0, lakebaseStorageCostMonth: 0,
        sqlListPricePerDbu: DEFAULT_SQL_PRICE, listPricePerDbu: DEFAULT_SQL_PRICE,
        discountRate: 0, monthlyGrowth: 5,
        pricingRegion: "azure-north-europe",
      },
    },
    lakehouse: {
      family: "lakehouse",
      label: "Lakehouse",
      description: "Ingestion, compute, retention, and physical storage",
      hidden: true,
      defaults: {
        ingestionGbDay: 500, initialStorageTb: 10, compressionFactor: 35,
        layerAmplification: 1.8, retentionDays: 365, copyMultiplier: 1,
        dailyRewrite: 0.5, deletedRetentionDays: 7, metadataOverhead: 2,
        computeDbuMonth: 2000, computeBaselineGbDay: 500, monthlyGrowth: 4,
        sqlListPricePerDbu: DEFAULT_SQL_PRICE, listPricePerDbu: DEFAULT_SQL_PRICE,
        discountRate: 0, storagePriceTb: 0,
        pricingRegion: "azure-north-europe",
      },
    },
  };

  const VALUE_DEFAULTS = {
    businessUnit: "",
    useCaseName: "",
    affectedUsers: 0,
    minutesSavedPerUserDay: 0,
    workingDaysYear: 220,
    hoursPerDay: 8,
    fullyLoadedHourlyEur: 55,
    productivityRecapture: 50,
    teiBenefitRisk: 15,
    timeCaptureMode: "reinvested",
    avoidedHiringShare: 0,
    overtimeHoursMonth: 0,
    overtimePremium: 1.5,
    hardLicenseSavingsEur: 0,
    hardConsultingSavingsEur: 0,
    hardFteReductionEur: 0,
    avoidedLicenseEur: 0,
    incrementalRevenueEur: 0,
    contributionMargin: 40,
    revenueRisk: 20,
    decisionsPerYear: 0,
    valuePerFasterDecisionEur: 0,
    incidentsPerYear: 0,
    incidentImpactEur: 0,
    incidentProbabilityReduction: 0,
    riskRealization: 50,
    implementationCostEur: 0,
    fxUsdToEur: 0.92,
    npvDiscountRate: 10,
    extraBudgetEur: 0,
    diminishingReturn: 80,
  };

  const VALUE_EXAMPLE_VERSION = 1;
  const VALUE_EXAMPLES = {
    "genie-one": {
      businessUnit: "Finance", useCaseName: "Self-service margin analysis",
      minutesSavedPerUserDay: 20, avoidedLicenseEur: 16800, implementationCostEur: 15000,
    },
    "genie-agents": {
      businessUnit: "Sales", useCaseName: "Account planning agent",
      minutesSavedPerUserDay: 25, incrementalRevenueEur: 300000, contributionMargin: 40,
      revenueRisk: 30, implementationCostEur: 25000,
    },
    "genie-code": {
      businessUnit: "Data & Analytics", useCaseName: "Pipeline development with Genie Code",
      minutesSavedPerUserDay: 45, timeCaptureMode: "mixed", avoidedHiringShare: 30,
      hardConsultingSavingsEur: 40000, implementationCostEur: 10000,
    },
    "genie-api": {
      businessUnit: "Customer service", useCaseName: "Order-status assistant",
      affectedUsers: 40, minutesSavedPerUserDay: 15, overtimeHoursMonth: 60,
      implementationCostEur: 20000,
    },
    aibi: {
      businessUnit: "Merchandising", useCaseName: "Sell-through dashboard",
      affectedUsers: 120, minutesSavedPerUserDay: 10, hardLicenseSavingsEur: 25000,
      decisionsPerYear: 52, valuePerFasterDecisionEur: 2000, implementationCostEur: 12000,
    },
    apps: {
      businessUnit: "Data governance", useCaseName: "DQX data-quality app",
      affectedUsers: 5, minutesSavedPerUserDay: 60, incidentsPerYear: 12,
      incidentImpactEur: 15000, incidentProbabilityReduction: 40, riskRealization: 50,
      implementationCostEur: 20000,
    },
  };

  Object.values(VALUE_EXAMPLES).forEach((example) => {
    example.extraBudgetEur = 25000;
  });

  Object.entries(WORKLOADS).forEach(([id, workload]) => {
    workload.defaults = {
      ...VALUE_DEFAULTS,
      ...workload.defaults,
      ...(VALUE_EXAMPLES[id] || {}),
      valueExample: Boolean(VALUE_EXAMPLES[id]),
      valueExampleVersion: VALUE_EXAMPLE_VERSION,
    };
  });

  const SCENARIO_MULTIPLIERS = {
    low: 0.7, base: 1, high: 1.5,
    light: 0.7, regular: 1, power: 1.5,
  };

  function n(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function grow(base, monthlyPercent, monthIndex) {
    return base * Math.pow(1 + n(monthlyPercent) / 100, monthIndex);
  }

  function sum(rows, key) {
    return rows.reduce((total, row) => total + n(row[key]), 0);
  }

  function mixFactor(scenario) {
    const mix = USER_MIX[scenario] || USER_MIX.regular;
    return Object.entries(mix).reduce(
      (total, [tier, share]) => total + share * USER_TIER_MULTIPLIERS[tier],
      0
    );
  }

  function languageFactor(config) {
    const share = Math.min(100, Math.max(0, n(config.nonEnglishShare))) / 100;
    const multiplier = n(config.nonEnglishMultiplier, NON_ENGLISH_MULTIPLIER);
    return 1 + share * (multiplier - 1);
  }

  function sqlPrice(config) {
    return n(config.sqlListPricePerDbu, n(config.listPricePerDbu, DEFAULT_SQL_PRICE));
  }

  function geniePrice(config) {
    return n(config.genieListPricePerDbu, DEFAULT_GENIE_PRICE);
  }

  function applyDiscount(listCost, config) {
    const discountRate = Math.min(100, Math.max(0, n(config.discountRate))) / 100;
    const discountSavings = listCost * discountRate;
    return { listCost, discountSavings, cost: listCost - discountSavings };
  }

  function discountedCost(config, totalDbu, otherListCost = 0) {
    return applyDiscount(totalDbu * sqlPrice(config) + otherListCost, config);
  }

  function splitSkuCost(config, genieBilledDbu, sqlDbu, otherListCost = 0) {
    return applyDiscount(
      n(genieBilledDbu) * geniePrice(config) + n(sqlDbu) * sqlPrice(config) + otherListCost,
      config
    );
  }

  const DEFAULT_CREDIBILITY_K = 5000;
  const BAND_FIELDS = { p10: "p10_dbu_per_1k", p90: "p90_dbu_per_1k" };

  function blendRate(presetRate, config) {
    const observation = config.calibration;
    const observedQueries = observation ? n(observation.queries) : 0;
    if (!observedQueries) {
      return { presetRate, observedRate: null, weight: 0, rate: presetRate, observation: null };
    }
    const k = Math.max(1, n(config.credibilityK, DEFAULT_CREDIBILITY_K));
    const weight = observedQueries / (observedQueries + k);
    const field = BAND_FIELDS[config.calibrationBand] || "dbu_per_1k";
    const observedRate = n(observation[field], n(observation.dbu_per_1k));
    return {
      presetRate,
      observedRate,
      weight,
      rate: weight * observedRate + (1 - weight) * presetRate,
      observation,
    };
  }

  function blendUserRate(presetRate, config) {
    const observation = config.calibration;
    const users = observation ? n(observation.users) : 0;
    if (!users || !n(observation.dbu_per_user_month)) {
      return { presetRate, observedRate: null, weight: 0, rate: presetRate, observation: observation || null };
    }
    const k = Math.max(1, n(config.userCredibilityK, 20));
    const weight = users / (users + k);
    const bandField = config.calibrationBand === "p90" ? "p90_dbu_per_user_month"
      : config.calibrationBand === "p10" ? "p10_dbu_per_user_month"
      : "dbu_per_user_month";
    const observedRate = n(observation[bandField], n(observation.dbu_per_user_month));
    return {
      presetRate,
      observedRate,
      weight,
      rate: weight * observedRate + (1 - weight) * presetRate,
      observation,
    };
  }

  function complexityRate(config) {
    const profile = COMPLEXITY_PROFILES[config.queryComplexity] || COMPLEXITY_PROFILES.medium;
    const scannedGb = Math.max(0.001, n(config.dataScannedGbPerQuery, profile.referenceGbPerQuery));
    const volumeFactor = Math.max(0.25, Math.sqrt(scannedGb / profile.referenceGbPerQuery));
    const blend = blendRate(profile.dbuPer1000Queries * volumeFactor, config);
    return {
      profile,
      volumeFactor,
      ...blend,
      effectiveDbuPer1000Queries: blend.rate,
    };
  }

  function rateLabel(complexity) {
    return complexity.observation
      ? `Calibrated SQL rate (${formatNumber(complexity.weight * 100, 0)}% observed)`
      : `${complexity.profile.label} SQL profile`;
  }

  function isPromo(config) {
    return config.pricingHorizon !== "post-promo";
  }

  function humanGenieFree(workloadId, config) {
    if (config.requestsPerDay) return false;
    if (workloadId === "genie-code") return false;
    return isPromo(config);
  }

  function billedGenieDbu(grossDbu, users, workloadId, config) {
    if (config.requestsPerDay) {
      return isPromo(config) ? grossDbu * PROMO_METERING : grossDbu;
    }
    if (humanGenieFree(workloadId, config)) return 0;
    const afterAllowance = Math.max(0, grossDbu - n(users) * GENIE_FREE_DBU_PER_USER);
    return isPromo(config) ? afterAllowance * PROMO_METERING : afterAllowance;
  }

  function genieForecast(config, scenario, workloadId) {
    const intensity = config.requestsPerDay
      ? (SCENARIO_MULTIPLIERS[scenario] || 1)
      : mixFactor(scenario);
    const lang = languageFactor(config);
    const presetSqlRate = n(config.sqlDbuPer1000Queries) ||
      (config.calibration ? COMPLEXITY_PROFILES.medium.dbuPer1000Queries : 0);
    const sqlRate = blendRate(presetSqlRate, config);
    const userRate = blendUserRate(n(config.dbuPerUserMonth), config);
    const requestRate = n(config.dbuPerThousandRequests);
    const rows = MONTH_NAMES.map((month, index) => {
      const users = config.requestsPerDay
        ? 0
        : grow(n(config.activeUsers), config.monthlyGrowth, index);
      const promptsBase = config.requestsPerDay
        ? n(config.requestsPerDay) * n(config.activeDays, DAYS_PER_MONTH) * intensity
        : n(config.activeUsers) * n(config.promptsPerUserMonth) * intensity;
      const prompts = grow(promptsBase, config.monthlyGrowth, index);
      const averagePriorMessages = Math.max(0, n(config.promptsPerConversation, 1) - 1) / 2;
      const contextFactor = Math.min(
        n(config.contextCap, 3),
        1 + (n(config.contextGrowth) / 100) * averagePriorMessages
      );
      const modeTurns =
        (1 - n(config.agentShare) / 100) +
        (n(config.agentShare) / 100) * n(config.agentTurns, 1);
      const weightedTokens =
        prompts *
        (n(config.inputTokens) * contextFactor + n(config.outputTokens)) *
        modeTurns *
        n(config.surfaceMultiplier, 1) *
        lang;
      const genieGrossDbu = config.requestsPerDay
        ? (prompts / 1000) * requestRate * lang
        : users * intensity * userRate.rate * lang;
      const genieBilledDbu = billedGenieDbu(genieGrossDbu, users, workloadId, config);
      const genieFreeDbu = Math.max(0, genieGrossDbu - genieBilledDbu);
      const sqlQueries = prompts * n(config.queriesPerPrompt);
      const sqlDbu = (sqlQueries / 1000) * sqlRate.rate;
      const totalDbu = genieBilledDbu + sqlDbu;
      const shadowListCost = genieGrossDbu * geniePrice(config) + sqlDbu * sqlPrice(config);
      const { listCost, discountSavings, cost } = splitSkuCost(config, genieBilledDbu, sqlDbu);
      const peakRpm = config.requestsPerDay
        ? ((prompts / n(config.activeDays, DAYS_PER_MONTH)) * n(config.peakFactor, 1)) /
          (n(config.activeHours, 24) * 60)
        : 0;
      return {
        month, prompts, users, weightedTokens,
        genieGrossDbu, genieFreeDbu, genieBilledDbu, sqlDbu, totalDbu,
        storageTb: 0, listCost, discountSavings, cost, shadowListCost, peakRpm,
        primary: genieGrossDbu,
      };
    });
    const billed = sum(rows, "genieBilledDbu");
    return {
      rows,
      primaryLabel: "Gross Genie DBUs",
      summary: [
        { label: "12-month gross Genie DBUs", value: formatCompact(sum(rows, "genieGrossDbu")) },
        { label: "12-month billed Genie DBUs", value: formatCompact(billed) },
        { label: "12-month SQL DBUs", value: formatCompact(sum(rows, "sqlDbu")) },
        {
          label: config.requestsPerDay ? "Peak API rate" : "Effective median-user mix",
          value: config.requestsPerDay
            ? `${formatNumber(rows[11].peakRpm, 1)} RPM`
            : `${formatNumber(intensity, 2)}×`,
        },
      ],
      guidance: config.requestsPerDay
        ? "Genie API is billed on the serverless real-time inference SKU and does not receive the human 150 DBU allowance. Calibrate DBUs per 1,000 requests from GENIE billing rows."
        : "Calibrate Genie from observed DBUs per active user per month by surface. SQL warehouse cost stays on the SQL SKU. Light/regular/power mixes span far more than a 0.7–1.5 band because p90 users here run 8–15× the median.",
      caveat:
        "Genie bills on the serverless real-time inference SKU, not SQL warehouse list price. GENIE_FREE_USAGE has no list price. Token counts are not on Genie billing rows, so this model no longer converts tokens to DBUs.",
      calibration: { ...sqlRate, userRate, mix: intensity, languageFactor: lang },
    };
  }

  function aibiForecast(config, scenarioMultiplier) {
    const complexity = complexityRate(config);
    const rows = MONTH_NAMES.map((month, index) => {
      const interactiveBase =
        n(config.viewers) *
        n(config.sessionsPerDay) *
        n(config.queriesPerSession) *
        n(config.activeDays);
      const queries =
        grow((interactiveBase + n(config.refreshQueriesMonth)) * scenarioMultiplier, config.monthlyGrowth, index);
      const averageQps = queries / (n(config.activeDays) * n(config.activeHours) * 3600);
      const peakQps = averageQps * n(config.peakFactor, 1);
      const concurrentQueries = peakQps * n(config.p95RuntimeSeconds);
      const clusters = concurrentQueries
        ? Math.max(1, Math.ceil((concurrentQueries / 10) * (1 + n(config.headroom) / 100)))
        : 0;
      const totalDbu = (queries / 1000) * complexity.effectiveDbuPer1000Queries;
      const storageTb = grow(n(config.initialStorageTb), config.storageGrowth, index);
      const storageListCost = storageTb * n(config.storagePriceTb);
      const { listCost, discountSavings, cost } = discountedCost(
        config,
        totalDbu,
        storageListCost
      );
      return {
        month, queries, peakQps, concurrentQueries, clusters, totalDbu,
        storageTb, listCost, discountSavings, cost, primary: queries / 1000,
      };
    });
    return {
      rows,
      primaryLabel: "SQL queries (K)",
      summary: [
        { label: "12-month SQL queries", value: formatCompact(sum(rows, "queries")) },
        { label: "Month 12 peak concurrency", value: formatNumber(rows[11].concurrentQueries, 1) },
        { label: rateLabel(complexity), value: `${formatNumber(complexity.effectiveDbuPer1000Queries, 1)} DBU / 1K` },
        {
          label: "Estimated SQL DBUs",
          value: formatCompact(sum(rows, "totalDbu")),
        },
      ],
      guidance: complexity.observation
        ? `Start with a Medium serverless SQL warehouse. The SQL rate blends ${formatNumber(complexity.observedRate, 1)} DBU / 1K observed on ${complexity.observation.label} with the ${formatNumber(complexity.presetRate, 1)} DBU / 1K ${complexity.profile.label} preset.`
        : `Ask for executed query volume, query complexity, and concurrency. Caching (browser, result cache, serverless 24h results cache) is already inside an observed DBU/query rate — do not ask customers for cache-miss share.`,
      caveat:
        "Complexity presets are planning benchmarks, not SKU guarantees. One large warehouse vs many small ones changes cache reuse even at the same query load. Recalibrate from system.query.history.",
      calibration: complexity,
    };
  }

  function appsForecast(config, scenarioMultiplier) {
    const appRate = config.appSize === "large" ? 1 : 0.5;
    const complexity = complexityRate(config);
    const rows = MONTH_NAMES.map((month, index) => {
      const demandGrowth = Math.pow(1 + n(config.monthlyGrowth) / 100, index);
      const appDbu =
        n(config.replicas) * n(config.runtimeHoursDay) * n(config.activeDays) * appRate;
      const appRequests =
        n(config.activeUsers) * n(config.requestsPerUserDay) * n(config.activeDays) *
        scenarioMultiplier * demandGrowth;
      const sqlQueries = appRequests * n(config.queriesPerRequest);
      const sqlDbu = (sqlQueries / 1000) * complexity.effectiveDbuPer1000Queries;
      const requests = config.aiEnabled === "yes"
        ? n(config.aiRequestsDay) * n(config.activeDays) * scenarioMultiplier * demandGrowth
        : 0;
      const inputTokens = requests * n(config.inputTokens);
      const outputTokens = requests * n(config.outputTokens);
      const tokenCost =
        (inputTokens / 1_000_000) * n(config.inputPriceMillion) +
        (outputTokens / 1_000_000) * n(config.outputPriceMillion);
      const lakebaseDbu = config.lakebaseEnabled === "yes"
        ? n(config.lakebaseDbuMonth) * scenarioMultiplier * demandGrowth
        : 0;
      const lakebaseStorageCost = config.lakebaseEnabled === "yes"
        ? n(config.lakebaseStorageCostMonth) * scenarioMultiplier * demandGrowth
        : 0;
      const totalDbu = appDbu + sqlDbu + lakebaseDbu;
      const { listCost, discountSavings, cost } = discountedCost(
        config,
        totalDbu,
        tokenCost + lakebaseStorageCost
      );
      return {
        month, appDbu, sqlDbu, lakebaseDbu, totalDbu, appRequests, sqlQueries,
        requests, inputTokens, outputTokens,
        storageTb: 0, listCost, discountSavings, cost,
        primary: appRequests,
      };
    });
    const cpu = (config.appSize === "large" ? 4 : 2) * n(config.replicas);
    const memory = (config.appSize === "large" ? 12 : 6) * n(config.replicas);
    return {
      rows,
      primaryLabel: "Application requests",
      summary: [
        { label: "12-month app DBUs", value: formatCompact(sum(rows, "appDbu")) },
        { label: "12-month SQL DBUs", value: formatCompact(sum(rows, "sqlDbu")) },
        { label: "12-month Lakebase DBUs", value: formatCompact(sum(rows, "lakebaseDbu")) },
        { label: rateLabel(complexity), value: `${formatNumber(complexity.effectiveDbuPer1000Queries, 1)} DBU / 1K` },
      ],
      guidance: complexity.observation
        ? `${formatNumber(cpu, 0)} vCPU and ${formatNumber(memory, 0)} GB are provisioned for the App. SQL blends ${formatNumber(complexity.observedRate, 1)} DBU / 1K observed on ${complexity.observation.label} with the ${formatNumber(complexity.presetRate, 1)} DBU / 1K ${complexity.profile.label} preset${n(complexity.observation.app_dbu_per_day) ? `; that app's runtime billed ${formatNumber(complexity.observation.app_dbu_per_day, 1)} DBU / day` : ""}.`
        : `${formatNumber(cpu, 0)} vCPU and ${formatNumber(memory, 0)} GB are provisioned for the App. SQL is estimated from users × requests × queries using the ${complexity.profile.label} profile; Lakebase and AI are included only when enabled.`,
      caveat:
        "Medium Apps use 0.5 DBU per running instance-hour; Large uses 1 DBU. Query-complexity presets must be calibrated against system.query.history and system.billing.usage, especially when a warehouse is shared with ETL.",
      calibration: complexity,
    };
  }

  function lakehouseForecast(config, scenarioMultiplier) {
    const retainedMonthly = [];
    const retentionMonths = Math.max(1, n(config.retentionDays, 365) / DAYS_PER_MONTH);
    const rows = MONTH_NAMES.map((month, index) => {
      const rawTb =
        grow(
          (n(config.ingestionGbDay) * DAYS_PER_MONTH) / 1024 * scenarioMultiplier,
          config.monthlyGrowth,
          index
        );
      const newStoredTb =
        rawTb * (n(config.compressionFactor) / 100) * n(config.layerAmplification, 1);
      retainedMonthly.push(newStoredTb);
      const firstRetained = Math.max(0, Math.ceil(retainedMonthly.length - retentionMonths));
      const activeNewTb = retainedMonthly
        .slice(firstRetained)
        .reduce((total, value) => total + value, 0);
      const activeTb = n(config.initialStorageTb) + activeNewTb;
      const timeTravelTb =
        activeTb * (n(config.dailyRewrite) / 100) * n(config.deletedRetentionDays, 7);
      const storageTb =
        (activeTb * n(config.copyMultiplier, 1) + timeTravelTb) *
        (1 + n(config.metadataOverhead) / 100);
      const ingestionComputeFactor =
        n(config.ingestionGbDay) / Math.max(1, n(config.computeBaselineGbDay, 500));
      const totalDbu = grow(
        n(config.computeDbuMonth) * ingestionComputeFactor * scenarioMultiplier,
        config.monthlyGrowth,
        index
      );
      const storageListCost = storageTb * n(config.storagePriceTb);
      const { listCost, discountSavings, cost } = discountedCost(
        config,
        totalDbu,
        storageListCost
      );
      return {
        month, rawTb, newStoredTb, activeTb, timeTravelTb, storageTb,
        totalDbu, listCost, discountSavings, cost, primary: storageTb,
      };
    });
    return {
      rows,
      primaryLabel: "Physical storage (TB)",
      summary: [
        { label: "12-month raw ingestion", value: `${formatCompact(sum(rows, "rawTb"))} TB` },
        { label: "Month 12 physical storage", value: `${formatNumber(rows[11].storageTb, 1)} TB` },
        { label: "12-month compute DBUs", value: formatCompact(sum(rows, "totalDbu")) },
        { label: "Month 12 time travel", value: `${formatNumber(rows[11].timeTravelTb, 1)} TB` },
      ],
      guidance:
        "Review active, time-travel, and vacuumable bytes with ANALYZE TABLE COMPUTE STORAGE METRICS. Replace heuristics with measured compression and rewrite rates.",
      caveat:
        "Storage includes compressed new data, medallion-layer amplification, retained data, copy multiplier, time-travel files, and metadata overhead.",
    };
  }

  function affectedUserCount(config) {
    return n(config.affectedUsers) || n(config.activeUsers) || n(config.viewers) || 0;
  }

  function clampPct(value, fallback = 0) {
    return Math.min(100, Math.max(0, n(value, fallback))) / 100;
  }

  function npv(rate, cashflows) {
    return cashflows.reduce((total, flow, index) => total + flow / Math.pow(1 + rate, index + 1), 0);
  }

  function irr(cashflows) {
    let rate = 0.12;
    for (let i = 0; i < 40; i += 1) {
      const value = cashflows.reduce((total, flow, index) => total + flow / Math.pow(1 + rate, index), 0);
      const deriv = cashflows.reduce((total, flow, index) => (
        index === 0 ? total : total - (index * flow) / Math.pow(1 + rate, index + 1)
      ), 0);
      if (Math.abs(deriv) < 1e-9) break;
      const next = rate - value / deriv;
      if (!Number.isFinite(next) || next < -0.9) return null;
      if (Math.abs(next - rate) < 1e-6) return next;
      rate = next;
    }
    return Number.isFinite(rate) ? rate : null;
  }

  function quantifyBusinessValue(config, annualCostUsd) {
    const fx = Math.max(0.01, n(config.fxUsdToEur, VALUE_DEFAULTS.fxUsdToEur));
    const platformCost = n(annualCostUsd) * fx;
    const users = affectedUserCount(config);
    const hourly = n(config.fullyLoadedHourlyEur, VALUE_DEFAULTS.fullyLoadedHourlyEur);
    const days = n(config.workingDaysYear, VALUE_DEFAULTS.workingDaysYear);
    const hoursPerDay = n(config.hoursPerDay, VALUE_DEFAULTS.hoursPerDay);
    const productiveHoursYear = Math.max(1, days * hoursPerDay);
    const minutes = n(config.minutesSavedPerUserDay);
    const theoreticalHours = users * (minutes / 60) * days;
    const theoreticalValue = theoreticalHours * hourly;
    const recapture = clampPct(config.productivityRecapture, VALUE_DEFAULTS.productivityRecapture);
    const teiRisk = clampPct(config.teiBenefitRisk, VALUE_DEFAULTS.teiBenefitRisk);
    const fteReleased = theoreticalHours / productiveHoursYear;
    const capturedHours = theoreticalHours * recapture;
    const capturedFte = capturedHours / productiveHoursYear;
    const mode = config.timeCaptureMode || "reinvested";
    const hiringShare = mode === "avoided_hiring" ? 1
      : mode === "mixed" ? clampPct(config.avoidedHiringShare) : 0;
    const hiringHours = capturedHours * hiringShare;
    const reinvestedHours = capturedHours - hiringHours;

    const overtime = n(config.overtimeHoursMonth) * 12 * hourly * n(config.overtimePremium, 1.5);
    const hardSavings = n(config.hardLicenseSavingsEur) + n(config.hardConsultingSavingsEur)
      + n(config.hardFteReductionEur) + overtime;
    const avoidedHiring = hiringHours * hourly;
    const costAvoidance = n(config.avoidedLicenseEur) + avoidedHiring;
    const productivityValue = reinvestedHours * hourly * (1 - teiRisk);
    const revenueContribution = n(config.incrementalRevenueEur)
      * clampPct(config.contributionMargin, VALUE_DEFAULTS.contributionMargin)
      * (1 - clampPct(config.revenueRisk, VALUE_DEFAULTS.revenueRisk));
    const decisionValue = n(config.decisionsPerYear) * n(config.valuePerFasterDecisionEur);
    const expectedLossReduction = n(config.incidentsPerYear) * n(config.incidentImpactEur)
      * clampPct(config.incidentProbabilityReduction)
      * clampPct(config.riskRealization, VALUE_DEFAULTS.riskRealization);
    const riskAdjustedValue = expectedLossReduction + decisionValue;

    const cashLike = hardSavings + costAvoidance;
    const economic = cashLike + productivityValue + revenueContribution + riskAdjustedValue;
    const implementation = n(config.implementationCostEur);
    const netCash = cashLike - platformCost;
    const netEconomic = economic - platformCost;
    const roiCash = platformCost > 0 ? netCash / platformCost : null;
    const roiEconomic = platformCost > 0 ? netEconomic / platformCost : null;
    const bcr = platformCost > 0 ? economic / platformCost : null;
    const monthlyNet = (economic - platformCost) / 12;
    const paybackMonths = monthlyNet > 0
      ? (implementation > 0 ? implementation / monthlyNet : 0)
      : null;

    const growth = Math.pow(1 + n(config.monthlyGrowth) / 100, 12) - 1;
    const year1 = economic - platformCost - implementation;
    const year2 = (economic * (1 + growth) - platformCost * (1 + growth));
    const year3 = (economic * Math.pow(1 + growth, 2) - platformCost * Math.pow(1 + growth, 2));
    const discount = clampPct(config.npvDiscountRate, VALUE_DEFAULTS.npvDiscountRate);
    const npv3 = npv(discount, [year1, year2, year3]);
    const irr3 = irr([-implementation, year1 + implementation, year2, year3]);
    const extra = n(config.extraBudgetEur);
    const fade = clampPct(config.diminishingReturn, VALUE_DEFAULTS.diminishingReturn);
    // Extra spend beyond today's run-rate cannot replicate more than one more copy of today's value.
    const extraScale = platformCost > 0 ? Math.min(extra / platformCost, 1) : 0;
    const expectedExtraValue = economic * extraScale * fade;

    const lines = [
      {
        id: "hard", category: "Hard savings", cash: true,
        metric: "Cash leaving the P&L this year",
        inputs: "Retired licenses, consulting, overtime, removed FTE cost",
        method: "Sum only amounts that already hit or will hit actual spend",
        value: hardSavings, confidence: 0.9, source: "Gartner: only process/team change becomes money",
      },
      {
        id: "avoidance", category: "Cost avoidance", cash: false,
        metric: "Spend you will not have to add",
        inputs: "Avoided BI licenses + captured hours taken as deferred hiring",
        method: "Hours × fully loaded rate × hiring share. Not a cost reduction unless a req is cancelled.",
        value: costAvoidance, confidence: 0.7,
        source: "Gartner GenAI value: do-more-with-same-headcount is avoidance, not savings",
      },
      {
        id: "theoretical", category: "Theoretical productivity", cash: false,
        metric: "Hours × hourly rate, unadjusted",
        inputs: `${users} users × ${minutes} min/day × ${days} days × €${hourly}/h`,
        method: "Do not take this to the board as ROI. Gartner: time saved is not money saved.",
        value: theoreticalValue, confidence: 0.25, excludedFromTotal: true,
      },
      {
        id: "productivity", category: "Productivity / capacity", cash: false,
        metric: "Recaptured hours after leakage and TEI risk",
        inputs: `${formatNumber(recapture * 100, 0)}% recapture · ${formatNumber(teiRisk * 100, 0)}% TEI risk · not used for hiring`,
        method: "Theoretical × recapture × (1 − risk) − hours already counted as avoided hiring",
        value: productivityValue, confidence: 0.5,
        source: "Forrester TEI standard recapture 50%; risk-adjust benefits 10–20%",
      },
      {
        id: "revenue", category: "Incremental revenue contribution", cash: false,
        metric: "Margin, not revenue",
        inputs: `Revenue lift × ${formatNumber(clampPct(config.contributionMargin, 40) * 100, 0)}% margin × (1 − revenue risk)`,
        method: "Never add gross revenue to cost savings. Count contribution margin only.",
        value: revenueContribution, confidence: 0.4,
        source: "Forrester TEI / standard managerial accounting",
      },
      {
        id: "risk", category: "Risk-adjusted value", cash: false,
        metric: "Expected-loss reduction + priced faster decisions",
        inputs: "ΔP × impact × realization, plus decisions × €/decision if priced",
        method: "Open FAIR / NIST-style expected loss. Unpriced cycle-time stays a leading indicator.",
        value: riskAdjustedValue, confidence: 0.35,
        source: "Open FAIR; Gartner leading-indicator vs financial-result split",
      },
    ];

    const weightedConfidence = economic > 0
      ? (hardSavings * 0.9 + costAvoidance * 0.7 + productivityValue * 0.5
        + revenueContribution * 0.4 + riskAdjustedValue * 0.35) / economic
      : 0;

    return {
      currency: "EUR",
      fxUsdToEur: fx,
      platformCost,
      platformCostUsd: n(annualCostUsd),
      users,
      theoreticalHours,
      theoreticalValue,
      fteReleased,
      capturedFte,
      recapture,
      teiRisk,
      hardSavings,
      costAvoidance,
      productivityValue,
      revenueContribution,
      riskAdjustedValue,
      decisionValue,
      cashLike,
      economic,
      implementation,
      netCash,
      netEconomic,
      roiCash,
      roiEconomic,
      bcr,
      paybackMonths,
      npv3,
      irr3,
      yearFlows: [year1, year2, year3],
      extraBudgetEur: extra,
      expectedExtraValue,
      diminishingReturn: fade,
      weightedConfidence,
      lines,
      hasInputs: theoreticalHours > 0 || cashLike > 0 || revenueContribution > 0
        || riskAdjustedValue > 0 || implementation > 0,
    };
  }

  function forecast(workloadId, rawConfig = {}, scenario = "regular") {
    const workload = WORKLOADS[workloadId] || WORKLOADS["genie-one"];
    const config = { ...workload.defaults, ...rawConfig };
    if (config.listPricePerDbu && !config.sqlListPricePerDbu) {
      config.sqlListPricePerDbu = config.listPricePerDbu;
    }
    const demandScenario = USER_MIX[scenario] ? scenario : (scenario === "high" ? "power" : scenario === "low" ? "light" : "regular");
    const multiplier = SCENARIO_MULTIPLIERS[scenario] || SCENARIO_MULTIPLIERS[demandScenario] || 1;
    let result;
    if (workload.family === "genie") result = genieForecast(config, demandScenario, workloadId);
    if (workload.family === "aibi") result = aibiForecast(config, multiplier);
    if (workload.family === "apps") result = appsForecast(config, multiplier);
    if (workload.family === "lakehouse") result = lakehouseForecast(config, multiplier);

    if (workload.family === "genie") {
      const messaging = {
        "genie-one": {
          guidance: "During the promo window, human Genie One usage is GENIE_FREE_USAGE (not billed). The headline net cost is SQL plus any service-principal traffic. Switch the horizon to post-promo to see billed Genie after 31 Jan 2027, still after the 150 DBU/user/month allowance.",
          caveat: "Without a grounded user mix and observed DBU/user/month, this is a guesstimate. Billing rows have no token counts; do not convert tokens to Genie DBUs.",
        },
        "genie-agents": {
          guidance: "Same commercial rules as Genie One for human users. Agent-mode intensity is captured in the observed DBU/user/month, not in a token formula.",
          caveat: "Service principals are billed. Conversation limits are operational, not purchasable capacity.",
        },
        "genie-code": {
          guidance: "Genie Code is billed above 150 DBU/user/month. In this workspace most Code DBUs were already paid; One/Agents were almost entirely free. Use the power-user mix for CEMEA developer teams.",
          caveat: "The 25% promotional discount is already in billed DBU metering. Applying list price to metered billed DBUs is correct; do not discount again unless using gross DBUs.",
        },
        "genie-api": {
          guidance: "Size peak request handling and calibrate DBUs per 1,000 API requests from billing. Service-principal usage does not receive the human free allowance.",
          caveat: "Genie API is a channel into Genie Agents, not a fourth billing surface.",
        },
      };
      Object.assign(result, messaging[workloadId]);
    }

    const annualListCost = sum(result.rows, "listCost");
    const annualDiscountSavings = sum(result.rows, "discountSavings");
    const annualCost = sum(result.rows, "cost");
    const annualDbu = sum(result.rows, "totalDbu");
    const annualShadowListCost = sum(result.rows, "shadowListCost");
    let annualCostRange = null;
    if (config.calibration && !config.calibrationBand) {
      const [low, high] = ["p10", "p90"].map(
        (band) => forecast(workloadId, { ...config, calibrationBand: band }, scenario).annualCost
      );
      annualCostRange = { low: Math.min(low, high), high: Math.max(low, high) };
    }
    return {
      ...result,
      workload,
      workloadId,
      config,
      scenario: demandScenario,
      annualCost,
      annualListCost,
      annualDiscountSavings,
      annualDbu,
      annualShadowListCost: annualShadowListCost || 0,
      annualCostRange,
      month12ListCost: result.rows[11].listCost,
      month12DiscountSavings: result.rows[11].discountSavings,
      month12Cost: result.rows[11].cost,
      hasPricing: annualListCost > 0 || annualShadowListCost > 0,
      value: quantifyBusinessValue(config, annualCost),
    };
  }

  function formatNumber(value, digits = 1) {
    return n(value).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatCompact(value) {
    return Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n(value));
  }

  root.PortfolioModel = {
    WORKLOADS,
    COMPLEXITY_PROFILES,
    PRICING_REGIONS,
    USER_MIX,
    USER_TIER_MULTIPLIERS,
    GENIE_FREE_DBU_PER_USER,
    NON_ENGLISH_MULTIPLIER,
    DEFAULT_SQL_PRICE,
    DEFAULT_GENIE_PRICE,
    DEFAULT_DBU_PRICE: DEFAULT_SQL_PRICE,
    DEFAULT_CREDIBILITY_K,
    VALUE_DEFAULTS,
    VALUE_EXAMPLES,
    VALUE_EXAMPLE_VERSION,
    SCENARIO_MULTIPLIERS,
    mixFactor,
    quantifyBusinessValue,
    forecast,
    formatNumber,
    formatCompact,
  };
})(typeof window === "undefined" ? globalThis : window);
