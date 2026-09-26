(function () {
  "use strict";

  const { WORKLOADS, DEFAULT_CREDIBILITY_K, forecast, formatNumber, formatCompact } = window.PortfolioModel;
  const CALIBRATION_KIND = { genie: "genie", aibi: "dashboard", apps: "app" };
  const KIND_LABEL = { genie: "Genie space", dashboard: "AI/BI dashboard", app: "Databricks App" };
  let backendAvailable = null;
  const sourceCache = {};
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const storageKey = "databricks-serving-layer-planner-v2";

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
    number("discountRate", "Account discount rate", "%", .5, "Enter the negotiated discount for this account"),
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
        values.pricingRegion = "azure-north-europe";
        if (!values.listPricePerDbu) values.listPricePerDbu = 0.91;
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
      <p class="calibration-intro">Pull the observed SQL rate for an existing ${KIND_LABEL[kind]} from system tables. The forecast blends it with the preset in proportion to how much evidence exists.</p>
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
        sourceSelect.innerHTML = `<option>No ${KIND_LABEL[kind]} SQL in the last ${days()} days</option>`;
        return;
      }
      sourceSelect.innerHTML = sources.map((source) =>
        `<option value="${escapeHtml(source.source_id)}">${escapeHtml(source.label)} · ${formatCompact(source.queries)} queries</option>`
      ).join("");
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
    const observation = blend?.observation;
    if (!observation) {
      target.innerHTML = `<p class="calibration-empty">No observation applied · forecast uses the preset rate${
        blend ? ` of ${formatNumber(blend.presetRate ?? blend.effectiveDbuPer1000Queries, 1)} DBU / 1K` : ""
      }.</p>`;
      return;
    }
    const range = result.annualCostRange;
    target.innerHTML = `
      <div class="calibration-source"><strong>${escapeHtml(observation.label)}</strong><span>${formatCompact(observation.queries)} queries over ${observation.active_days} active days</span></div>
      <dl class="calibration-stats">
        <div><dt>Observed</dt><dd>${formatNumber(observation.dbu_per_1k, 1)} DBU / 1K</dd></div>
        <div><dt>Daily P10–P90</dt><dd>${formatNumber(observation.p10_dbu_per_1k, 0)}–${formatNumber(observation.p90_dbu_per_1k, 0)}</dd></div>
        <div><dt>Preset</dt><dd>${formatNumber(blend.presetRate, 1)} DBU / 1K</dd></div>
        <div><dt>Observed weight</dt><dd>${formatNumber(blend.weight * 100, 0)}%</dd></div>
        <div class="wide"><dt>Blended rate used</dt><dd>${formatNumber(blend.rate, 1)} DBU / 1K</dd></div>
        ${range && result.hasPricing ? `<div class="wide"><dt>12-month cost band</dt><dd>${formatCurrency(range.low)} – ${formatCurrency(range.high)}</dd></div>` : ""}
      </dl>
      <small>Observed ${formatNumber(observation.queries_per_day, 0)} queries/day, ${formatNumber(observation.p95_runtime_s, 1)} s p95 runtime${
        observation.app_dbu_per_day ? `, ${formatNumber(observation.app_dbu_per_day, 1)} app runtime DBU/day` : ""
      }. Recalibrate monthly; investigate if the observed rate moves more than 15%.</small>`;
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
    if (result.hasPricing && result.annualCostRange) {
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

    $$("#workloadPicker button").forEach((button) => {
      const active = button.dataset.workload === state.workloadId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
    $$(".scenario-control button").forEach((button) => {
      button.classList.toggle("active", button.dataset.scenario === state.scenario);
    });
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
