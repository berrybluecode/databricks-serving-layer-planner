(function () {
  "use strict";

  const { WORKLOADS, forecast, formatNumber, formatCompact } = window.PortfolioModel;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const storageKey = "databricks-serving-layer-planner-v1";

  const number = (key, label, unit = "", step = 1, help = "") => ({
    key, label, unit, step, help, type: "number",
  });
  const select = (key, label, options, help = "") => ({
    key, label, options, help, type: "select",
  });
  const northEuropePricing = [
    select("pricingRegion", "Workspace pricing region", [
      ["azure-north-europe", "Azure North Europe · $0.91/DBU"],
    ], "Fixed to the PUMA workspace region"),
    number("listPricePerDbu", "DBU list price", "$/DBU", .01, "Azure North Europe list price"),
    number("discountRate", "Account discount rate", "%", .5),
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
    number("queriesPerPrompt", "SQL queries / prompt", "", .1),
    number("sqlDbuPer1000Queries", "Observed SQL DBUs / 1K queries", "DBU", .01),
    number("dbuPerMillionTokens", "Observed Genie DBUs / 1M weighted tokens", "DBU", .01, "Calibrate from a representative pilot"),
    ...northEuropePricing,
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
      { title: "Pilot calibration & rates", fields: genieCalibrationFields },
    ],
    aibi: [
      { title: "Interactive demand", fields: [
        number("viewers", "Monthly dashboard viewers", "users"),
        number("sessionsPerDay", "Sessions / viewer / day", "", .1),
        number("queriesPerSession", "Queries / session", "", .5),
        number("activeDays", "Active days / month", "days", 1),
        number("cacheMiss", "Warehouse cache-miss share", "%", 1),
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
      { title: "Azure North Europe pricing", fields: northEuropePricing },
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
      { title: "Azure North Europe pricing", fields: northEuropePricing },
    ],
    lakehouse: [
      { title: "Ingestion & retention", fields: [
        number("ingestionGbDay", "Raw ingestion / day", "GB", 10),
        number("initialStorageTb", "Existing active storage", "TB", .5),
        number("retentionDays", "Data retention", "days", 30),
        number("monthlyGrowth", "Monthly volume growth", "%", .5),
      ]},
      { title: "Physical storage factors", fields: [
        number("compressionFactor", "Stored / raw size", "%", 1),
        number("layerAmplification", "Bronze–Silver–Gold multiplier", "×", .1),
        number("copyMultiplier", "Copies / regions", "×", .1),
        number("dailyRewrite", "Data rewritten daily", "%", .1),
        number("deletedRetentionDays", "Deleted-file retention", "days", 1),
        number("metadataOverhead", "Metadata & checkpoint overhead", "%", .5),
      ]},
      { title: "Compute & Azure North Europe rates", fields: [
        number("computeDbuMonth", "Baseline compute DBUs / month", "DBU", 100),
        number("computeBaselineGbDay", "Baseline ingestion for those DBUs", "GB/day", 10),
        ...northEuropePricing,
        number("storagePriceTb", "Storage list price / TB-month", "$", .1),
      ]},
    ],
  };

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
      Object.values(mergedValues).forEach((values) => {
        if (!values.pricingRegion || values.listPricePerDbu === 0) {
          values.pricingRegion = "azure-north-europe";
          values.listPricePerDbu = 0.91;
        }
      });
      return {
        workloadId: saved?.workloadId && WORKLOADS[saved.workloadId] ? saved.workloadId : "genie-one",
        scenario: saved?.scenario || "base",
        values: mergedValues,
      };
    } catch {
      return { workloadId: "genie-one", scenario: "base", values: freshValues() };
    }
  }

  const state = loadState();

  function save() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function formatCurrency(value) {
    return Number(value).toLocaleString(undefined, {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    });
  }

  function createField(field) {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
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
      state.values[state.workloadId][field.key] =
        field.type === "select" ? input.value : Number(input.value);
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
    $("#resultFamily").textContent = `${workload.label} · ${state.scenario} scenario`;
    $("#resultTitle").textContent = `${workload.label} 12-month sizing`;
    $("#resultDescription").textContent = workload.description;
    $("#annualCost").textContent = result.hasPricing ? formatCurrency(result.annualCost) : "Add rates";
    $("#month12Cost").textContent = result.hasPricing
      ? `${formatCurrency(result.annualListCost)} list − ${formatCurrency(
          result.annualDiscountSavings
        )} discount · ${formatCurrency(result.month12Cost)} month 12 net`
      : "Unit forecasts remain available without pricing";

    $("#summaryCards").innerHTML = result.summary.map((item) =>
      `<article class="kpi"><span>${item.label}</span><strong>${item.value}</strong><small>Base on current assumptions</small></article>`
    ).join("");
    $("#projectionTitle").textContent = `${workload.label} demand growth`;
    $("#chartUnit").textContent = result.primaryLabel;
    $("#primaryColumn").textContent = result.primaryLabel;
    $("#guidanceText").textContent = result.guidance;
    $("#caveatText").textContent = result.caveat;
    renderWorkspaceBenchmark(result);
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

    $$("#workloadPicker button").forEach((button) => {
      const active = button.dataset.workload === state.workloadId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
    $$(".scenario-control button").forEach((button) => {
      button.classList.toggle("active", button.dataset.scenario === state.scenario);
    });
  }

  function renderWorkspaceBenchmark(result) {
    const card = $("#workspaceBenchmark");
    if (!["apps", "aibi"].includes(state.workloadId)) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const monthOne = result.rows[0];
    const actual = state.workloadId === "apps"
      ? { appDbu: 365, sqlDbu: 5972.91, lakebaseDbu: 1015.11 }
      : { queries: 50, avgRuntime: 3.12, p95Runtime: 6.96, scannedGb: 0.03 };
    if (state.workloadId === "apps") {
      const estimated = monthOne.appDbu + monthOne.sqlDbu + monthOne.lakebaseDbu;
      const actualComparable = actual.appDbu + actual.sqlDbu +
        (state.values.apps.lakebaseEnabled === "yes" ? actual.lakebaseDbu : 0);
      const deviation = actualComparable
        ? ((estimated - actualComparable) / actualComparable) * 100
        : 0;
      $("#benchmarkTitle").textContent = "DQX workspace app backtest";
      $("#benchmarkDescription").textContent =
        "Last 30 days from system.billing.usage, normalized to Azure North Europe pricing.";
      $("#benchmarkRows").innerHTML = `
        <tr><td>App runtime</td><td>${formatNumber(monthOne.appDbu, 1)} DBU</td><td>365.0 DBU</td></tr>
        <tr><td>SQL warehouse</td><td>${formatNumber(monthOne.sqlDbu, 1)} DBU</td><td>5,972.9 DBU</td></tr>
        <tr><td>Lakebase</td><td>${monthOne.lakebaseDbu ? `${formatNumber(monthOne.lakebaseDbu, 1)} DBU` : "Not enabled"}</td><td>1,015.1 DBU</td></tr>
        <tr><td>Total comparable</td><td>${formatNumber(estimated, 1)} DBU</td><td>${formatNumber(actualComparable, 1)} DBU</td></tr>`;
      $("#benchmarkDeviation").textContent =
        `${deviation >= 0 ? "+" : ""}${formatNumber(deviation, 0)}% estimate vs actual`;
    } else {
      const estimated = monthOne.queries;
      const deviation = ((estimated - actual.queries) / actual.queries) * 100;
      $("#benchmarkTitle").textContent = "DQX workspace AI/BI backtest";
      $("#benchmarkDescription").textContent =
        "Dashboard-only traffic on the DQX warehouse; shared app and ETL SQL is excluded.";
      $("#benchmarkRows").innerHTML = `
        <tr><td>Dashboard SELECTs</td><td>${formatNumber(estimated, 0)}</td><td>50</td></tr>
        <tr><td>Average runtime</td><td>${formatNumber(state.values.aibi.p95RuntimeSeconds / 2, 1)} sec planning proxy</td><td>${actual.avgRuntime} sec</td></tr>
        <tr><td>p95 runtime</td><td>${formatNumber(state.values.aibi.p95RuntimeSeconds, 1)} sec</td><td>${actual.p95Runtime} sec</td></tr>
        <tr><td>Data scanned</td><td>${formatNumber(estimated * state.values.aibi.dataScannedGbPerQuery, 2)} GB</td><td>${actual.scannedGb} GB</td></tr>`;
      $("#benchmarkDeviation").textContent =
        `${deviation >= 0 ? "+" : ""}${formatNumber(deviation, 0)}% query-volume deviation`;
    }
  }

  function activatePage(page) {
    $$(".page").forEach((item) => item.classList.remove("active"));
    $$(".nav-tab").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
    document.getElementById(page === "planner" ? "plannerPage" : "methodologyPage").classList.add("active");
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
  $("#resetButton").addEventListener("click", () => {
    state.values[state.workloadId] = { ...WORKLOADS[state.workloadId].defaults };
    state.scenario = "base";
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
      notes: { guidance: result.guidance, caveat: result.caveat },
    };
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" }));
    link.download = `${state.workloadId}-12-month-sizing.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast("Sizing plan exported");
  });

  renderForm();
  renderResults();
})();
