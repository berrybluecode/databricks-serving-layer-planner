(function () {
  "use strict";

  const {
    WORKLOADS, PRICING_REGIONS, DEFAULT_CREDIBILITY_K, DEFAULT_SQL_PRICE,
    DEFAULT_GENIE_PRICE, VALUE_DEFAULTS, VALUE_EXAMPLES, VALUE_EXAMPLE_VERSION,
    forecast, formatNumber, formatCompact,
  } = window.PortfolioModel;
  const CALIBRATION_KIND = { genie: "genie", aibi: "dashboard", apps: "app" };
  const KIND_LABEL = { genie: "Genie surface", dashboard: "AI/BI dashboard", app: "Databricks App" };
  let backendAvailable = null;
  const sourceCache = {};
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const storageKey = "databricks-serving-layer-planner-v3";

  const number = (key, label, unit = "", step = 1, help = "") => ({
    key, label, unit, step, help, type: "number",
  });
  const select = (key, label, options, help = "") => ({
    key, label, options, help, type: "select",
  });
  const text = (key, label, help = "") => ({
    key, label, help, type: "text", wide: true,
  });
  const regionOptions = Object.entries(PRICING_REGIONS).map(([id, region]) => [
    id,
    `${region.label} · SQL $${region.sqlListPricePerDbu.toFixed(2)} / Genie $${region.genieListPricePerDbu.toFixed(3)}`,
  ]);
  const sqlPricingFields = [
    select("pricingRegion", "Workspace pricing region", regionOptions,
      "Genie uses the serverless real-time inference SKU, not the SQL warehouse list price"),
    number("sqlListPricePerDbu", "SQL DBU list price", "$/DBU", .01, "SQL warehouse / serverless SQL SKU"),
    number("discountRate", "Account discount rate", "%", .5, "Enter the negotiated discount for this account"),
  ];
  const geniePricingFields = [
    ...sqlPricingFields.slice(0, 1),
    number("genieListPricePerDbu", "Genie DBU list price", "$/DBU", .001,
      "Serverless real-time inference SKU from system.billing.list_prices (~$0.07 US East, ~$0.084 Frankfurt)"),
    ...sqlPricingFields.slice(1),
  ];
  const complexityOptions = [
    ["light", "Light · KPI tiles / Gold aggregates"],
    ["medium", "Medium · multi-join dashboard"],
    ["heavy", "Heavy · wide scans / write-back"],
    ["extreme", "Extreme · shared app + ETL warehouse"],
  ];

  const genieTokenFields = [
    number("promptsPerConversation", "Prompts per conversation", "", 1),
    number("inputTokens", "Input tokens / prompt", "", 100, "Planning estimate, not a billing conversion"),
    number("outputTokens", "Output tokens / prompt", "", 100),
    number("agentShare", "Agent-mode share", "%", 1),
    number("agentTurns", "Internal turns / agent task", "turns", .5),
    number("contextGrowth", "Context growth / message", "%", 1),
    number("contextCap", "Context multiplier cap", "×", .25),
    number("surfaceMultiplier", "Surface complexity multiplier", "×", .1),
  ];
  const genieCalibrationFields = [
    number("dbuPerUserMonth", "Observed Genie DBUs / active user / month", "DBU", .1,
      "From system.billing.usage by genie.surface and run_as — not tokens"),
    number("queriesPerPrompt", "SQL queries / prompt", "", .1),
    number("sqlDbuPer1000Queries", "Observed SQL DBUs / 1K queries", "DBU", .01),
    select("pricingHorizon", "Commercial horizon", [
      ["promo", "Promo · One/Agents free for humans until 31 Jan 2027"],
      ["post-promo", "Post-promo · 150 DBU/user/month then SRTI list price"],
    ], "Code is billed above 150 DBU/user/month in both horizons"),
    number("nonEnglishShare", "Non-English conversation share", "%", 1,
      "Non-English messages cost about 2.9× per message — material for CEMEA"),
    ...geniePricingFields,
  ];
  const genieOneTokenFields = genieTokenFields.filter(
    (field) => !["agentShare", "agentTurns"].includes(field.key)
  );
  const genieAgentTokenFields = genieTokenFields.map((field) =>
    field.key === "agentShare"
      ? { ...field, label: "Agent-mode share" }
      : field.key === "agentTurns"
        ? { ...field, label: "Reasoning/tool turns per agent task" }
        : field
  );
  const genieCodeTokenFields = genieTokenFields.map((field) =>
    field.key === "agentShare"
      ? { ...field, label: "Agentic-task share" }
      : field.key === "agentTurns"
        ? { ...field, label: "Plan/action/check turns per task" }
        : field.key === "promptsPerConversation"
          ? { ...field, label: "Prompts per coding chat" }
          : field
  );

  const FIELD_SCHEMAS = {
    "genie-one": [
      { title: "Adoption", fields: [
        number("activeUsers", "Monthly active users", "users"),
        number("promptsPerUserMonth", "Prompts / user / month", "", 1),
        number("monthlyGrowth", "Monthly adoption growth", "%", .5),
      ]},
      { title: "Question & context assumptions", fields: genieOneTokenFields },
      { title: "Pilot calibration & rates", fields: genieCalibrationFields },
    ],
    "genie-agents": [
      { title: "Adoption", fields: [
        number("activeUsers", "Monthly active users", "users"),
        number("promptsPerUserMonth", "Prompts / user / month", "", 1),
        number("monthlyGrowth", "Monthly adoption growth", "%", .5),
      ]},
      { title: "Chat and agent-mode assumptions", fields: genieAgentTokenFields },
      { title: "Pilot calibration & rates", fields: genieCalibrationFields },
    ],
    "genie-code": [
      { title: "Developer adoption", fields: [
        number("activeUsers", "Monthly active developers", "users"),
        number("promptsPerUserMonth", "Prompts / developer / month", "", 1),
        number("monthlyGrowth", "Monthly adoption growth", "%", .5),
      ]},
      { title: "Developer agent assumptions", fields: genieCodeTokenFields },
      { title: "Pilot calibration & rates", fields: genieCalibrationFields },
    ],
    "genie-api": [
      { title: "API traffic", fields: [
        number("requestsPerDay", "LLM requests / day", "req", 10),
        number("activeDays", "Active days / month", "days", 1),
        number("activeHours", "Traffic window / day", "hr", 1),
        number("peakFactor", "Peak / average traffic", "×", .5),
        number("monthlyGrowth", "Monthly request growth", "%", .5),
      ]},
      { title: "Token demand assumptions", fields: genieTokenFields },
      { title: "Pilot calibration & rates", fields: [
        number("dbuPerThousandRequests", "Observed Genie DBUs / 1K API requests", "DBU", .1,
          "Service principals have no 150 DBU allowance"),
        number("queriesPerPrompt", "SQL queries / request", "", .1),
        number("sqlDbuPer1000Queries", "Observed SQL DBUs / 1K queries", "DBU", .01),
        select("pricingHorizon", "Commercial horizon", [
          ["promo", "Promo · 25% already in billed DBU metering"],
          ["post-promo", "Post-promo · full SRTI list price"],
        ]),
        number("nonEnglishShare", "Non-English request share", "%", 1),
        ...geniePricingFields,
      ]},
    ],
    aibi: [
      { title: "Interactive demand", fields: [
        number("viewers", "Monthly dashboard viewers", "users"),
        number("sessionsPerDay", "Sessions / viewer / day", "", .1),
        number("queriesPerSession", "Queries / session", "", .5),
        number("activeDays", "Active days / month", "days", 1),
        number("refreshQueriesMonth", "Scheduled refresh queries / month", "", 100),
        number("monthlyGrowth", "Monthly query growth", "%", .5),
      ]},
      { title: "Peak & execution profile", fields: [
        number("activeHours", "Interactive hours / day", "hr", 1),
        number("peakFactor", "Peak / average traffic", "×", .5),
        number("p95RuntimeSeconds", "p95 query runtime", "sec", 1),
        number("headroom", "Concurrency headroom", "%", 5),
      ]},
      { title: "Query complexity & data", fields: [
        select("queryComplexity", "Query complexity", complexityOptions,
          "Light: KPI tiles; Medium: joins; Heavy: write-back; Extreme: app + ETL"),
        number("dataScannedGbPerQuery", "Average data scanned / query", "GB", .1,
          "Use Gold-table bytes read, not total lakehouse size"),
        number("initialStorageTb", "Dashboard source storage", "TB", .1),
        number("storageGrowth", "Monthly storage growth", "%", .5),
        number("storagePriceTb", "Storage list price / TB-month", "$", .1),
      ]},
      { title: "SQL SKU pricing", fields: sqlPricingFields },
    ],
    apps: [
      { title: "App runtime", fields: [
        select("appSize", "App compute size", [["medium", "Medium · 0.5 DBU/hr"], ["large", "Large · 1 DBU/hr"]]),
        number("replicas", "Average running instances", "1–5", 1),
        number("runtimeHoursDay", "Runtime hours / day", "hr", 1),
        number("activeDays", "Running days / month", "days", 1),
      ]},
      { title: "Users & SQL dependency", fields: [
        number("activeUsers", "Active users", "users", 1),
        number("requestsPerUserDay", "Requests / user / day", "req", 1),
        number("queriesPerRequest", "SQL queries / request", "", .5),
        select("queryComplexity", "Query complexity", complexityOptions,
          "Pick the closest recognizable workload pattern"),
        number("dataScannedGbPerQuery", "Average data scanned / query", "GB", .1,
          "Use bytes read from query history where available"),
        number("monthlyGrowth", "Monthly demand growth", "%", .5),
      ]},
      { title: "Lakebase dependency", fields: [
        select("lakebaseEnabled", "Lakebase needed?", [["no", "No"], ["yes", "Yes · write-back / OLTP"]]),
        number("lakebaseDbuMonth", "Lakebase compute / month", "DBU", 10, "Ignored when Lakebase is No"),
        number("lakebaseStorageCostMonth", "Lakebase storage / month", "$", 1, "Ignored when Lakebase is No"),
      ]},
      { title: "AI dependency", fields: [
        select("aiEnabled", "Embedded AI / Genie?", [["no", "No"], ["yes", "Yes"]]),
        number("aiRequestsDay", "AI requests / day", "req", 10, "Ignored when embedded AI is No"),
        number("inputTokens", "Input tokens / request", "", 100),
        number("outputTokens", "Output tokens / request", "", 100),
        number("inputPriceMillion", "Input list price / 1M tokens", "$", .01),
        number("outputPriceMillion", "Output list price / 1M tokens", "$", .01),
      ]},
      { title: "SQL SKU pricing", fields: sqlPricingFields },
    ],
  };

  const valueFields = [
    { title: "Use case (CFO drill-down)", fields: [
      text("businessUnit", "Business unit", "Company → business unit → this use case"),
      text("useCaseName", "Use case name", "The decision or process this serving-layer workload supports"),
      number("affectedUsers", "People whose work changes", "users", 1,
        "Leave 0 to use active users / viewers from the demand model"),
      number("fxUsdToEur", "USD → EUR planning rate", "×", .01, "Databricks list prices are USD; value is shown in EUR"),
    ]},
    { title: "Time saved — not yet money", fields: [
      number("minutesSavedPerUserDay", "Minutes saved / person / day", "min", 5,
        "Gartner: 74% of CFOs see time saved; only ~11% have seen financial value"),
      number("workingDaysYear", "Working days / year", "days", 1),
      number("fullyLoadedHourlyEur", "Fully loaded hourly value", "€/h", 1,
        "Forrester TEI burden is ~35% on base salary. EU knowledge-worker planning default €55"),
      number("productivityRecapture", "Productivity recapture", "%", 5,
        "Forrester TEI default 50% — only recaptured time is valued. Gartner leakage is often 10–30%"),
      number("teiBenefitRisk", "TEI benefit-risk haircut", "%", 5,
        "Forrester typically cuts productivity benefits 10–20% for measurement uncertainty"),
      select("timeCaptureMode", "How is the time used?", [
        ["reinvested", "Reinvested · stay in productivity (not cash)"],
        ["avoided_hiring", "Deferred hiring · cost avoidance"],
        ["mixed", "Split · set hiring share below"],
      ], "Do not count the same hour as both productivity and avoided FTE"),
      number("avoidedHiringShare", "Share treated as deferred hiring", "%", 5, "Used only in mixed mode"),
    ]},
    { title: "Hard savings and avoidance", fields: [
      number("hardLicenseSavingsEur", "Retired licenses this year", "€", 100, "Power BI / Tableau / other — only if the contract actually ends"),
      number("hardConsultingSavingsEur", "Reduced external spend this year", "€", 100),
      number("hardFteReductionEur", "Actual labor cost removed", "€", 100, "Only if headcount, contractors, or overtime budget is cut"),
      number("overtimeHoursMonth", "Overtime hours removed / month", "h", 1),
      number("overtimePremium", "Overtime premium", "×", .1),
      number("avoidedLicenseEur", "Licenses you will not buy", "€", 100, "Avoidance — not a P&L reduction"),
    ]},
    { title: "Revenue, decisions, and risk", fields: [
      number("incrementalRevenueEur", "Claimed incremental revenue", "€", 1000, "We keep only contribution margin"),
      number("contributionMargin", "Contribution margin", "%", 1),
      number("revenueRisk", "Revenue evidence haircut", "%", 5),
      number("decisionsPerYear", "Material decisions / year", "", 1),
      number("valuePerFasterDecisionEur", "Priced value / faster decision", "€", 100,
        "Leave 0 unless Finance has priced cycle time. Unpriced speed stays a leading indicator"),
      number("incidentsPerYear", "Relevant incidents / year", "", 1),
      number("incidentImpactEur", "Financial impact / incident", "€", 1000),
      number("incidentProbabilityReduction", "Probability reduction", "%", 1, "FAIR: expected loss = frequency × magnitude"),
      number("riskRealization", "Risk-value realization", "%", 5, "How much of the expected-loss cut you will defend"),
    ]},
    { title: "Investment and extra budget", fields: [
      number("implementationCostEur", "One-time implementation / change cost", "€", 100),
      number("npvDiscountRate", "Finance discount rate (WACC)", "%", .5, "Forrester TEI present-value default is 10%"),
      number("extraBudgetEur", "Extra consumption budget to test", "€", 1000,
        "Answers: if we approve another €Y, what value is reasonable?"),
      number("diminishingReturn", "Diminishing-return factor on extra €", "%", 5,
        "Default 80% — extra spend rarely buys the same BCR as the first euro"),
    ]},
  ];

  Object.keys(FIELD_SCHEMAS).forEach((id) => {
    FIELD_SCHEMAS[id] = FIELD_SCHEMAS[id].concat(valueFields);
  });

  function freshValues() {
    return Object.fromEntries(
      Object.entries(WORKLOADS).map(([id, workload]) => [id, { ...workload.defaults }])
    );
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      const defaults = freshValues();
      const mergedValues = Object.fromEntries(
        Object.keys(WORKLOADS).map((id) => [
          id,
          { ...defaults[id], ...(saved?.values?.[id] || {}) },
        ])
      );
      Object.entries(mergedValues).forEach(([id, values]) => {
        if ((Number(values.valueExampleVersion) || 0) < VALUE_EXAMPLE_VERSION && VALUE_EXAMPLES[id]) {
          Object.assign(values, VALUE_EXAMPLES[id], {
            valueExample: true, valueExampleVersion: VALUE_EXAMPLE_VERSION,
          });
        }
      });
      Object.values(mergedValues).forEach((values) => {
        if (!PRICING_REGIONS[values.pricingRegion]) values.pricingRegion = "azure-north-europe";
        const region = PRICING_REGIONS[values.pricingRegion];
        if (!values.sqlListPricePerDbu) {
          values.sqlListPricePerDbu = values.listPricePerDbu || region.sqlListPricePerDbu || DEFAULT_SQL_PRICE;
        }
        if (!values.genieListPricePerDbu) {
          values.genieListPricePerDbu = region.genieListPricePerDbu || DEFAULT_GENIE_PRICE;
        }
        values.listPricePerDbu = values.sqlListPricePerDbu;
      });
      const discountRate = Number.isFinite(Number(saved?.discountRate))
        ? Number(saved.discountRate)
        : Number(Object.values(mergedValues)[0]?.discountRate) || 0;
      Object.values(mergedValues).forEach((values) => {
        values.discountRate = discountRate;
      });
      const scenario = ["light", "regular", "power"].includes(saved?.scenario)
        ? saved.scenario
        : saved?.scenario === "high" ? "power" : saved?.scenario === "low" ? "light" : "regular";
      const workloadId = saved?.workloadId && WORKLOADS[saved.workloadId] && !WORKLOADS[saved.workloadId].hidden
        ? saved.workloadId
        : "genie-one";
      return { workloadId, scenario, discountRate, values: mergedValues };
    } catch {
      return { workloadId: "genie-one", scenario: "regular", discountRate: 0, values: freshValues() };
    }
  }

  const state = loadState();

  function save() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function setAccountDiscount(rawValue, source) {
    const value = Math.min(100, Math.max(0, Number(rawValue) || 0));
    state.discountRate = value;
    Object.values(state.values).forEach((values) => {
      values.discountRate = value;
    });
    const hero = $("#accountDiscount");
    const sidebar = $("#field-discountRate");
    if (source !== hero && hero && Number(hero.value) !== value) hero.value = value;
    if (source !== sidebar && sidebar && Number(sidebar.value) !== value) sidebar.value = value;
    renderResults();
    save();
  }

  function formatCurrency(value) {
    return Number(value).toLocaleString(undefined, {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    });
  }

  function formatEuro(value) {
    return Number(value).toLocaleString(undefined, {
      style: "currency", currency: "EUR", maximumFractionDigits: 0,
    });
  }

  function formatPct(value) {
    if (value == null || !Number.isFinite(value)) return "—";
    return `${formatNumber(value * 100, 0)}%`;
  }

  function formatRoi(roi, cost, economic) {
    if (!(cost > 0)) return economic > 0 ? '<span title="No billed Databricks cost in this horizon">n.m. · €0 cost</span>' : "—";
    if (roi != null && roi > 20) return `<span title="Platform cost is under 5% of value; ROI % is not meaningful. Read BCR and absolute euros instead.">n.m. · BCR ${formatNumber(roi + 1, 0)}×</span>`;
    return formatPct(roi);
  }

  function createField(field) {
    const wrapper = document.createElement("div");
    wrapper.className = field.wide ? "field wide" : "field";
    const label = document.createElement("label");
    label.htmlFor = `field-${field.key}`;
    label.textContent = field.label;
    const inputWrap = document.createElement("div");
    inputWrap.className = "input-wrap";
    let input;
    if (field.type === "select") {
      input = document.createElement("select");
      field.options.forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        input.appendChild(option);
      });
    } else if (field.type === "text") {
      input = document.createElement("input");
      input.type = "text";
    } else {
      input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = String(field.step || 1);
      if (field.unit) input.classList.add("has-unit");
    }
    input.id = `field-${field.key}`;
    input.value = state.values[state.workloadId][field.key];
    input.dataset.key = field.key;
    input.addEventListener("input", () => {
      if (field.key === "discountRate") {
        setAccountDiscount(input.value, input);
        return;
      }
      const current = state.values[state.workloadId];
      current[field.key] = field.type === "number" ? Number(input.value) : input.value;
      if (field.key === "pricingRegion") {
        const region = PRICING_REGIONS[input.value];
        if (region) {
          current.sqlListPricePerDbu = region.sqlListPricePerDbu;
          current.genieListPricePerDbu = region.genieListPricePerDbu;
          current.listPricePerDbu = region.sqlListPricePerDbu;
          const sqlInput = $("#field-sqlListPricePerDbu");
          const genieInput = $("#field-genieListPricePerDbu");
          if (sqlInput) sqlInput.value = region.sqlListPricePerDbu;
          if (genieInput) genieInput.value = region.genieListPricePerDbu;
          updateRegionBadge();
        }
      }
      if (field.key === "sqlListPricePerDbu") current.listPricePerDbu = Number(input.value);
      renderResults();
      save();
    });
    inputWrap.appendChild(input);
    if (field.unit) {
      const unit = document.createElement("span");
      unit.className = "input-unit";
      unit.textContent = field.unit;
      inputWrap.appendChild(unit);
    }
    wrapper.append(label, inputWrap);
    if (field.help) {
      const help = document.createElement("small");
      help.textContent = field.help;
      wrapper.appendChild(help);
    }
    return wrapper;
  }

  function renderForm() {
    const container = $("#inputFields");
    container.innerHTML = "";
    FIELD_SCHEMAS[state.workloadId].forEach((group) => {
      const section = document.createElement("section");
      section.className = "field-group";
      const title = document.createElement("h3");
      title.className = "field-group-title";
      title.textContent = group.title;
      const grid = document.createElement("div");
      grid.className = "field-grid";
      group.fields.forEach((field) => grid.appendChild(createField(field)));
      section.append(title, grid);
      container.appendChild(section);
    });
    renderCalibrationSection(container);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
    ));
  }

  async function fetchJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`);
    return body;
  }

  async function checkBackend() {
    if (backendAvailable !== null) return backendAvailable;
    try {
      backendAvailable = (await fetchJson("api/health")).status === "healthy";
    } catch {
      backendAvailable = false;
    }
    return backendAvailable;
  }

  function renderCalibrationSection(container) {
    const kind = CALIBRATION_KIND[WORKLOADS[state.workloadId].family];
    if (!kind) return;
    const values = state.values[state.workloadId];
    const section = document.createElement("section");
    section.className = "field-group calibration-group";
    section.innerHTML = `
      <h3 class="field-group-title">Calibrate from workspace</h3>
      <p class="calibration-intro">For Genie, pull observed DBUs per active user per month from <code>system.billing.usage</code> by <code>genie.surface</code> and <code>run_as</code>. SQL warehouse rates still come from query history. Token-to-DBU conversion is not used.</p>
      <div class="field-grid">
        <div class="field">
          <label for="calibrationSource">Observed ${KIND_LABEL[kind]}</label>
          <div class="input-wrap"><select id="calibrationSource" disabled><option>Checking workspace…</option></select></div>
        </div>
        <div class="field">
          <label for="calibrationDays">Lookback window</label>
          <div class="input-wrap"><input id="calibrationDays" type="number" min="7" max="90" step="1" class="has-unit" value="${values.calibrationDays || 30}"><span class="input-unit">days</span></div>
        </div>
        <div class="field">
          <label for="credibilityK">Credibility constant k</label>
          <div class="input-wrap"><input id="credibilityK" type="number" min="1" step="500" class="has-unit" value="${values.credibilityK || DEFAULT_CREDIBILITY_K}"><span class="input-unit">queries</span></div>
          <small>Observed weight = n ÷ (n + k)</small>
        </div>
      </div>
      <div class="calibration-actions">
        <button type="button" class="button primary" id="calibrateButton" disabled>Calibrate</button>
        <button type="button" class="button ghost" id="clearCalibrationButton" ${values.calibration ? "" : "disabled"}>Use preset only</button>
      </div>
      <div id="calibrationResult" class="calibration-result"></div>`;
    container.prepend(section);

    const sourceSelect = section.querySelector("#calibrationSource");
    const daysInput = section.querySelector("#calibrationDays");
    const kInput = section.querySelector("#credibilityK");
    const calibrateButton = section.querySelector("#calibrateButton");
    const clearButton = section.querySelector("#clearCalibrationButton");
    const days = () => Math.min(90, Math.max(7, Number(daysInput.value) || 30));

    kInput.addEventListener("input", () => {
      values.credibilityK = Math.max(1, Number(kInput.value) || DEFAULT_CREDIBILITY_K);
      renderResults();
      save();
    });
    daysInput.addEventListener("change", () => {
      values.calibrationDays = days();
      save();
      loadSources();
    });
    clearButton.addEventListener("click", () => {
      delete values.calibration;
      clearButton.disabled = true;
      renderResults();
      save();
      toast("Using complexity preset only");
    });
    calibrateButton.addEventListener("click", async () => {
      const sourceId = sourceSelect.value;
      if (!sourceId) return;
      calibrateButton.disabled = true;
      calibrateButton.textContent = "Calibrating…";
      try {
        const params = new URLSearchParams({ kind, source_id: sourceId, days: String(days()) });
        values.calibration = await fetchJson(`api/calibration/observe?${params}`);
        if (values.calibration.dbu_per_user_month) {
          values.dbuPerUserMonth = values.calibration.dbu_per_user_month;
          const userInput = $("#field-dbuPerUserMonth");
          if (userInput) userInput.value = values.dbuPerUserMonth;
        }
        if (values.calibration.dbu_per_thousand_requests) {
          values.dbuPerThousandRequests = values.calibration.dbu_per_thousand_requests;
          const reqInput = $("#field-dbuPerThousandRequests");
          if (reqInput) reqInput.value = values.dbuPerThousandRequests;
        }
        if (values.calibration.genie_list_price) {
          values.genieListPricePerDbu = values.calibration.genie_list_price;
          const priceInput = $("#field-genieListPricePerDbu");
          if (priceInput) priceInput.value = values.genieListPricePerDbu;
        }
        if (values.calibration.sql_list_price) {
          values.sqlListPricePerDbu = values.calibration.sql_list_price;
          values.listPricePerDbu = values.calibration.sql_list_price;
          const sqlInput = $("#field-sqlListPricePerDbu");
          if (sqlInput) sqlInput.value = values.sqlListPricePerDbu;
        }
        clearButton.disabled = false;
        renderResults();
        save();
        toast(`Calibrated from ${values.calibration.label}`);
      } catch (error) {
        toast(`Calibration failed: ${error.message}`);
      } finally {
        calibrateButton.disabled = false;
        calibrateButton.textContent = "Calibrate";
      }
    });

    async function loadSources() {
      const workloadId = state.workloadId;
      sourceSelect.disabled = true;
      calibrateButton.disabled = true;
      if (!(await checkBackend())) {
        sourceSelect.innerHTML = "<option>Available in the Databricks App deployment</option>";
        return;
      }
      sourceSelect.innerHTML = "<option>Loading observed workloads…</option>";
      const cacheKey = `${kind}:${days()}`;
      try {
        sourceCache[cacheKey] ||= (await fetchJson(
          `api/calibration/sources?${new URLSearchParams({ kind, days: String(days()) })}`
        )).sources;
      } catch (error) {
        sourceSelect.innerHTML = `<option>${escapeHtml(error.message)}</option>`;
        return;
      }
      if (workloadId !== state.workloadId) return;
      const sources = sourceCache[cacheKey];
      if (!sources.length) {
        sourceSelect.innerHTML = `<option>No ${KIND_LABEL[kind]} activity in the last ${days()} days</option>`;
        return;
      }
      sourceSelect.innerHTML = sources.map((source) => {
        const detail = source.users
          ? `${formatCompact(source.users)} users · ${formatCompact(source.dbu)} DBU`
          : `${formatCompact(source.queries)} queries`;
        return `<option value="${escapeHtml(source.source_id)}">${escapeHtml(source.label)} · ${detail}</option>`;
      }).join("");
      if (values.calibration && sources.some((source) => source.source_id === values.calibration.source_id)) {
        sourceSelect.value = values.calibration.source_id;
      }
      sourceSelect.disabled = false;
      calibrateButton.disabled = false;
    }
    loadSources();
  }

  function renderCalibrationResult(result) {
    const target = $("#calibrationResult");
    if (!target) return;
    const blend = result.calibration;
    const userRate = blend?.userRate;
    const observation = userRate?.observation || blend?.observation;
    if (!observation) {
      target.innerHTML = `<p class="calibration-empty">No workspace observation applied. Genie uses DBUs per active user per month; SQL uses the complexity preset. This is a guesstimate until you calibrate.</p>`;
      return;
    }
    const range = result.annualCostRange;
    const genieBits = observation.dbu_per_user_month ? `
        <div><dt>Genie DBU / user / month</dt><dd>${formatNumber(observation.dbu_per_user_month, 1)}</dd></div>
        <div><dt>User P50–P90</dt><dd>${formatNumber(observation.p50_dbu_per_user_month || 0, 0)}–${formatNumber(observation.p90_dbu_per_user_month || 0, 0)}</dd></div>
        <div><dt>Free SKU share</dt><dd>${formatNumber((observation.free_share || 0) * 100, 0)}%</dd></div>
        ${userRate ? `<div><dt>User-rate weight</dt><dd>${formatNumber(userRate.weight * 100, 0)}%</dd></div>` : ""}
    ` : "";
    const sqlBits = observation.dbu_per_1k ? `
        <div><dt>SQL observed</dt><dd>${formatNumber(observation.dbu_per_1k, 1)} DBU / 1K</dd></div>
        <div><dt>SQL P10–P90</dt><dd>${formatNumber(observation.p10_dbu_per_1k, 0)}–${formatNumber(observation.p90_dbu_per_1k, 0)}</dd></div>
    ` : "";
    target.innerHTML = `
      <div class="calibration-source"><strong>${escapeHtml(observation.label)}</strong><span>${
        observation.users ? `${formatCompact(observation.users)} users` : `${formatCompact(observation.queries)} queries`
      } over ${observation.active_days || observation.months || "the lookback"} </span></div>
      <dl class="calibration-stats">
        ${genieBits}${sqlBits}
        ${range && result.hasPricing ? `<div class="wide"><dt>12-month billed cost band</dt><dd>${formatCurrency(range.low)} – ${formatCurrency(range.high)}</dd></div>` : ""}
      </dl>
      <small>Genie billing rows have no token counts. Recalibrate monthly from system.billing.usage.</small>`;
  }

  function renderProjectionChart(result) {
    const width = 900;
    const height = 280;
    const pad = { left: 58, right: 18, top: 18, bottom: 34 };
    const values = result.rows.map((row) => row.primary);
    const max = Math.max(...values, 1);
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const x = (index) => pad.left + (index / 11) * innerW;
    const y = (value) => pad.top + innerH - (value / max) * innerH;
    const path = values.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" ");
    const area = `${path} L${x(11)},${pad.top + innerH} L${x(0)},${pad.top + innerH} Z`;
    const grid = [0, .25, .5, .75, 1].map((fraction) => {
      const yy = pad.top + innerH - fraction * innerH;
      return `<line class="chart-grid" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}"/>
        <text class="chart-axis" x="${pad.left - 9}" y="${yy + 3}" text-anchor="end">${formatCompact(max * fraction)}</text>`;
    }).join("");
    const labels = result.rows.map((row, index) =>
      `<text class="chart-axis" x="${x(index)}" y="${height - 9}" text-anchor="middle">${index + 1}</text>`
    ).join("");
    const points = values.map((value, index) =>
      `<circle class="chart-point" cx="${x(index)}" cy="${y(value)}" r="3"><title>${result.rows[index].month}: ${formatNumber(value, 1)}</title></circle>`
    ).join("");
    $("#projectionChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img">
      <title>${result.primaryLabel} over twelve months</title>
      <defs><linearGradient id="projectionArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff3621" stop-opacity=".24"/><stop offset="1" stop-color="#ff3621" stop-opacity="0"/></linearGradient></defs>
      ${grid}${labels}<path class="chart-area" d="${area}"/><path class="chart-line" d="${path}"/>${points}
      <text class="chart-axis" x="${width / 2}" y="${height - 1}" text-anchor="middle">Forecast month</text>
    </svg>`;
  }

  function renderResults() {
    const workload = WORKLOADS[state.workloadId];
    const result = forecast(state.workloadId, state.values[state.workloadId], state.scenario);
    $("#assumptionsTitle").textContent = `${workload.label} assumptions`;
    $("#assumptionsDescription").textContent = workload.description;
    $("#resultFamily").textContent = `${workload.label} · ${state.scenario} mix`;
    $("#resultTitle").textContent = `${workload.label} 12-month sizing`;
    $("#resultDescription").textContent = workload.description;
    $("#annualCost").textContent = formatCurrency(result.annualCost);
    const shadowNote = result.annualShadowListCost && result.annualShadowListCost > result.annualListCost
      ? ` · would-be Genie+SQL list ${formatCurrency(result.annualShadowListCost)} if free SKU were billed`
      : "";
    $("#month12Cost").textContent =
      `${formatCurrency(result.annualListCost)} billed list − ${formatCurrency(result.annualDiscountSavings)} discount · ${formatCurrency(result.month12Cost)} month 12 net${shadowNote}`;
    if (result.annualCostRange) {
      $("#month12Cost").textContent += ` · P10–P90 ${formatCurrency(result.annualCostRange.low)}–${formatCurrency(result.annualCostRange.high)}`;
    }
    renderCalibrationResult(result);

    $("#summaryCards").innerHTML = result.summary.map((item) =>
      `<article class="kpi"><span>${item.label}</span><strong>${item.value}</strong><small>Base on current assumptions</small></article>`
    ).join("");
    $("#projectionTitle").textContent = `${workload.label} demand growth`;
    $("#chartUnit").textContent = result.primaryLabel;
    $("#primaryColumn").textContent = result.primaryLabel;
    $("#guidanceText").textContent = result.guidance;
    $("#caveatText").textContent = result.caveat;
    $("#monthRows").innerHTML = result.rows.map((row) => `
      <tr>
        <td>${row.month}</td>
        <td>${formatNumber(row.primary, row.primary >= 100 ? 0 : 1)}</td>
        <td>${row.totalDbu ? formatNumber(row.totalDbu, 1) : "—"}</td>
        <td>${row.storageTb ? `${formatNumber(row.storageTb, 1)} TB` : "—"}</td>
        <td>${row.listCost ? formatCurrency(row.listCost) : "—"}</td>
        <td>${row.discountSavings ? `−${formatCurrency(row.discountSavings)}` : "—"}</td>
        <td>${row.cost ? formatCurrency(row.cost) : "—"}</td>
      </tr>`).join("");
    renderProjectionChart(result);
    renderValue(result);
    updateRegionBadge();

    $$("#workloadPicker button").forEach((button) => {
      const active = button.dataset.workload === state.workloadId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
    $$(".scenario-control button").forEach((button) => {
      button.classList.toggle("active", button.dataset.scenario === state.scenario);
    });
  }

  function renderValue(result) {
    const value = result.value;
    const targets = [$("#valuePanel"), $("#valueBoard")].filter(Boolean);
    if (!targets.length) return;
    const unit = result.config.businessUnit || "Unassigned business unit";
    const useCase = result.config.useCaseName || result.workload.label;
    const banner = result.config.valueExample
      ? `<div class="value-banner"><div><strong>Illustrative example numbers.</strong> These outcomes are planning assumptions so you can see how the framework behaves. They are not measured at PUMA. Replace them in the sidebar under “Time saved” and “Hard savings”.</div><button type="button" class="button ghost value-clear">Clear example</button></div>`
      : "";
    const html = !value.hasInputs
      ? `<div class="value-empty">
          <strong>No business outcomes entered yet.</strong>
          <p>Cost is on the left. Value stays empty until you enter minutes saved, retired licenses, avoided hiring, revenue, or risk in the sidebar. Hours × salary is <em>not</em> shown as ROI.</p>
          <button type="button" class="button primary value-load">Load example numbers</button>
        </div>`
      : `${banner}<div class="value-path">${escapeHtml(unit)} → ${escapeHtml(useCase)} → ${escapeHtml(result.workload.label)} → Databricks consumption → financial value</div>
        <div class="value-headline">
          <article><span>Annual Databricks cost</span><strong>${formatEuro(value.platformCost)}</strong><small>${formatCurrency(value.platformCostUsd)} at ${value.fxUsdToEur} USD/EUR</small></article>
          <article><span>Cash-like value</span><strong>${formatEuro(value.cashLike)}</strong><small>Hard savings + cost avoidance only</small></article>
          <article><span>Quantified economic value</span><strong>${formatEuro(value.economic)}</strong><small>Not all of this is cash. Confidence ${formatPct(value.weightedConfidence)}</small></article>
          <article><span>Net economic value</span><strong>${formatEuro(value.netEconomic)}</strong><small>Economic value − platform cost</small></article>
        </div>
        <div class="value-categories">
          ${[
            ["Hard savings", value.hardSavings, "Cash / P&L"],
            ["Avoided costs", value.costAvoidance, "Not a cost cut"],
            ["Productivity value", value.productivityValue, "After 50% recapture + TEI risk"],
            ["Revenue contribution", value.revenueContribution, "Margin only"],
            ["Risk-adjusted value", value.riskAdjustedValue, "Expected loss + priced decisions"],
          ].map(([label, amount, note]) =>
            `<article><span>${label}</span><strong>${formatEuro(amount)}</strong><small>${note}</small></article>`
          ).join("")}
        </div>
        <p class="value-total-note">Categories are shown side by side on purpose. Adding them into one “savings” number would mix cash with capacity and expected-loss. Board total = ${formatEuro(value.economic)} quantified · ${formatEuro(value.cashLike)} defendable near-cash.</p>
        <dl class="value-metrics">
          <div><dt>Budget ROI (cash-like)</dt><dd>${formatRoi(value.roiCash, value.platformCost, value.cashLike)}</dd></div>
          <div><dt>TEI-style ROI</dt><dd>${formatRoi(value.roiEconomic, value.platformCost, value.economic)}</dd></div>
          <div><dt>Benefit-cost ratio</dt><dd>${value.bcr == null ? "—" : formatNumber(value.bcr, 2)}</dd></div>
          <div><dt>Payback</dt><dd>${value.paybackMonths == null ? "—" : `${formatNumber(value.paybackMonths, 1)} months`}</dd></div>
          <div><dt>3-year NPV @ ${formatNumber(result.config.npvDiscountRate, 0)}%</dt><dd>${formatEuro(value.npv3)}</dd></div>
          <div><dt>3-year IRR</dt><dd>${value.irr3 == null ? "—" : formatPct(value.irr3)}</dd></div>
        </dl>
        <div class="value-marginal">
          <strong>If we approve another ${formatEuro(value.extraBudgetEur || 0)}</strong>
          <p>A reasonable extra benefit is ${formatEuro(value.expectedExtraValue)}, using the current BCR × ${formatPct(value.diminishingReturn)} diminishing returns. This is a forecast, not a commitment. Returns flatten when the next euro buys lower-value questions.</p>
        </div>
        <p class="value-fte">Theoretical time saved: ${formatNumber(value.theoreticalHours, 0)} hours (${formatNumber(value.fteReleased, 2)} FTE). After recapture: ${formatNumber(value.capturedFte, 2)} FTE of capacity. Theoretical € value ${formatEuro(value.theoreticalValue)} is <em>excluded</em> from ROI.</p>
        <div class="table-scroll">
          <table class="value-table">
            <thead><tr><th>Category</th><th>Business metric</th><th>Method</th><th>EUR</th><th>Confidence</th><th>Treat as cash?</th></tr></thead>
            <tbody>${value.lines.map((line) => `<tr class="${line.excludedFromTotal ? "excluded" : ""}">
              <td>${escapeHtml(line.category)}</td>
              <td>${escapeHtml(line.metric)}<br><small>${escapeHtml(line.inputs)}</small></td>
              <td>${escapeHtml(line.method)}</td>
              <td>${formatEuro(line.value)}</td>
              <td>${formatPct(line.confidence)}</td>
              <td>${line.excludedFromTotal ? "No · do not add" : line.cash ? "Yes" : "No"}</td>
            </tr>`).join("")}</tbody>
          </table>
        </div>`;
    const panel = $("#valuePanel");
    if (panel) panel.innerHTML = html;
    const board = $("#valueBoard");
    if (board) {
      board.innerHTML = `${renderPortfolio()}<h2 class="value-detail-title">Selected use case: ${escapeHtml(useCase)}</h2>${html}`;
    }
    $$(".value-clear").forEach((button) => button.addEventListener("click", () => setValueExample(false)));
    $$(".value-load").forEach((button) => button.addEventListener("click", () => setValueExample(true)));
    $$(".value-open").forEach((button) => button.addEventListener("click", () => {
      state.workloadId = button.dataset.workload;
      renderForm();
      renderResults();
      save();
      $(".value-detail-title")?.scrollIntoView({ behavior: "smooth" });
    }));
  }

  function setValueExample(on) {
    const values = state.values[state.workloadId];
    if (on) {
      Object.assign(values, VALUE_EXAMPLES[state.workloadId] || {}, { valueExample: true });
    } else {
      const keep = ["fxUsdToEur", "workingDaysYear", "hoursPerDay", "fullyLoadedHourlyEur",
        "productivityRecapture", "teiBenefitRisk", "timeCaptureMode", "overtimePremium",
        "contributionMargin", "revenueRisk", "riskRealization", "npvDiscountRate", "diminishingReturn"];
      Object.entries(VALUE_DEFAULTS).forEach(([key, defaultValue]) => {
        if (!keep.includes(key)) values[key] = defaultValue;
      });
      values.valueExample = false;
    }
    renderForm();
    renderResults();
    save();
    toast(on ? "Example value inputs loaded" : "Example value inputs cleared");
  }

  function renderPortfolio() {
    const rows = Object.entries(WORKLOADS)
      .filter(([, workload]) => !workload.hidden)
      .map(([id, workload]) => {
        const item = forecast(id, state.values[id], state.scenario);
        return { id, workload, config: item.config, value: item.value };
      })
      .filter((row) => row.value.hasInputs);
    if (!rows.length) {
      return `<div class="value-empty"><strong>No use cases have business outcomes yet.</strong><p>Open a workload in the Planner and enter outcomes, or load the example numbers.</p></div>`;
    }
    const total = rows.reduce((acc, row) => {
      ["platformCost", "hardSavings", "costAvoidance", "productivityValue",
        "revenueContribution", "riskAdjustedValue", "cashLike", "economic", "implementation",
        "expectedExtraValue", "extraBudgetEur"].forEach((key) => {
        acc[key] = (acc[key] || 0) + (Number(row.value[key]) || 0);
      });
      return acc;
    }, {});
    const roi = total.platformCost > 0 ? (total.economic - total.platformCost) / total.platformCost : null;
    const cashRoi = total.platformCost > 0 ? (total.cashLike - total.platformCost) / total.platformCost : null;
    const bcr = total.platformCost > 0 ? total.economic / total.platformCost : null;
    const anyExample = rows.some((row) => row.config.valueExample);
    return `
      ${anyExample ? `<div class="value-banner"><div><strong>Contains illustrative example numbers.</strong> Rows marked “Example” use planning assumptions, not measured PUMA outcomes.</div></div>` : ""}
      <div class="value-headline">
        <article><span>Annual Databricks cost</span><strong>${formatEuro(total.platformCost)}</strong><small>All use cases below · ${state.scenario} mix</small></article>
        <article><span>Cash-like value</span><strong>${formatEuro(total.cashLike)}</strong><small>Hard savings + avoided cost · cash ROI ${formatRoi(cashRoi, total.platformCost, total.cashLike)}</small></article>
        <article><span>Quantified economic value</span><strong>${formatEuro(total.economic)}</strong><small>Includes capacity, margin, risk · not all cash</small></article>
        <article><span>Net value · BCR</span><strong>${formatEuro(total.economic - total.platformCost)}</strong><small>BCR ${bcr == null ? "—" : formatNumber(bcr, 1)}× · economic ROI ${formatRoi(roi, total.platformCost, total.economic)}</small></article>
      </div>
      <div class="table-scroll">
        <table class="value-table portfolio-table">
          <thead><tr><th>Business unit</th><th>Use case</th><th>Workload</th><th>Databricks cost</th><th>Hard savings</th><th>Avoided cost</th><th>Productivity</th><th>Revenue margin</th><th>Risk-adjusted</th><th>Economic value</th><th>ROI</th><th></th></tr></thead>
          <tbody>
            ${rows.map((row) => {
              const v = row.value;
              const rowRoi = v.platformCost > 0 ? (v.economic - v.platformCost) / v.platformCost : null;
              return `<tr>
                <td>${escapeHtml(row.config.businessUnit || "—")}</td>
                <td>${escapeHtml(row.config.useCaseName || row.workload.label)}${row.config.valueExample ? ' <span class="tag">Example</span>' : ""}</td>
                <td>${escapeHtml(row.workload.label)}</td>
                <td>${formatEuro(v.platformCost)}</td>
                <td>${formatEuro(v.hardSavings)}</td>
                <td>${formatEuro(v.costAvoidance)}</td>
                <td>${formatEuro(v.productivityValue)}</td>
                <td>${formatEuro(v.revenueContribution)}</td>
                <td>${formatEuro(v.riskAdjustedValue)}</td>
                <td><strong>${formatEuro(v.economic)}</strong></td>
                <td>${formatRoi(rowRoi, v.platformCost, v.economic)}</td>
                <td><button type="button" class="button ghost value-open" data-workload="${row.id}">Open</button></td>
              </tr>`;
            }).join("")}
            <tr class="total-row">
              <td colspan="3">Company total</td>
              <td>${formatEuro(total.platformCost)}</td>
              <td>${formatEuro(total.hardSavings)}</td>
              <td>${formatEuro(total.costAvoidance)}</td>
              <td>${formatEuro(total.productivityValue)}</td>
              <td>${formatEuro(total.revenueContribution)}</td>
              <td>${formatEuro(total.riskAdjustedValue)}</td>
              <td><strong>${formatEuro(total.economic)}</strong></td>
              <td>${formatRoi(roi, total.platformCost, total.economic)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="value-total-note">“n.m.” = not meaningful: platform cost is under 5% of the value, or zero because Genie One/Agents are free for humans during the promo. Read BCR and absolute euros instead of ROI %. Columns are not interchangeable. Only hard savings are cash out of the P&amp;L. Avoided cost is spend you will not add. Productivity is recaptured capacity after a 50% recapture rate and a 15% TEI risk haircut. Revenue is contribution margin, never gross revenue.</p>`;
  }

  function activatePage(page) {
    $$(".page").forEach((item) => item.classList.remove("active"));
    $$(".nav-tab").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
    const pageId = page === "planner" ? "plannerPage" : page === "value" ? "valuePage" : "methodologyPage";
    document.getElementById(pageId).classList.add("active");
    $("#toast").classList.remove("show");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toast(message) {
    $("#toast").textContent = message;
    $("#toast").classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 2000);
  }

  $$("#workloadPicker button").forEach((button) => {
    button.addEventListener("click", () => {
      state.workloadId = button.dataset.workload;
      renderForm();
      renderResults();
      save();
    });
  });
  $$(".scenario-control button").forEach((button) => {
    button.addEventListener("click", () => {
      state.scenario = button.dataset.scenario;
      renderResults();
      save();
    });
  });
  $$(".nav-tab").forEach((button) =>
    button.addEventListener("click", () => activatePage(button.dataset.page))
  );
  $(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    activatePage("planner");
  });
  $("#accountDiscount").value = state.discountRate;
  $("#accountDiscount").addEventListener("input", (event) => {
    setAccountDiscount(event.target.value, event.target);
  });
  $("#resetButton").addEventListener("click", () => {
    state.values[state.workloadId] = { ...WORKLOADS[state.workloadId].defaults };
    state.values[state.workloadId].discountRate = state.discountRate;
    state.scenario = "regular";
    renderForm();
    renderResults();
    save();
    toast(`${WORKLOADS[state.workloadId].label} defaults restored`);
  });
  $("#exportButton").addEventListener("click", () => {
    const result = forecast(state.workloadId, state.values[state.workloadId], state.scenario);
    const exportData = {
      exportedAt: new Date().toISOString(),
      workload: state.workloadId,
      scenario: state.scenario,
      assumptions: state.values[state.workloadId],
      forecast: result.rows,
      value: result.value,
      notes: { guidance: result.guidance, caveat: result.caveat },
    };
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" }));
    link.download = `${state.workloadId}-12-month-sizing.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast("Sizing plan exported");
  });

  function updateRegionBadge() {
    const values = state.values[state.workloadId];
    const region = PRICING_REGIONS[values.pricingRegion] || PRICING_REGIONS["azure-north-europe"];
    const badge = $("#regionBadge");
    if (!badge) return;
    badge.querySelector("b").textContent = region.label;
    $("#regionPriceHint").textContent =
      `SQL $${Number(values.sqlListPricePerDbu || region.sqlListPricePerDbu).toFixed(2)} · Genie SRTI $${Number(values.genieListPricePerDbu || region.genieListPricePerDbu).toFixed(3)}`;
  }

  async function loadWorkspacePricing() {
    if (!(await checkBackend())) return;
    try {
      const prices = await fetchJson("api/pricing");
      if (!prices.genieListPricePerDbu && !prices.sqlListPricePerDbu) return;
      Object.values(state.values).forEach((values) => {
        if (prices.sqlListPricePerDbu) {
          values.sqlListPricePerDbu = prices.sqlListPricePerDbu;
          values.listPricePerDbu = prices.sqlListPricePerDbu;
        }
        if (prices.genieListPricePerDbu) values.genieListPricePerDbu = prices.genieListPricePerDbu;
      });
      const sqlInput = $("#field-sqlListPricePerDbu");
      const genieInput = $("#field-genieListPricePerDbu");
      const current = state.values[state.workloadId];
      if (sqlInput) sqlInput.value = current.sqlListPricePerDbu;
      if (genieInput) genieInput.value = current.genieListPricePerDbu;
      updateRegionBadge();
      renderResults();
      save();
    } catch {
      /* Static builds and missing grants keep the regional defaults. */
    }
  }

  renderForm();
  renderResults();
  updateRegionBadge();
  loadWorkspacePricing();
})();
