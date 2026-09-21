(function (root) {
  "use strict";

  const DAYS_PER_MONTH = 30.4;
  const MONTH_NAMES = [
    "Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6",
    "Month 7", "Month 8", "Month 9", "Month 10", "Month 11", "Month 12",
  ];

  const WORKLOADS = {
    "genie-one": {
      family: "genie",
      label: "Genie One",
      description: "Natural-language analytics for business users",
      defaults: {
        activeUsers: 100, promptsPerUserMonth: 20, promptsPerConversation: 5,
        inputTokens: 2500, outputTokens: 600, agentShare: 0, agentTurns: 1,
        surfaceMultiplier: 1, contextGrowth: 5, contextCap: 3,
        monthlyGrowth: 5, queriesPerPrompt: 1, sqlDbuPer1000Queries: 0,
        dbuPerMillionTokens: 0, listPricePerDbu: 0, discountRate: 0,
      },
    },
    "genie-agents": {
      family: "genie",
      label: "Genie Agents",
      description: "Chat and multi-step agent workloads",
      defaults: {
        activeUsers: 60, promptsPerUserMonth: 18, promptsPerConversation: 6,
        inputTokens: 3500, outputTokens: 900, agentShare: 60, agentTurns: 4,
        surfaceMultiplier: 1.1, contextGrowth: 5, contextCap: 3,
        monthlyGrowth: 6, queriesPerPrompt: 1.5, sqlDbuPer1000Queries: 0,
        dbuPerMillionTokens: 0, listPricePerDbu: 0, discountRate: 0,
      },
    },
    "genie-code": {
      family: "genie",
      label: "Genie Code",
      description: "Agentic development and data work",
      defaults: {
        activeUsers: 50, promptsPerUserMonth: 40, promptsPerConversation: 10,
        inputTokens: 6000, outputTokens: 1500, agentShare: 80, agentTurns: 5,
        surfaceMultiplier: 1.5, contextGrowth: 7, contextCap: 4,
        monthlyGrowth: 6, queriesPerPrompt: 0.5, sqlDbuPer1000Queries: 0,
        dbuPerMillionTokens: 0, listPricePerDbu: 0, discountRate: 0,
      },
    },
    "genie-api": {
      family: "genie",
      label: "Genie API",
      description: "Programmatic Genie Agent traffic",
      defaults: {
        requestsPerDay: 1000, activeDays: 30.4, promptsPerConversation: 4,
        inputTokens: 3000, outputTokens: 800, agentShare: 40, agentTurns: 4,
        surfaceMultiplier: 1, contextGrowth: 5, contextCap: 3,
        monthlyGrowth: 8, peakFactor: 4, activeHours: 12,
        queriesPerPrompt: 1.2, sqlDbuPer1000Queries: 0,
        dbuPerMillionTokens: 0, listPricePerDbu: 0, discountRate: 0,
      },
    },
    aibi: {
      family: "aibi",
      label: "AI/BI",
      description: "Interactive dashboards and scheduled refreshes",
      defaults: {
        viewers: 500, sessionsPerDay: 1.5, queriesPerSession: 5,
        activeDays: 22, cacheMiss: 35, refreshQueriesMonth: 3000,
        activeHours: 10, peakFactor: 4, p95RuntimeSeconds: 8,
        headroom: 25, dbuPer1000Queries: 0, listPricePerDbu: 0, discountRate: 0,
        initialStorageTb: 1, storageGrowth: 3, storagePriceTb: 0,
        monthlyGrowth: 5,
      },
    },
    apps: {
      family: "apps",
      label: "Databricks Apps",
      description: "App runtime plus AI and SQL dependencies",
      defaults: {
        appSize: "medium", replicas: 2, runtimeHoursDay: 24, activeDays: 30.4,
        aiRequestsDay: 500, inputTokens: 2000, outputTokens: 500,
        inputPriceMillion: 0, outputPriceMillion: 0,
        sqlDbuMonth: 0, listPricePerDbu: 0, discountRate: 0, monthlyGrowth: 5,
      },
    },
    lakehouse: {
      family: "lakehouse",
      label: "Lakehouse",
      description: "Ingestion, compute, retention, and physical storage",
      defaults: {
        ingestionGbDay: 500, initialStorageTb: 10, compressionFactor: 35,
        layerAmplification: 1.8, retentionDays: 365, copyMultiplier: 1,
        dailyRewrite: 0.5, deletedRetentionDays: 7, metadataOverhead: 2,
        computeDbuMonth: 2000, computeBaselineGbDay: 500, monthlyGrowth: 4,
        listPricePerDbu: 0, discountRate: 0, storagePriceTb: 0,
      },
    },
  };

  const SCENARIO_MULTIPLIERS = { low: 0.7, base: 1, high: 1.5 };

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

  function discountedCost(config, totalDbu, otherListCost = 0) {
    const listCost = totalDbu * n(config.listPricePerDbu) + otherListCost;
    const discountRate = Math.min(100, Math.max(0, n(config.discountRate))) / 100;
    const discountSavings = listCost * discountRate;
    return { listCost, discountSavings, cost: listCost - discountSavings };
  }

  function genieForecast(config, scenarioMultiplier) {
    const rows = MONTH_NAMES.map((month, index) => {
      const promptsBase = config.requestsPerDay
        ? n(config.requestsPerDay) * n(config.activeDays, DAYS_PER_MONTH)
        : n(config.activeUsers) * n(config.promptsPerUserMonth);
      const prompts = grow(promptsBase * scenarioMultiplier, config.monthlyGrowth, index);
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
        n(config.surfaceMultiplier, 1);
      const genieDbu = (weightedTokens / 1_000_000) * n(config.dbuPerMillionTokens);
      const sqlQueries = prompts * n(config.queriesPerPrompt);
      const sqlDbu = (sqlQueries / 1000) * n(config.sqlDbuPer1000Queries);
      const totalDbu = genieDbu + sqlDbu;
      const { listCost, discountSavings, cost } = discountedCost(config, totalDbu);
      const peakRpm = config.requestsPerDay
        ? ((prompts / n(config.activeDays, DAYS_PER_MONTH)) * n(config.peakFactor, 1)) /
          (n(config.activeHours, 24) * 60)
        : 0;
      return {
        month, prompts, weightedTokens, genieDbu, sqlDbu, totalDbu,
        storageTb: 0, listCost, discountSavings, cost, peakRpm,
        primary: weightedTokens / 1_000_000,
      };
    });
    const calibrated = n(config.dbuPerMillionTokens) > 0;
    return {
      rows,
      primaryLabel: "Weighted token demand (M)",
      summary: [
        { label: "12-month weighted tokens", value: `${formatCompact(sum(rows, "weightedTokens"))}` },
        { label: "Month 12 prompts", value: formatCompact(rows[11].prompts) },
        {
          label: "Estimated Genie DBUs",
          value: calibrated ? formatCompact(sum(rows, "genieDbu")) : "Calibrate",
        },
        {
          label: config.requestsPerDay ? "Peak API rate" : "Context multiplier",
          value: config.requestsPerDay
            ? `${formatNumber(rows[11].peakRpm, 1)} RPM`
            : `${formatNumber(
                Math.min(
                  n(config.contextCap, 3),
                  1 +
                    (n(config.contextGrowth) / 100) *
                      Math.max(0, n(config.promptsPerConversation, 1) - 1) /
                      2
                ),
                2
              )}×`,
        },
      ],
      guidance: calibrated
        ? "DBU estimate uses your pilot calibration. Recalibrate monthly against system.billing.usage."
        : "Token demand is a planning estimate. Enter observed DBUs per million weighted tokens from a 14–30 day pilot to forecast billable usage.",
      caveat:
        "Databricks bills Genie from underlying LLM consumption in DBUs and does not publish a token-to-DBU conversion. Genie API is a channel into Genie Agents, not a separate billing surface.",
    };
  }

  function aibiForecast(config, scenarioMultiplier) {
    const rows = MONTH_NAMES.map((month, index) => {
      const interactiveBase =
        n(config.viewers) *
        n(config.sessionsPerDay) *
        n(config.queriesPerSession) *
        n(config.activeDays) *
        (n(config.cacheMiss) / 100);
      const queries =
        grow((interactiveBase + n(config.refreshQueriesMonth)) * scenarioMultiplier, config.monthlyGrowth, index);
      const averageQps = queries / (n(config.activeDays) * n(config.activeHours) * 3600);
      const peakQps = averageQps * n(config.peakFactor, 1);
      const concurrentQueries = peakQps * n(config.p95RuntimeSeconds);
      const clusters = concurrentQueries
        ? Math.max(1, Math.ceil((concurrentQueries / 10) * (1 + n(config.headroom) / 100)))
        : 0;
      const totalDbu = (queries / 1000) * n(config.dbuPer1000Queries);
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
        { label: "Planning max clusters", value: String(rows[11].clusters) },
        {
          label: "Estimated SQL DBUs",
          value: n(config.dbuPer1000Queries) ? formatCompact(sum(rows, "totalDbu")) : "Calibrate",
        },
      ],
      guidance:
        "Start with a Medium serverless SQL warehouse and validate Peak Queued Queries. The cluster estimate is for classic/pro planning only.",
      caveat:
        "Serverless uses Intelligent Workload Management; the documented 10 concurrent queries per cluster rule applies to classic and pro warehouses.",
    };
  }

  function appsForecast(config, scenarioMultiplier) {
    const appRate = config.appSize === "large" ? 1 : 0.5;
    const rows = MONTH_NAMES.map((month, index) => {
      const demandGrowth = Math.pow(1 + n(config.monthlyGrowth) / 100, index);
      const appDbu =
        n(config.replicas) * n(config.runtimeHoursDay) * n(config.activeDays) * appRate;
      const requests =
        n(config.aiRequestsDay) * n(config.activeDays) * scenarioMultiplier * demandGrowth;
      const inputTokens = requests * n(config.inputTokens);
      const outputTokens = requests * n(config.outputTokens);
      const tokenCost =
        (inputTokens / 1_000_000) * n(config.inputPriceMillion) +
        (outputTokens / 1_000_000) * n(config.outputPriceMillion);
      const sqlDbu = n(config.sqlDbuMonth) * scenarioMultiplier * demandGrowth;
      const totalDbu = appDbu + sqlDbu;
      const { listCost, discountSavings, cost } = discountedCost(
        config,
        totalDbu,
        tokenCost
      );
      return {
        month, appDbu, sqlDbu, totalDbu, requests, inputTokens, outputTokens,
        storageTb: 0, listCost, discountSavings, cost,
        primary: (inputTokens + outputTokens) / 1_000_000,
      };
    });
    const cpu = (config.appSize === "large" ? 4 : 2) * n(config.replicas);
    const memory = (config.appSize === "large" ? 12 : 6) * n(config.replicas);
    return {
      rows,
      primaryLabel: "AI token demand (M)",
      summary: [
        { label: "12-month app DBUs", value: formatCompact(sum(rows, "appDbu")) },
        { label: "12-month AI tokens", value: formatCompact(sum(rows, "inputTokens") + sum(rows, "outputTokens")) },
        { label: "Provisioned CPU envelope", value: `${formatNumber(cpu, 0)} vCPU` },
        { label: "Memory envelope", value: `${formatNumber(memory, 0)} GB` },
      ],
      guidance:
        "App compute is provisioned while running. Model Serving, SQL warehouses, jobs, databases, and storage remain separate dependencies.",
      caveat:
        "Medium Apps use 0.5 DBU per running instance-hour; Large uses 1 DBU. Horizontal scaling supports 1–5 instances.",
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

  function forecast(workloadId, rawConfig = {}, scenario = "base") {
    const workload = WORKLOADS[workloadId] || WORKLOADS["genie-one"];
    const config = { ...workload.defaults, ...rawConfig };
    const multiplier = SCENARIO_MULTIPLIERS[scenario] || 1;
    let result;
    if (workload.family === "genie") result = genieForecast(config, multiplier);
    if (workload.family === "aibi") result = aibiForecast(config, multiplier);
    if (workload.family === "apps") result = appsForecast(config, multiplier);
    if (workload.family === "lakehouse") result = lakehouseForecast(config, multiplier);

    if (workload.family === "genie") {
      const messaging = {
        "genie-one": {
          guidance: "Plan per-user adoption and calibrate weighted token demand to DBUs from a representative Genie One pilot. Budget the separate SQL warehouse independently.",
          caveat: "Genie One usage is billed from underlying LLM consumption in DBUs. The weighted-token estimate is for scenario planning, not an official token bill.",
        },
        "genie-agents": {
          guidance: "Use the chat-versus-agent mix and internal-turn assumptions to model multi-step work. Recalibrate against Genie Agents DBUs and SQL queries each month.",
          caveat: "Agent tasks can run several reasoning and SQL steps. Conversation limits and 429 responses are operational constraints, not purchasable token capacity.",
        },
        "genie-code": {
          guidance: "Set shared and per-user Genie budgets from observed developer tiers. Long agentic chats should use higher turn and context-growth assumptions.",
          caveat: "Genie Code resends conversation context and may plan, act, and verify over several turns. Consumption therefore grows nonlinearly with long chats.",
        },
        "genie-api": {
          guidance: "Size peak request handling, queue clients, and implement exponential backoff. Calibrate the underlying Genie Agents DBUs and SQL usage separately.",
          caveat: "Genie API is a channel into Genie Agents, not a fourth billing surface. Service-principal usage does not receive the human per-user free allowance.",
        },
      };
      Object.assign(result, messaging[workloadId]);
    }

    const annualListCost = sum(result.rows, "listCost");
    const annualDiscountSavings = sum(result.rows, "discountSavings");
    const annualCost = sum(result.rows, "cost");
    const annualDbu = sum(result.rows, "totalDbu");
    return {
      ...result,
      workload,
      workloadId,
      config,
      scenario,
      annualCost,
      annualListCost,
      annualDiscountSavings,
      annualDbu,
      month12ListCost: result.rows[11].listCost,
      month12DiscountSavings: result.rows[11].discountSavings,
      month12Cost: result.rows[11].cost,
      hasPricing: annualListCost > 0,
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
    SCENARIO_MULTIPLIERS,
    forecast,
    formatNumber,
    formatCompact,
  };
})(typeof window === "undefined" ? globalThis : window);
