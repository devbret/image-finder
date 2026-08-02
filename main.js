const OUTPUT_BASE_URL = "output/";
const RUNS_INDEX_URL = `${OUTPUT_BASE_URL}runs.json`;
const PAGE_SIZE = 50;
const TOP_DOMAINS = 8;
const THEMES = ["auto", "light", "dark"];

const MAX_RUN_COLORS = 6;

const state = {
  runs: [],
  selectedRunIds: [],
  loadedRuns: [],
  multiRun: false,
  manualSource: null,
  results: [],
  summary: null,
  errors: null,
  errorsNote: "",
  errorsMissingRuns: [],
  search: "",
  query: "all",
  format: "all",
  runFilter: "all",
  chartQuery: "all",
  chartRun: "all",
  status: "all",
  sort: "rank",
  visibleCount: PAGE_SIZE,
  filtered: [],
  tab: "results",
  theme: "auto",
};

const els = {
  dropZone: document.getElementById("drop-zone"),
  fileInput: document.getElementById("file-input"),
  runPicker: document.getElementById("run-picker"),
  runPickerToggle: document.getElementById("run-picker-toggle"),
  runPickerMenu: document.getElementById("run-picker-menu"),
  runPickerList: document.getElementById("run-picker-list"),
  runPickerNote: document.getElementById("run-picker-note"),
  runBreakdown: document.getElementById("run-breakdown"),
  runFilter: document.getElementById("run-filter"),
  chartRunFilter: document.getElementById("chart-run-filter"),
  themeToggle: document.getElementById("theme-toggle"),
  dashboard: document.getElementById("dashboard"),
  summary: document.getElementById("summary"),
  tabs: document.querySelectorAll(".tabs [role='tab']"),
  errorBadge: document.getElementById("error-badge"),
  search: document.getElementById("search"),
  queryFilter: document.getElementById("query-filter"),
  formatFilter: document.getElementById("format-filter"),
  statusFilter: document.getElementById("status-filter"),
  sort: document.getElementById("sort"),
  resultCount: document.getElementById("result-count"),
  results: document.getElementById("results"),
  pager: document.getElementById("pager"),
  showMore: document.getElementById("show-more"),
  showAll: document.getElementById("show-all"),
  charts: document.getElementById("charts"),
  chartControls: document.getElementById("chart-controls"),
  chartQueryFilter: document.getElementById("chart-query-filter"),
  errorsContent: document.getElementById("errors-content"),
  tooltip: document.getElementById("tooltip"),
  lightbox: document.getElementById("lightbox"),
  lightboxImage: document.getElementById("lightbox-image"),
  lightboxCaption: document.getElementById("lightbox-caption"),
  lightboxClose: document.getElementById("lightbox-close"),
  lightboxPrev: document.getElementById("lightbox-prev"),
  lightboxNext: document.getElementById("lightbox-next"),
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatCompact(value) {
  const n = Number(value || 0);
  if (Math.abs(n) < 10000) return n.toLocaleString();
  return n.toLocaleString(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatBytesShort(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "";
  const units = [
    [1024 * 1024 * 1024, "GB"],
    [1024 * 1024, "MB"],
    [1024, "KB"],
  ];
  for (const [size, label] of units) {
    if (n >= size) {
      const scaled = n / size;
      const text =
        scaled >= 10 || Number.isInteger(scaled)
          ? String(Math.round(scaled))
          : scaled.toFixed(1);
      return `${text} ${label}`;
    }
  }
  return `${Math.round(n)} B`;
}

function decodeEntities(value) {
  if (!value || !value.includes("&")) return value;
  return (
    new DOMParser().parseFromString(value, "text/html").documentElement
      .textContent || value
  );
}

function safeHref(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {}
  return null;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname || "(unknown)";
  } catch {
    return "(unknown)";
  }
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showLoadError(message) {
  console.error(message);
  els.dropZone.hidden = false;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function skipReasonOf(item) {
  const err = item.error || "";
  const httpMatch = err.match(/^HTTP \d+/);
  if (httpMatch) return httpMatch[0];
  if (err.startsWith("Not an image")) return "Not an image";
  if (err.startsWith("Too large")) return "Too large";
  if (err.startsWith("Blocked domain")) return "Blocked domain";
  if (err.startsWith("Empty response")) return "Empty response";
  if (/timeout|timed out/i.test(err)) return "Timeout";
  if (/connection|refused|reset|max retries/i.test(err))
    return "Connection error";
  return err ? "Other error" : "Unknown";
}

const MIME_FORMATS = {
  jpg: "jpeg",
  jpeg: "jpeg",
  pjpeg: "jpeg",
  png: "png",
  gif: "gif",
  webp: "webp",
  bmp: "bmp",
  "x-ms-bmp": "bmp",
  "svg+xml": "svg",
  "x-icon": "ico",
  "vnd.microsoft.icon": "ico",
  tiff: "tiff",
  avif: "avif",
  heic: "heic",
};

function formatOf(item) {
  if (item.format) return String(item.format).toLowerCase();
  const mime = (item.mime || item.content_type || "").toLowerCase();
  const match = mime.match(/^image\/([\w.+-]+)/);
  if (match) return MIME_FORMATS[match[1]] || match[1];
  const fileFormat = (item.file_format || "").toLowerCase();
  const ffMatch = fileFormat.match(/image\/([\w.+-]+)/);
  if (ffMatch) return MIME_FORMATS[ffMatch[1]] || ffMatch[1];
  return "";
}

function parsePayload(payload) {
  const rows = Array.isArray(payload) ? payload : payload && payload.results;
  if (!Array.isArray(rows)) {
    throw new Error(
      "Expected an image_results JSON file with a 'results' array.",
    );
  }

  const results = rows.filter((row) => row && typeof row === "object");

  for (const item of results) {
    item.title = decodeEntities(item.title);
    item.snippet = decodeEntities(item.snippet);
    item._domain = hostnameOf(item.link || item.final_url || "");
    item._contextDomain = item.context_link
      ? hostnameOf(item.context_link)
      : "";
    item._bytes =
      Number(item.byte_size) ||
      Number(item.api_byte_size) ||
      Number(item.content_length) ||
      0;
    item._w = Number(item.width) || Number(item.api_width) || 0;
    item._h = Number(item.height) || Number(item.api_height) || 0;
    item._pixels = item._w * item._h;
    item._format = formatOf(item);
    item._reason = item.status === "skipped" ? skipReasonOf(item) : "";
    item._hay = [
      item.title,
      item.snippet,
      item.link,
      item.final_url,
      item.context_link,
      item.query,
      item._domain,
      item._contextDomain,
      item._format,
    ]
      .join("\n")
      .toLowerCase();
  }

  return {
    results,
    summary: Array.isArray(payload) ? null : payload.summary || null,
  };
}

function renderAll() {
  renderSummary();
  renderRunBreakdown();
  populateQueryFilter();
  populateFormatFilter();
  populateRunFilters();
  applyFilters();
  renderCharts();
  renderErrors();
}

function loadData(payload, sourceName, options = {}) {
  const { results, summary } = parsePayload(payload);

  state.results = results;
  state.summary = summary;
  state.errors = options.errors ?? null;
  state.errorsNote =
    options.errorsNote || "The search-errors file could not be loaded.";
  state.errorsMissingRuns = [];
  state.loadedRuns = [];
  state.multiRun = false;
  state.visibleCount = PAGE_SIZE;

  els.dropZone.hidden = true;
  els.dashboard.hidden = false;

  renderAll();
}

function loadFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadData(JSON.parse(reader.result), file.name, {
        errors: null,
        errorsNote:
          "Search errors are available when browsing runs served over HTTP.",
      });
      markManualSource(file.name);
    } catch (err) {
      showLoadError(`Could not read ${file.name}: ${err.message}`);
    }
  };
  reader.onerror = () => showLoadError(`Could not read ${file.name}.`);
  reader.readAsText(file);
}

function runLabel(run) {
  const date = run.generated_at ? new Date(run.generated_at) : null;
  const when =
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleString()
      : run.id || run.dir;
  const total = run.summary?.total_results;
  return total != null ? `${when} - ${formatNumber(total)} results` : when;
}

function runShortLabel(run) {
  const date = run.generated_at ? new Date(run.generated_at) : null;
  if (date && !Number.isNaN(date.getTime())) {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return run.id || run.dir;
}

function runById(id) {
  return state.runs.find((run) => run.id === id) || null;
}

const runColorSlots = new Map();

function assignRunSlot(id) {
  if (runColorSlots.has(id)) return;
  const used = new Set(runColorSlots.values());
  for (let slot = 1; slot <= MAX_RUN_COLORS; slot += 1) {
    if (!used.has(slot)) {
      runColorSlots.set(id, slot);
      return;
    }
  }
  runColorSlots.set(id, 0);
}

function runColorVar(id) {
  const slot = runColorSlots.get(id);
  return slot ? `var(--series-${slot})` : "var(--series-muted)";
}

function runColorValue(id) {
  const slot = runColorSlots.get(id);
  return getComputedStyle(document.documentElement)
    .getPropertyValue(slot ? `--series-${slot}` : "--series-muted")
    .trim();
}

function buildRunPicker(runs) {
  state.runs = runs;
  els.runPickerList.textContent = "";

  for (const run of runs) {
    const row = el("label", "run-option");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = run.id;
    checkbox.addEventListener("change", () =>
      setRunSelected(run.id, checkbox.checked),
    );
    row.appendChild(checkbox);
    row.appendChild(el("span", "run-dot"));

    const info = el("span", "run-option-info");
    info.appendChild(el("span", "run-option-title", runLabel(run)));
    row.appendChild(info);
    els.runPickerList.appendChild(row);
  }

  els.runPicker.hidden = false;
}

function updateRunPickerUI() {
  const selected = new Set(state.selectedRunIds);
  for (const row of els.runPickerList.querySelectorAll(".run-option")) {
    const checkbox = row.querySelector("input");
    const dot = row.querySelector(".run-dot");
    const isSelected = selected.has(checkbox.value);
    checkbox.checked = isSelected;
    dot.style.background = isSelected ? runColorVar(checkbox.value) : "";
  }

  let label;
  if (state.manualSource) {
    label = `File: ${state.manualSource}`;
  } else if (!selected.size) {
    label = "Choose runs…";
  } else if (selected.size === 1) {
    const run = runById(state.selectedRunIds[0]);
    label = run ? runShortLabel(run) : "1 run selected";
  } else {
    label = `${selected.size} runs selected`;
  }
  els.runPickerToggle.textContent = label;
}

function setRunMenuOpen(open) {
  els.runPickerMenu.hidden = !open;
  els.runPickerToggle.setAttribute("aria-expanded", String(open));
}

function setPickerNote(message) {
  els.runPickerNote.textContent = message;
  els.runPickerNote.hidden = !message;
}

function setRunSelected(id, selected) {
  state.manualSource = null;
  const current = new Set(state.selectedRunIds);
  if (selected) current.add(id);
  else current.delete(id);
  state.selectedRunIds = state.runs
    .filter((run) => current.has(run.id))
    .map((run) => run.id);

  if (selected) assignRunSlot(id);
  else runColorSlots.delete(id);

  setPickerNote("");
  updateRunPickerUI();
  applySelection();
}

function markManualSource(name) {
  state.manualSource = name;
  state.selectedRunIds = [];
  runColorSlots.clear();
  syncRunsParam();
  updateRunPickerUI();
}

function syncRunsParam() {
  const params = new URLSearchParams(window.location.search);
  if (state.selectedRunIds.length && !state.manualSource) {
    params.set("runs", state.selectedRunIds.join(","));
  } else {
    params.delete("runs");
  }
  const query = params.toString();
  try {
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  } catch {}
}

function errorsFileFor(run) {
  if (run.errors) return run.errors;
  if (run.manifest && run.manifest.startsWith("image_results_")) {
    return run.manifest.replace("image_results_", "search_errors_");
  }
  return null;
}

const runCache = new Map();

function loadRun(run) {
  if (!runCache.has(run.id)) {
    const promise = fetchRun(run).catch((err) => {
      runCache.delete(run.id);
      throw err;
    });
    runCache.set(run.id, promise);
  }
  return runCache.get(run.id);
}

async function fetchRun(run) {
  const base = `${OUTPUT_BASE_URL}${encodeURIComponent(run.dir)}/`;
  const payload = await fetchJson(base + encodeURIComponent(run.manifest));
  const { results, summary } = parsePayload(payload);
  const label = runShortLabel(run);
  for (const item of results) {
    item._runId = run.id;
    item._runLabel = label;
  }

  let errors = null;
  const errorsFile = errorsFileFor(run);
  if (errorsFile) {
    try {
      const parsed = await fetchJson(base + encodeURIComponent(errorsFile));
      if (Array.isArray(parsed)) {
        errors = parsed.filter((err) => err && typeof err === "object");
        for (const err of errors) {
          err._runId = run.id;
          err._runLabel = label;
        }
      }
    } catch {}
  }

  return { run, results, summary, errors };
}

function combineSummaries(loaded) {
  const combined = {
    total_results: 0,
    downloaded: 0,
    skipped: 0,
    total_bytes: 0,
    search_error_count: 0,
    generated_at: null,
  };
  let newest = -Infinity;
  for (const { summary, results } of loaded) {
    const s = summary || {};
    combined.total_results += s.total_results ?? results.length;
    combined.downloaded +=
      s.downloaded ?? results.filter((r) => r.status === "downloaded").length;
    combined.skipped +=
      s.skipped ?? results.filter((r) => r.status === "skipped").length;
    combined.total_bytes +=
      s.total_bytes ?? results.reduce((sum, r) => sum + (r._bytes || 0), 0);
    combined.search_error_count += s.search_error_count ?? 0;
    const time = s.generated_at ? Date.parse(s.generated_at) : NaN;
    if (Number.isFinite(time) && time > newest) {
      newest = time;
      combined.generated_at = s.generated_at;
    }
  }
  return combined;
}

let selectionGen = 0;

async function applySelection() {
  const gen = ++selectionGen;
  syncRunsParam();

  if (!state.selectedRunIds.length) {
    if (!state.manualSource) {
      state.results = [];
      state.loadedRuns = [];
      state.multiRun = false;
      els.dashboard.hidden = true;
      els.dropZone.hidden = false;
    }
    return;
  }

  els.dashboard.classList.add("loading");
  const runs = state.selectedRunIds.map((id) => runById(id)).filter(Boolean);
  const settled = await Promise.allSettled(runs.map((run) => loadRun(run)));
  if (gen !== selectionGen) return;
  els.dashboard.classList.remove("loading");

  const loaded = [];
  const failed = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") loaded.push(result.value);
    else failed.push(runs[index]);
  });

  if (failed.length) {
    const failedIds = new Set(failed.map((run) => run.id));
    state.selectedRunIds = state.selectedRunIds.filter(
      (id) => !failedIds.has(id),
    );
    for (const id of failedIds) runColorSlots.delete(id);
    updateRunPickerUI();
    setPickerNote(
      `Could not load: ${failed.map((run) => runShortLabel(run)).join(", ")}`,
    );
    syncRunsParam();
  }

  if (!loaded.length) {
    els.dashboard.hidden = true;
    els.dropZone.hidden = false;
    return;
  }

  showCombinedRuns(loaded);
}

function showCombinedRuns(loaded) {
  const multi = loaded.length > 1;
  state.multiRun = multi;
  state.loadedRuns = loaded;
  state.results = loaded.flatMap((entry) => entry.results);
  state.summary = multi ? combineSummaries(loaded) : loaded[0].summary;

  const withErrors = loaded.filter((entry) => entry.errors);
  state.errors = withErrors.length
    ? loaded.flatMap((entry) => entry.errors || [])
    : null;
  state.errorsNote = "The search-errors file could not be loaded.";
  state.errorsMissingRuns =
    withErrors.length && withErrors.length < loaded.length
      ? loaded
          .filter((entry) => !entry.errors)
          .map((entry) => runShortLabel(entry.run))
      : [];
  state.visibleCount = PAGE_SIZE;

  els.dropZone.hidden = true;
  els.dashboard.hidden = false;

  renderAll();
}

async function tryAutoLoad() {
  if (!window.location.protocol.startsWith("http")) return;

  try {
    const index = await fetchJson(RUNS_INDEX_URL);
    const runs = (index.runs || []).filter((run) => run.dir && run.manifest);
    for (const run of runs) {
      if (!run.id) run.id = run.dir;
    }
    if (!runs.length) return;

    buildRunPicker(runs);

    const requested = (
      new URLSearchParams(window.location.search).get("runs") || ""
    )
      .split(",")
      .filter(Boolean);
    const available = new Set(runs.map((run) => run.id));
    const valid = requested.filter((id) => available.has(id));
    const wanted = new Set(valid.length ? valid : [runs[0].id]);
    state.selectedRunIds = runs
      .filter((run) => wanted.has(run.id))
      .map((run) => run.id);

    for (const id of state.selectedRunIds) assignRunSlot(id);
    updateRunPickerUI();
    await applySelection();
  } catch {}
}

function addStat(value, label, detail) {
  const stat = el("div", "stat");
  stat.appendChild(el("div", "stat-value", value));
  if (detail) stat.appendChild(el("div", "stat-detail", detail));
  stat.appendChild(el("div", "stat-label", label));
  els.summary.appendChild(stat);
}

function renderSummary() {
  els.summary.textContent = "";

  const results = state.results;
  const summary = state.summary || {};
  const total = summary.total_results ?? results.length;
  const downloaded =
    summary.downloaded ??
    results.filter((r) => r.status === "downloaded").length;
  const skipped =
    summary.skipped ?? results.filter((r) => r.status === "skipped").length;
  const bytes =
    summary.total_bytes ?? results.reduce((sum, r) => sum + (r._bytes || 0), 0);
  const domains = new Set(results.map((r) => r._domain)).size;
  const rate = total ? Math.round((downloaded / total) * 100) : 0;

  if (state.multiRun) {
    addStat(formatNumber(state.loadedRuns.length), "Runs compared");
  }
  addStat(formatNumber(total), "Results");
  addStat(formatNumber(downloaded), "Downloaded", `${rate}% of results`);
  addStat(formatNumber(skipped), "Skipped");
  addStat(formatBytesShort(bytes) || "0 B", "Image data");
  addStat(formatNumber(domains), "Unique domains");

  if (!state.multiRun && summary.generated_at) {
    const generated = new Date(summary.generated_at);
    if (!Number.isNaN(generated.getTime())) {
      addStat(
        generated.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        "Generated",
        generated.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
    }
  }
}

function renderRunBreakdown() {
  const box = els.runBreakdown;
  box.textContent = "";
  box.hidden = !state.multiRun;
  if (!state.multiRun) return;

  const scroll = el("div", "table-scroll");
  const table = el("table", "data-table");
  const thead = el("thead");
  const headRow = el("tr");
  const headers = [
    { label: "Run" },
    { label: "Queries" },
    { label: "Results", num: true },
    { label: "Downloaded", num: true },
    { label: "Skipped", num: true },
    { label: "Size", num: true },
  ];
  for (const h of headers) {
    headRow.appendChild(el("th", h.num ? "num" : "", h.label));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const entry of state.loadedRuns) {
    const { run, results } = entry;
    const s = entry.summary || {};
    const downloaded =
      s.downloaded ?? results.filter((r) => r.status === "downloaded").length;
    const skipped =
      s.skipped ?? results.filter((r) => r.status === "skipped").length;
    const bytes =
      s.total_bytes ?? results.reduce((sum, r) => sum + (r._bytes || 0), 0);

    const tr = el("tr");
    const runCell = el("td");
    const dot = el("span", "run-dot");
    dot.style.background = runColorVar(run.id);
    runCell.appendChild(dot);
    runCell.appendChild(document.createTextNode(runShortLabel(run)));
    tr.appendChild(runCell);
    tr.appendChild(el("td", "", (run.queries || []).join(", ")));
    tr.appendChild(
      el("td", "num", formatNumber(s.total_results ?? results.length)),
    );
    tr.appendChild(el("td", "num", formatNumber(downloaded)));
    tr.appendChild(el("td", "num", formatNumber(skipped)));
    tr.appendChild(el("td", "num", formatBytesShort(bytes) || "0 B"));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  box.appendChild(scroll);
}

function setTab(name) {
  state.tab = name;
  for (const tab of els.tabs) {
    const active = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(active));
    const panel = document.getElementById(`panel-${tab.dataset.tab}`);
    if (panel) panel.hidden = !active;
  }
}

function applyTheme(theme) {
  state.theme = THEMES.includes(theme) ? theme : "auto";
  if (state.theme === "auto") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = state.theme;
  }
  const label = state.theme[0].toUpperCase() + state.theme.slice(1);
  els.themeToggle.textContent = `Theme: ${label}`;
  try {
    localStorage.setItem("imgf-theme", state.theme);
  } catch {}
}

function populateQueryFilter() {
  const queries = [
    ...new Set(state.results.map((r) => r.query).filter(Boolean)),
  ];

  const fill = (select) => {
    select.textContent = "";
    const allOption = el("option", "", "All queries");
    allOption.value = "all";
    select.appendChild(allOption);
    for (const query of queries) {
      const option = el("option", "", query);
      option.value = `q:${query}`;
      select.appendChild(option);
    }
    select.value = "all";
  };

  fill(els.queryFilter);
  fill(els.chartQueryFilter);
  els.chartQueryFilter.hidden = queries.length < 2;
  els.chartControls.hidden = queries.length < 2 && !state.multiRun;

  state.query = "all";
  state.chartQuery = "all";
  state.status = "all";
  els.statusFilter.value = "all";
  state.search = "";
  els.search.value = "";
}

function populateFormatFilter() {
  const counts = new Map();
  for (const item of state.results) {
    if (!item._format) continue;
    counts.set(item._format, (counts.get(item._format) || 0) + 1);
  }
  const formats = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([fmt]) => fmt);

  els.formatFilter.textContent = "";
  const allOption = el("option", "", "All formats");
  allOption.value = "all";
  els.formatFilter.appendChild(allOption);
  for (const fmt of formats) {
    const option = el("option", "", fmt.toUpperCase());
    option.value = `f:${fmt}`;
    els.formatFilter.appendChild(option);
  }
  els.formatFilter.value = "all";
  els.formatFilter.hidden = formats.length < 2;
  state.format = "all";
}

function populateRunFilters() {
  const multi = state.multiRun;
  const fill = (select) => {
    select.textContent = "";
    const allOption = el(
      "option",
      "",
      `All ${formatNumber(state.loadedRuns.length)} runs`,
    );
    allOption.value = "all";
    select.appendChild(allOption);
    for (const entry of state.loadedRuns) {
      const option = el("option", "", runShortLabel(entry.run));
      option.value = entry.run.id;
      select.appendChild(option);
    }
    select.value = "all";
    select.hidden = !multi;
  };

  fill(els.runFilter);
  fill(els.chartRunFilter);
  state.runFilter = "all";
  state.chartRun = "all";
}

function matchesSearch(item, needle) {
  return item._hay.includes(needle);
}

function applyFilters() {
  const needle = state.search.trim().toLowerCase();

  const items = state.results.filter((item) => {
    if (state.runFilter !== "all" && item._runId !== state.runFilter)
      return false;
    if (state.query !== "all" && item.query !== state.query.slice(2))
      return false;
    if (state.format !== "all" && item._format !== state.format.slice(2))
      return false;
    if (state.status !== "all" && item.status !== state.status) return false;
    if (needle && !matchesSearch(item, needle)) return false;
    return true;
  });

  if (state.sort === "rank") {
    items.sort((a, b) => (a.search_rank || 0) - (b.search_rank || 0));
  } else if (state.sort === "size") {
    items.sort((a, b) => (b._bytes || 0) - (a._bytes || 0));
  } else if (state.sort === "pixels") {
    items.sort((a, b) => (b._pixels || 0) - (a._pixels || 0));
  } else if (state.sort === "title") {
    items.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else if (state.sort === "domain") {
    items.sort((a, b) => a._domain.localeCompare(b._domain));
  }

  state.filtered = items;
  if (!els.lightbox.hidden) closeLightbox();
  renderResults();
}

function addMetaBadge(container, text, className) {
  container.appendChild(
    el("span", className ? `badge ${className}` : "", text),
  );
}

function addDetail(dl, term, value) {
  if (value === undefined || value === null || value === "") return;
  dl.appendChild(el("dt", "", term));
  dl.appendChild(el("dd", "", String(value)));
}

function dimsLabel(width, height) {
  return width && height ? `${width}×${height}` : "";
}

function buildDetails(item) {
  const dl = el("dl", "card-details");
  addDetail(dl, "Search page", item.page_number);
  addDetail(dl, "Search rank", item.search_rank);
  addDetail(dl, "Rank on page", item.source_rank);
  addDetail(dl, "Format", item._format ? item._format.toUpperCase() : "");
  addDetail(dl, "Dimensions", dimsLabel(item.width, item.height));
  if (
    item.api_width &&
    (item.api_width !== item.width || item.api_height !== item.height)
  ) {
    addDetail(dl, "API dimensions", dimsLabel(item.api_width, item.api_height));
  }
  addDetail(
    dl,
    "File size",
    item.byte_size != null ? formatBytes(item.byte_size) : "",
  );
  if (item.api_byte_size != null && item.api_byte_size !== item.byte_size) {
    addDetail(dl, "API file size", formatBytes(item.api_byte_size));
  }
  addDetail(dl, "HTTP status", item.http_status);
  addDetail(dl, "Content type", item.content_type);
  addDetail(
    dl,
    "Content length",
    item.content_length != null ? formatBytes(item.content_length) : "",
  );
  if (item.fetched_at) {
    const fetched = new Date(item.fetched_at);
    if (!Number.isNaN(fetched.getTime())) {
      addDetail(dl, "Fetched", fetched.toLocaleString());
    }
  }
  if (item.final_url && item.final_url !== item.link) {
    addDetail(dl, "Final URL", item.final_url);
  }
  addDetail(dl, "Page URL", item.context_link);
  if (item.sha256) addDetail(dl, "SHA-256", item.sha256.slice(0, 16) + "...");
  addDetail(dl, "Saved as", item.saved_as);
  return dl;
}

function addToggle(actions, body, label, build) {
  const toggle = el("button", "ghost-button", `Show ${label}`);
  toggle.type = "button";
  actions.appendChild(toggle);

  let block = null;
  toggle.addEventListener("click", () => {
    if (!block) {
      block = build();
      body.appendChild(block);
      toggle.textContent = `Hide ${label}`;
    } else {
      block.hidden = !block.hidden;
      toggle.textContent = block.hidden ? `Show ${label}` : `Hide ${label}`;
    }
  });
}

function savedAsSrc(item) {
  if (
    item.status === "downloaded" &&
    item.saved_as &&
    window.location.protocol.startsWith("http")
  ) {
    return encodeURI(item.saved_as);
  }
  return null;
}

function thumbCandidates(item) {
  const out = [];
  const saved = savedAsSrc(item);
  if (saved) out.push(saved);
  if (item.thumbnail_link) out.push(item.thumbnail_link);
  const href = safeHref(item.link || "");
  if (href) out.push(href);
  return out;
}

function lightboxCandidates(item) {
  const out = [];
  const saved = savedAsSrc(item);
  if (saved) out.push(saved);
  const href = safeHref(item.link || "");
  if (href) out.push(href);
  if (item.thumbnail_link) out.push(item.thumbnail_link);
  return out;
}

function thumbPlaceholderText(item) {
  if (item.status === "skipped") return item._reason || "No preview";
  if (item.status === "not_downloaded") return "Not downloaded";
  return "No preview";
}

function attachThumbImage(button, item) {
  const candidates = thumbCandidates(item);
  const showPlaceholder = () => {
    button.appendChild(
      el("div", "thumb-placeholder", thumbPlaceholderText(item)),
    );
  };

  if (!candidates.length) {
    showPlaceholder();
    return;
  }

  const img = el("img", "thumb-img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = item.title || "";
  let index = 0;
  img.onerror = () => {
    index += 1;
    if (index < candidates.length) {
      img.src = candidates[index];
    } else {
      img.onerror = null;
      img.remove();
      showPlaceholder();
    }
  };
  img.src = candidates[0];
  button.appendChild(img);
}

function buildCard(item) {
  const card = el("li", "card");

  const thumb = el("button", "card-thumb");
  thumb.type = "button";
  thumb.title = "Preview image";
  thumb.setAttribute(
    "aria-label",
    `Preview: ${item.title || item.link || "image"}`,
  );
  attachThumbImage(thumb, item);
  thumb.appendChild(el("span", "card-rank", `#${item.search_rank || "?"}`));
  thumb.addEventListener("click", () => {
    const index = state.filtered.indexOf(item);
    if (index >= 0) openLightbox(index);
  });
  card.appendChild(thumb);

  const body = el("div", "card-body");
  card.appendChild(body);

  const pageUrl = item.context_link || "";
  const imageUrl = item.link || item.final_url || "";
  const titleText = item.title || imageUrl || "(untitled)";

  const title = el("h2", "card-title");
  const titleHref = safeHref(pageUrl) || safeHref(imageUrl);
  if (titleHref) {
    const link = el("a", "", titleText);
    link.href = titleHref;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    title.appendChild(link);
  } else {
    title.textContent = titleText;
  }
  body.appendChild(title);

  if (imageUrl) {
    const urlLine = el("p", "card-url", imageUrl);
    urlLine.title =
      item.final_url && item.final_url !== imageUrl
        ? `Final URL: ${item.final_url}`
        : imageUrl;
    body.appendChild(urlLine);
  }

  const meta = el("div", "card-meta");
  body.appendChild(meta);

  const status = item.status || "unknown";
  addMetaBadge(meta, status.replace("_", " "), `badge-${status}`);
  if (state.multiRun && item._runLabel) {
    const badge = el("span", "badge badge-run");
    const dot = el("span", "run-dot");
    dot.style.background = runColorVar(item._runId);
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode(item._runLabel));
    meta.appendChild(badge);
  }
  if (item.query) addMetaBadge(meta, item.query, "badge-query");
  if (item._format) {
    addMetaBadge(meta, item._format.toUpperCase(), "badge-format");
  }
  if (imageUrl) meta.appendChild(el("span", "", item._domain));
  if (item._w && item._h) {
    meta.appendChild(el("span", "", dimsLabel(item._w, item._h)));
  }
  if (item._bytes) {
    meta.appendChild(el("span", "", formatBytesShort(item._bytes)));
  }
  if (item.http_status) {
    meta.appendChild(el("span", "", `HTTP ${item.http_status}`));
  }
  if (item.error && item.error !== `HTTP ${item.http_status}`) {
    meta.appendChild(el("span", "card-error", item.error));
  }

  const actions = el("div", "card-actions");
  body.appendChild(actions);
  addToggle(actions, body, "details", () => buildDetails(item));

  return card;
}

function renderResults() {
  const items = state.filtered;
  const visible = items.slice(0, state.visibleCount);
  const filteredNote =
    items.length !== state.results.length
      ? ` matching (${formatNumber(state.results.length)} total)`
      : "";

  els.resultCount.textContent = items.length
    ? `Showing ${formatNumber(visible.length)} of ${formatNumber(
        items.length,
      )} images${filteredNote}`
    : "No images match the current filters.";

  els.results.textContent = "";
  const fragment = document.createDocumentFragment();
  for (const item of visible) {
    fragment.appendChild(buildCard(item));
  }
  els.results.appendChild(fragment);

  els.pager.hidden = visible.length >= items.length;
}

let lightboxIndex = -1;
let lightboxReturnFocus = null;

function renderLightboxImage(item) {
  const candidates = lightboxCandidates(item);
  const img = els.lightboxImage;
  let index = 0;
  img.onerror = () => {
    index += 1;
    if (index < candidates.length) {
      img.src = candidates[index];
    } else {
      img.onerror = null;
    }
  };
  img.alt = item.title || "";
  if (candidates.length) {
    img.src = candidates[0];
  } else {
    img.onerror = null;
    img.removeAttribute("src");
  }
}

function renderLightboxCaption(item) {
  const caption = els.lightboxCaption;
  caption.textContent = "";
  caption.appendChild(el("div", "", item.title || "(untitled)"));

  const metaParts = [
    item._domain,
    dimsLabel(item._w, item._h),
    item._bytes ? formatBytesShort(item._bytes) : "",
    item._format ? item._format.toUpperCase() : "",
    item.query ? `"${item.query}"` : "",
  ].filter(Boolean);
  if (metaParts.length) {
    caption.appendChild(el("div", "lightbox-meta", metaParts.join(" · ")));
  }

  const links = el("div", "");
  const imageHref = safeHref(item.link || item.final_url || "");
  if (imageHref) {
    const link = el("a", "", "Open image");
    link.href = imageHref;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    links.appendChild(link);
  }
  const pageHref = safeHref(item.context_link || "");
  if (pageHref) {
    if (links.childNodes.length) {
      links.appendChild(document.createTextNode(" · "));
    }
    const link = el("a", "", "Open page");
    link.href = pageHref;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    links.appendChild(link);
  }
  if (links.childNodes.length) caption.appendChild(links);
}

function renderLightbox() {
  const item = state.filtered[lightboxIndex];
  if (!item) return;
  renderLightboxImage(item);
  renderLightboxCaption(item);
}

function openLightbox(index) {
  if (!state.filtered.length) return;
  lightboxIndex = Math.max(0, Math.min(state.filtered.length - 1, index));
  lightboxReturnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  renderLightbox();
  els.lightbox.hidden = false;
  document.body.classList.add("lightbox-open");
  els.lightboxClose.focus();
}

function closeLightbox() {
  els.lightbox.hidden = true;
  document.body.classList.remove("lightbox-open");
  els.lightboxImage.onerror = null;
  els.lightboxImage.removeAttribute("src");
  lightboxIndex = -1;
  if (lightboxReturnFocus && document.contains(lightboxReturnFocus)) {
    lightboxReturnFocus.focus();
  }
  lightboxReturnFocus = null;
}

function stepLightbox(delta) {
  const total = state.filtered.length;
  if (!total || lightboxIndex < 0) return;
  lightboxIndex = (lightboxIndex + delta + total) % total;
  renderLightbox();
}

function positionTooltip(x, y) {
  const tip = els.tooltip;
  const rect = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + rect.width > window.innerWidth - 8) {
    left = Math.max(8, x - rect.width - 14);
  }
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, y - rect.height - 14);
  }
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function showTooltip(title, rows, x, y) {
  const tip = els.tooltip;
  tip.textContent = "";
  tip.appendChild(el("div", "tooltip-title", title));

  for (const row of rows) {
    const line = el("div", "tooltip-row");
    if (row.color) {
      const key = el("span", "tooltip-key");
      key.style.background = row.color;
      line.appendChild(key);
    }
    line.appendChild(el("span", "tooltip-value", row.value));
    line.appendChild(el("span", "", row.label));
    tip.appendChild(line);
  }

  tip.hidden = false;
  positionTooltip(x, y);
}

function hideTooltip() {
  els.tooltip.hidden = true;
}

function seriesColor(cls) {
  const styles = getComputedStyle(document.documentElement);
  return cls === "seg-accent"
    ? styles.getPropertyValue("--accent").trim()
    : styles.getPropertyValue("--series-muted").trim();
}

function buildBarChart({ title, series, rows, tableOnlyRows = [] }) {
  const card = el("section", "chart-card");
  card.appendChild(el("h3", "chart-title", title));

  if (series.length > 1) {
    const legend = el("div", "chart-legend");
    for (const s of series) {
      const item = el("span", "legend-item");
      const swatch = el("span", `legend-swatch ${s.cls}`);
      swatch.classList.add("bar-seg");
      swatch.style.height = "10px";
      item.appendChild(swatch);
      item.appendChild(el("span", "", s.label));
      legend.appendChild(item);
    }
    card.appendChild(legend);
  }

  const max = Math.max(
    1,
    ...rows.map((row) => row.values.reduce((a, b) => a + b, 0)),
  );

  const rowsBox = el("div", "chart-rows");
  for (const row of rows) {
    const total = row.values.reduce((a, b) => a + b, 0);
    const bar = el("div", "bar-row");
    bar.tabIndex = 0;

    const parts = series
      .map((s, i) => ({ s, value: row.values[i] }))
      .filter((p) => p.value > 0);
    bar.setAttribute(
      "aria-label",
      `${row.label}: ` +
        (parts.length
          ? parts.map((p) => `${formatNumber(p.value)} ${p.s.label}`).join(", ")
          : "0"),
    );

    const label = el("span", "bar-label", row.label);
    label.title = row.label;
    bar.appendChild(label);

    const track = el("div", "bar-track");
    parts.forEach((part, i) => {
      const seg = el("span", `bar-seg ${part.s.cls}`);
      seg.style.flex = `0 1 ${(part.value / max) * 100}%`;
      seg.style.minWidth = "3px";
      if (i === parts.length - 1) seg.classList.add("seg-end");
      track.appendChild(seg);
    });
    bar.appendChild(track);

    bar.appendChild(el("span", "bar-value", formatNumber(total)));

    const tooltipRows = () =>
      series
        .map((s, i) => ({
          value: formatNumber(row.values[i]),
          label: s.label,
          color: seriesColor(s.cls),
        }))
        .concat(
          series.length > 1
            ? [{ value: formatNumber(total), label: "total" }]
            : [],
        );

    bar.addEventListener("pointermove", (event) =>
      showTooltip(row.label, tooltipRows(), event.clientX, event.clientY),
    );
    bar.addEventListener("pointerleave", hideTooltip);
    bar.addEventListener("focus", () => {
      const rect = bar.getBoundingClientRect();
      showTooltip(row.label, tooltipRows(), rect.left, rect.bottom);
    });
    bar.addEventListener("blur", hideTooltip);

    rowsBox.appendChild(bar);
  }
  card.appendChild(rowsBox);

  const details = el("details", "chart-table");
  details.appendChild(el("summary", "", "View as table"));
  const scroll = el("div", "table-scroll");
  const table = el("table", "data-table");
  const thead = el("thead");
  const headRow = el("tr");
  headRow.appendChild(el("th", "", "Category"));
  for (const s of series) headRow.appendChild(el("th", "num", s.label));
  if (series.length > 1) headRow.appendChild(el("th", "num", "Total"));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (const row of rows.concat(tableOnlyRows)) {
    const tr = el("tr");
    tr.appendChild(el("td", "", row.label));
    row.values.forEach((v) => tr.appendChild(el("td", "num", formatNumber(v))));
    if (series.length > 1) {
      tr.appendChild(
        el("td", "num", formatNumber(row.values.reduce((a, b) => a + b, 0))),
      );
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  details.appendChild(scroll);
  card.appendChild(details);

  return card;
}

function buildDomainsChart(domains, series, splitOf, expanded) {
  const shown = expanded ? domains : domains.slice(0, TOP_DOMAINS);
  const rest = expanded ? [] : domains.slice(TOP_DOMAINS);

  const card = buildBarChart({
    title: "Top Domains",
    series,
    rows: shown.map(([domain, items]) => ({
      label: domain,
      values: splitOf(items),
    })),
    tableOnlyRows: rest.length
      ? [
          {
            label: `All other domains (${formatNumber(rest.length)})`,
            values: splitOf(rest.flatMap(([, items]) => items)),
          },
        ]
      : [],
  });

  if (domains.length > TOP_DOMAINS) {
    const footer = el("div", "chart-footer");
    const toggle = el(
      "button",
      "ghost-button",
      expanded
        ? `See top ${TOP_DOMAINS}`
        : `See all ${formatNumber(domains.length)} domains`,
    );
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      card.replaceWith(buildDomainsChart(domains, series, splitOf, !expanded));
    });
    footer.appendChild(toggle);
    card.insertBefore(footer, card.querySelector("details.chart-table"));
  }

  return card;
}

const VIZ_MIN_WIDTH = 120;
const VIZ_FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
const VIZ_FONT_SEMIBOLD = `600 ${VIZ_FONT}`;

const chartDrawers = new Map();
const chartObserver =
  "ResizeObserver" in window
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const rec = chartDrawers.get(entry.target);
          if (!rec) continue;
          const width = Math.floor(entry.contentRect.width);
          if (width < VIZ_MIN_WIDTH || Math.abs(width - rec.width) < 2) {
            continue;
          }
          rec.width = width;
          if (!rec.raf) {
            rec.raf = requestAnimationFrame(() => {
              rec.raf = 0;
              rec.draw(rec.width);
            });
          }
        }
      })
    : null;

function clearCharts() {
  for (const rec of chartDrawers.values()) {
    if (rec.raf) cancelAnimationFrame(rec.raf);
  }
  chartDrawers.clear();
  if (chartObserver) chartObserver.disconnect();
}

let vizTextCtx = null;
function measureVizText(text, font) {
  if (!vizTextCtx) {
    vizTextCtx = document.createElement("canvas").getContext("2d");
  }
  vizTextCtx.font = font || VIZ_FONT;
  return vizTextCtx.measureText(text).width;
}

function vizCard(title) {
  const card = el("section", "chart-card");
  card.appendChild(el("h3", "chart-title", title));
  const body = el("div", "viz");
  card.appendChild(body);
  return { card, body };
}

function buildLegend(series) {
  const legend = el("div", "chart-legend");
  for (const s of series) {
    const item = el("span", "legend-item");
    const swatch = el("span", `legend-swatch bar-seg ${s.cls}`);
    swatch.style.height = "10px";
    item.appendChild(swatch);
    item.appendChild(el("span", "", s.label));
    legend.appendChild(item);
  }
  return legend;
}

function registerViz(card, body, draw) {
  const rec = {
    width: 0,
    raf: 0,
    measure: () => Math.floor(body.clientWidth),
    draw(width) {
      body.textContent = "";
      draw(body, width);
    },
  };
  chartDrawers.set(card, rec);
  if (chartObserver) chartObserver.observe(card);
  const width = rec.measure();
  if (width >= VIZ_MIN_WIDTH) {
    rec.width = width;
    rec.draw(width);
  }
}

function appendChartTable(card, headers, rows) {
  const details = el("details", "chart-table");
  details.appendChild(el("summary", "", "View as table"));
  const scroll = el("div", "table-scroll");
  const table = el("table", "data-table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const h of headers) {
    headRow.appendChild(el("th", h.num ? "num" : "", h.label));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    row.forEach((value, i) => {
      tr.appendChild(
        el("td", headers[i] && headers[i].num ? "num" : "", String(value)),
      );
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  details.appendChild(scroll);
  card.appendChild(details);
}

function clientPoint(svgNode, x, y) {
  const rect = svgNode.getBoundingClientRect();
  return [rect.left + x, rect.top + y];
}

function roundedTopBarPath(x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  return (
    `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
    `L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
  );
}

function drawYAxisGrid(
  svg,
  scale,
  { left, right, ticks = 4, format = formatCompact, tickValues },
) {
  const axis = d3
    .axisLeft(scale)
    .tickSize(-(right - left))
    .tickPadding(8)
    .tickFormat(format);
  axis.tickValues(tickValues || scale.ticks(ticks).filter(Number.isInteger));
  const g = svg
    .append("g")
    .attr("class", "viz-axis")
    .attr("transform", `translate(${left},0)`)
    .call(axis);
  g.select(".domain").remove();
  return g;
}

function drawXAxis(svg, scale, { y, ticks, format, tickValues }) {
  const axis = d3.axisBottom(scale).tickSize(0).tickPadding(8);
  if (tickValues) axis.tickValues(tickValues);
  else if (ticks != null) axis.ticks(ticks);
  if (format) axis.tickFormat(format);
  const g = svg
    .append("g")
    .attr("class", "viz-axis")
    .attr("transform", `translate(0,${y})`)
    .call(axis);
  g.select(".domain").remove();
  return g;
}

function drawBaseline(svg, x0, x1, y) {
  svg
    .append("line")
    .attr("class", "viz-baseline")
    .attr("x1", x0)
    .attr("x2", x1)
    .attr("y1", y)
    .attr("y2", y);
}

function formatElapsed(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

function buildTimelineChart(results, series) {
  const events = results
    .map((r) => ({ item: r, time: Date.parse(r.fetched_at || "") }))
    .filter((e) => Number.isFinite(e.time))
    .sort((a, b) => a.time - b.time);
  if (events.length < 2) return null;

  const t0 = events[0].time;
  let downloadedCum = 0;
  let restCum = 0;
  const points = events.map((e) => {
    if (e.item.status === "downloaded") downloadedCum += 1;
    else restCum += 1;
    return {
      seconds: (e.time - t0) / 1000,
      downloaded: downloadedCum,
      rest: restCum,
      time: e.time,
      item: e.item,
    };
  });
  const duration = points[points.length - 1].seconds;

  const { card, body } = vizCard("Fetch Timeline");
  card.insertBefore(buildLegend(series), body);

  registerViz(card, body, (host, width) => {
    const height = 260;
    const margin = { top: 16, right: 116, bottom: 34, left: 46 };
    const x = d3
      .scaleLinear()
      .domain([0, Math.max(duration, 1)])
      .range([margin.left, width - margin.right]);
    const y = d3
      .scaleLinear()
      .domain([0, Math.max(downloadedCum, restCum, 1)])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const svg = d3
      .select(host)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        `Fetch timeline: ${formatNumber(downloadedCum)} ${series[0].label.toLowerCase()} and ` +
          `${formatNumber(restCum)} ${series[1].label.toLowerCase()} images over ` +
          `${formatElapsed(duration)}. Use arrow keys to step through the run.`,
      );

    drawYAxisGrid(svg, y, { left: margin.left, right: width - margin.right });
    const seen = new Set();
    const timeTicks = x
      .ticks(Math.max(3, Math.min(8, Math.floor(width / 90))))
      .filter((t) => {
        const label = formatElapsed(t);
        if (seen.has(label)) return false;
        seen.add(label);
        return true;
      });
    drawXAxis(svg, x, {
      y: height - margin.bottom,
      tickValues: timeTicks,
      format: formatElapsed,
    });
    drawBaseline(svg, margin.left, width - margin.right, y(0));

    const lines = [
      {
        key: "downloaded",
        cls: "viz-line-accent",
        dotCls: "viz-dot-accent",
        label: series[0].label,
        last: downloadedCum,
      },
      {
        key: "rest",
        cls: "viz-line-muted",
        dotCls: "viz-dot-muted",
        label: series[1].label,
        last: restCum,
      },
    ];
    const linePoints = [{ seconds: 0, downloaded: 0, rest: 0 }, ...points];
    for (const l of lines) {
      const gen = d3
        .line()
        .x((p) => x(p.seconds))
        .y((p) => y(p[l.key]))
        .curve(d3.curveStepAfter);
      svg
        .append("path")
        .attr("class", `viz-line ${l.cls}`)
        .attr("d", gen(linePoints));
    }

    const xEnd = x(duration);
    const endLabelY = lines.map((l) => y(l.last));
    if (Math.abs(endLabelY[0] - endLabelY[1]) < 14) {
      const mid = (endLabelY[0] + endLabelY[1]) / 2;
      const upper = endLabelY[0] <= endLabelY[1] ? 0 : 1;
      endLabelY[upper] = mid - 7;
      endLabelY[1 - upper] = mid + 7;
    }
    lines.forEach((l, i) => {
      svg
        .append("circle")
        .attr("class", `viz-dot ${l.dotCls}`)
        .attr("cx", xEnd)
        .attr("cy", y(l.last))
        .attr("r", 4);
      svg
        .append("text")
        .attr("class", "viz-end-label")
        .attr("x", xEnd + 10)
        .attr("y", endLabelY[i] + 4)
        .text(`${formatNumber(l.last)} ${l.label.toLowerCase()}`);
    });

    const crosshair = svg
      .append("line")
      .attr("class", "viz-crosshair")
      .attr("y1", margin.top)
      .attr("y2", height - margin.bottom)
      .attr("visibility", "hidden");
    const hoverDots = lines.map((l) =>
      svg
        .append("circle")
        .attr("class", `viz-dot ${l.dotCls}`)
        .attr("r", 4)
        .attr("visibility", "hidden"),
    );

    const bisect = d3.bisector((p) => p.seconds).center;
    let focusIndex = -1;

    const showAt = (index, clientX, clientY) => {
      const p = points[index];
      if (!p) return;
      const px = x(p.seconds);
      crosshair.attr("x1", px).attr("x2", px).attr("visibility", "visible");
      hoverDots[0]
        .attr("cx", px)
        .attr("cy", y(p.downloaded))
        .attr("visibility", "visible");
      hoverDots[1]
        .attr("cx", px)
        .attr("cy", y(p.rest))
        .attr("visibility", "visible");
      const when = new Date(p.time);
      const title = Number.isNaN(when.getTime())
        ? formatElapsed(p.seconds)
        : `${formatElapsed(p.seconds)} (${when.toLocaleTimeString()})`;
      showTooltip(
        title,
        [
          {
            value: formatNumber(p.downloaded),
            label: series[0].label.toLowerCase(),
            color: seriesColor(series[0].cls),
          },
          {
            value: formatNumber(p.rest),
            label: series[1].label.toLowerCase(),
            color: seriesColor(series[1].cls),
          },
          {
            value: formatNumber(p.downloaded + p.rest),
            label: "total fetched",
          },
        ],
        clientX,
        clientY,
      );
    };
    const hideHover = () => {
      crosshair.attr("visibility", "hidden");
      for (const dot of hoverDots) dot.attr("visibility", "hidden");
      hideTooltip();
    };

    svg.on("pointermove", (event) => {
      const [mx] = d3.pointer(event);
      focusIndex = bisect(points, x.invert(mx));
      showAt(focusIndex, event.clientX, event.clientY);
    });
    svg.on("pointerleave", hideHover);
    svg.on("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const from =
        focusIndex < 0 ? (step > 0 ? -1 : points.length) : focusIndex;
      focusIndex = Math.max(0, Math.min(points.length - 1, from + step));
      const p = points[focusIndex];
      const [cx, cy] = clientPoint(svg.node(), x(p.seconds), y(p.downloaded));
      showAt(focusIndex, cx, cy);
    });
    svg.on("blur", () => {
      focusIndex = -1;
      hideHover();
    });
  });

  appendChartTable(
    card,
    [
      { label: "Elapsed" },
      { label: "Domain" },
      { label: "Outcome" },
      { label: series[0].label, num: true },
      { label: series[1].label, num: true },
    ],
    points.map((p) => [
      formatElapsed(p.seconds),
      p.item._domain,
      (p.item.status || "unknown").replace("_", " "),
      formatNumber(p.downloaded),
      formatNumber(p.rest),
    ]),
  );

  return card;
}

function buildRunPaceChart(runSets) {
  const slotted = runSets.filter((set) => runColorSlots.get(set.run.id));
  const seriesData = slotted
    .map((set) => {
      const times = set.results
        .map((r) => Date.parse(r.fetched_at || ""))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      if (times.length < 2) return null;
      const t0 = times[0];
      const points = times.map((time, i) => ({
        seconds: (time - t0) / 1000,
        count: i + 1,
      }));
      return {
        run: set.run,
        label: runShortLabel(set.run),
        points,
        total: times.length,
        duration: points[points.length - 1].seconds,
        downloaded: set.results.filter((r) => r.status === "downloaded").length,
      };
    })
    .filter(Boolean);
  if (seriesData.length < 2) return null;

  const maxDuration = Math.max(1, ...seriesData.map((s) => s.duration));
  const maxTotal = Math.max(1, ...seriesData.map((s) => s.total));

  const { card, body } = vizCard("Fetch Pace By Run");

  const legend = el("div", "chart-legend");
  for (const s of seriesData) {
    const item = el("span", "legend-item");
    const swatch = el("span", "legend-swatch");
    swatch.style.background = runColorVar(s.run.id);
    item.appendChild(swatch);
    item.appendChild(el("span", "", s.label));
    legend.appendChild(item);
  }
  card.insertBefore(legend, body);

  registerViz(card, body, (host, width) => {
    const height = 280;
    const margin = { top: 16, right: 116, bottom: 48, left: 46 };
    const x = d3
      .scaleLinear()
      .domain([0, maxDuration])
      .range([margin.left, width - margin.right]);
    const y = d3
      .scaleLinear()
      .domain([0, maxTotal])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const svg = d3
      .select(host)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        `Cumulative images fetched over elapsed time for ${formatNumber(
          seriesData.length,
        )} runs, aligned to each run's start. Use arrow keys to step through time.`,
      );

    drawYAxisGrid(svg, y, { left: margin.left, right: width - margin.right });
    const seen = new Set();
    const timeTicks = x
      .ticks(Math.max(3, Math.min(8, Math.floor(width / 90))))
      .filter((t) => {
        const label = formatElapsed(t);
        if (seen.has(label)) return false;
        seen.add(label);
        return true;
      });
    drawXAxis(svg, x, {
      y: height - margin.bottom,
      tickValues: timeTicks,
      format: formatElapsed,
    });
    drawBaseline(svg, margin.left, width - margin.right, y(0));
    svg
      .append("text")
      .attr("class", "viz-axis-title")
      .attr("x", (margin.left + width - margin.right) / 2)
      .attr("y", height - 6)
      .attr("text-anchor", "middle")
      .text("Elapsed since run start");

    for (const s of seriesData) {
      const gen = d3
        .line()
        .x((p) => x(p.seconds))
        .y((p) => y(p.count))
        .curve(d3.curveStepAfter);
      svg
        .append("path")
        .attr("class", "viz-line")
        .style("stroke", runColorVar(s.run.id))
        .attr("d", gen([{ seconds: 0, count: 0 }, ...s.points]));
    }

    const endLabels = seriesData
      .map((s) => ({ s, x: x(s.duration), y: y(s.total) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < endLabels.length; i += 1) {
      const prev = endLabels[i - 1];
      const label = endLabels[i];
      if (label.y - prev.y < 14 && Math.abs(label.x - prev.x) < 90) {
        label.y = prev.y + 14;
      }
    }
    for (const { s, x: endX, y: labelY } of endLabels) {
      svg
        .append("circle")
        .attr("class", "viz-dot")
        .style("fill", runColorVar(s.run.id))
        .attr("cx", endX)
        .attr("cy", y(s.total))
        .attr("r", 4);
      svg
        .append("text")
        .attr("class", "viz-end-label")
        .attr("x", endX + 10)
        .attr("y", labelY + 4)
        .text(`${formatNumber(s.total)} · ${s.label}`);
    }

    const crosshair = svg
      .append("line")
      .attr("class", "viz-crosshair")
      .attr("y1", margin.top)
      .attr("y2", height - margin.bottom)
      .attr("visibility", "hidden");
    const hoverDots = seriesData.map((s) =>
      svg
        .append("circle")
        .attr("class", "viz-dot")
        .style("fill", runColorVar(s.run.id))
        .attr("r", 4)
        .attr("visibility", "hidden"),
    );

    const countBisect = d3.bisector((p) => p.seconds).right;
    const allSeconds = [
      ...new Set(seriesData.flatMap((s) => s.points.map((p) => p.seconds))),
    ].sort((a, b) => a - b);
    const timeBisect = d3.bisector((t) => t).center;
    let focusIndex = -1;

    const showAt = (index, clientX, clientY) => {
      const seconds = allSeconds[index];
      if (seconds === undefined) return;
      const px = x(seconds);
      crosshair.attr("x1", px).attr("x2", px).attr("visibility", "visible");
      const rows = seriesData.map((s, i) => {
        const count = Math.min(countBisect(s.points, seconds), s.total);
        hoverDots[i]
          .attr("cx", x(Math.min(seconds, s.duration)))
          .attr("cy", y(count))
          .attr("visibility", "visible");
        return {
          value: formatNumber(count),
          label: seconds > s.duration ? `${s.label} (finished)` : s.label,
          color: runColorValue(s.run.id),
        };
      });
      showTooltip(formatElapsed(seconds), rows, clientX, clientY);
    };
    const hideHover = () => {
      crosshair.attr("visibility", "hidden");
      for (const dot of hoverDots) dot.attr("visibility", "hidden");
      hideTooltip();
    };

    svg.on("pointermove", (event) => {
      const [mx] = d3.pointer(event);
      focusIndex = Math.max(
        0,
        Math.min(allSeconds.length - 1, timeBisect(allSeconds, x.invert(mx))),
      );
      showAt(focusIndex, event.clientX, event.clientY);
    });
    svg.on("pointerleave", hideHover);
    svg.on("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const from =
        focusIndex < 0 ? (step > 0 ? -1 : allSeconds.length) : focusIndex;
      focusIndex = Math.max(0, Math.min(allSeconds.length - 1, from + step));
      const [cx, cy] = clientPoint(
        svg.node(),
        x(allSeconds[focusIndex]),
        margin.top + 12,
      );
      showAt(focusIndex, cx, cy);
    });
    svg.on("blur", () => {
      focusIndex = -1;
      hideHover();
    });
  });

  appendChartTable(
    card,
    [
      { label: "Run" },
      { label: "Duration" },
      { label: "Images fetched", num: true },
      { label: "Downloaded", num: true },
      { label: "Images / min", num: true },
    ],
    seriesData.map((s) => [
      s.label,
      formatElapsed(s.duration),
      formatNumber(s.total),
      formatNumber(s.downloaded),
      s.duration > 0 ? (s.total / (s.duration / 60)).toFixed(1) : "",
    ]),
  );

  return card;
}

function buildColumnChartCard({
  title,
  series,
  rows,
  ariaLabel,
  xTitle,
  extraTooltip,
  tableHeaders,
  tableRows,
}) {
  const { card, body } = vizCard(title);
  if (series.length > 1) card.insertBefore(buildLegend(series), body);

  registerViz(card, body, (host, width) => {
    const height = 250;
    const margin = { top: 16, right: 12, bottom: xTitle ? 48 : 34, left: 46 };
    const x = d3
      .scaleBand()
      .domain(d3.range(rows.length))
      .range([margin.left, width - margin.right])
      .paddingInner(0.25)
      .paddingOuter(0.1);
    const maxTotal = Math.max(1, ...rows.map((r) => d3.sum(r.values)));
    const y = d3
      .scaleLinear()
      .domain([0, maxTotal])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const svg = d3
      .select(host)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img");
    if (ariaLabel) svg.attr("aria-label", ariaLabel);

    drawYAxisGrid(svg, y, { left: margin.left, right: width - margin.right });

    const labelSpace =
      Math.max(...rows.map((r) => measureVizText(r.label))) + 14;
    const plotWidth = Math.max(1, width - margin.left - margin.right);
    const every = Math.max(
      1,
      Math.ceil((labelSpace * rows.length) / plotWidth),
    );
    drawXAxis(svg, x, {
      y: height - margin.bottom,
      tickValues: d3.range(rows.length).filter((i) => i % every === 0),
      format: (i) => rows[i].label,
    });
    drawBaseline(svg, margin.left, width - margin.right, y(0));
    if (xTitle) {
      svg
        .append("text")
        .attr("class", "viz-axis-title")
        .attr("x", (margin.left + width - margin.right) / 2)
        .attr("y", height - 6)
        .attr("text-anchor", "middle")
        .text(xTitle);
    }

    const barWidth = Math.min(24, x.bandwidth());
    rows.forEach((row, i) => {
      const total = d3.sum(row.values);
      const parts = series
        .map((s, si) => ({ s, value: row.values[si] }))
        .filter((p) => p.value > 0);

      const g = svg
        .append("g")
        .attr("class", "viz-col")
        .attr("tabindex", 0)
        .attr(
          "aria-label",
          `${row.label}: ` +
            (parts.length
              ? parts
                  .map((p) => `${formatNumber(p.value)} ${p.s.label}`)
                  .join(", ")
              : "0"),
        );
      g.append("rect")
        .attr("class", "viz-hit")
        .attr("x", x(i))
        .attr("y", margin.top)
        .attr("width", x.bandwidth())
        .attr("height", height - margin.top - margin.bottom);

      const x0 = x(i) + (x.bandwidth() - barWidth) / 2;
      let cum = 0;
      parts.forEach((part, pi) => {
        const yTop = y(cum + part.value);
        const yBottom = y(cum);
        const gap = pi > 0 ? 2 : 0;
        const h = Math.max(1, yBottom - yTop - gap);
        if (pi === parts.length - 1) {
          g.append("path")
            .attr("class", `viz-mark ${part.s.cls}`)
            .attr("d", roundedTopBarPath(x0, yTop, barWidth, h, 4));
        } else {
          g.append("rect")
            .attr("class", `viz-mark ${part.s.cls}`)
            .attr("x", x0)
            .attr("y", yTop)
            .attr("width", barWidth)
            .attr("height", h);
        }
        cum += part.value;
      });

      const tooltipRows = () => {
        const list = series.map((s, si) => ({
          value: formatNumber(row.values[si]),
          label: s.label.toLowerCase(),
          color: seriesColor(s.cls),
        }));
        if (series.length > 1) {
          list.push({ value: formatNumber(total), label: "total" });
        }
        if (extraTooltip) list.push(...extraTooltip(row));
        return list;
      };
      g.on("pointermove", (event) =>
        showTooltip(row.label, tooltipRows(), event.clientX, event.clientY),
      );
      g.on("pointerleave", hideTooltip);
      g.on("focus", () => {
        const [cx, cy] = clientPoint(
          svg.node(),
          x(i) + x.bandwidth() / 2,
          y(total),
        );
        showTooltip(row.label, tooltipRows(), cx, cy);
      });
      g.on("blur", hideTooltip);
    });
  });

  appendChartTable(card, tableHeaders, tableRows);
  return card;
}

function buildRankDepthChart(results, series) {
  const ranked = results.filter((r) => Number(r.search_rank) > 0);
  const maxRank = d3.max(ranked, (r) => Number(r.search_rank)) || 0;
  if (ranked.length < 2 || maxRank <= 10) return null;

  const bucketSize = 10;
  const bucketCount = Math.ceil(maxRank / bucketSize);
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    label: `${i * bucketSize + 1}-${(i + 1) * bucketSize}`,
    downloaded: 0,
    rest: 0,
  }));
  for (const r of ranked) {
    const index = Math.min(
      bucketCount - 1,
      Math.floor((Number(r.search_rank) - 1) / bucketSize),
    );
    if (r.status === "downloaded") buckets[index].downloaded += 1;
    else buckets[index].rest += 1;
  }
  const rows = buckets.map((b) => ({
    label: b.label,
    values: [b.downloaded, b.rest],
  }));
  const rateOf = (row) => {
    const total = row.values[0] + row.values[1];
    return total ? Math.round((row.values[0] / total) * 100) : 0;
  };

  return buildColumnChartCard({
    title: "Downloads By Search Depth",
    series,
    rows,
    ariaLabel: `Stacked columns of download outcomes across ${formatNumber(bucketCount)} search-rank buckets.`,
    xTitle: "Search rank",
    extraTooltip: (row) => [{ value: `${rateOf(row)}%`, label: "downloaded" }],
    tableHeaders: [
      { label: "Search rank" },
      { label: series[0].label, num: true },
      { label: series[1].label, num: true },
      { label: "Total", num: true },
      { label: "Downloaded %", num: true },
    ],
    tableRows: rows.map((row) => [
      row.label,
      formatNumber(row.values[0]),
      formatNumber(row.values[1]),
      formatNumber(row.values[0] + row.values[1]),
      `${rateOf(row)}%`,
    ]),
  });
}

const SIZE_BUCKET_EDGES = [
  0, 10240, 25600, 51200, 102400, 256000, 512000, 1048576, 2621440, 5242880,
  10485760, 26214400, 104857600, 1073741824,
];

function buildSizeHistogram(results) {
  const downloaded = results.filter(
    (r) => r.status === "downloaded" && r._bytes > 0,
  );
  if (downloaded.length < 2) return null;

  const maxBytes = d3.max(downloaded, (r) => r._bytes);
  let end = SIZE_BUCKET_EDGES.findIndex((edge) => edge >= maxBytes);
  if (end === -1) end = SIZE_BUCKET_EDGES.length - 1;
  const edges = SIZE_BUCKET_EDGES.slice(0, end + 1);
  const counts = new Array(edges.length - 1).fill(0);
  for (const r of downloaded) {
    let index = edges.findIndex((edge) => r._bytes <= edge) - 1;
    if (index < 0) index = counts.length - 1;
    counts[Math.min(index, counts.length - 1)] += 1;
  }
  const start = Math.max(
    0,
    counts.findIndex((c) => c > 0),
  );
  const rows = counts.slice(start).map((count, i) => ({
    label: `${formatBytesShort(edges[start + i])}-${formatBytesShort(
      edges[start + i + 1],
    )}`,
    values: [count],
  }));

  return buildColumnChartCard({
    title: "File Size Distribution",
    series: [{ key: "images", label: "Downloaded images", cls: "seg-accent" }],
    rows,
    ariaLabel: `Histogram of file sizes across ${formatNumber(downloaded.length)} downloaded images.`,
    xTitle: "File size",
    tableHeaders: [{ label: "File size" }, { label: "Images", num: true }],
    tableRows: rows.map((row) => [row.label, formatNumber(row.values[0])]),
  });
}

function buildFormatsChart(results, series) {
  const byFormat = new Map();
  for (const r of results) {
    const fmt = r._format || "unknown";
    if (!byFormat.has(fmt)) byFormat.set(fmt, []);
    byFormat.get(fmt).push(r);
  }
  const formats = [...byFormat.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  if (!formats.length) return null;

  const rows = formats.map(([fmt, items]) => {
    const downloaded = items.filter((r) => r.status === "downloaded").length;
    return {
      label: fmt === "unknown" ? "unknown" : fmt.toUpperCase(),
      values: [downloaded, items.length - downloaded],
    };
  });

  return buildColumnChartCard({
    title: "Image Formats",
    series,
    rows,
    ariaLabel: `Stacked columns of ${formatNumber(formats.length)} image formats by outcome.`,
    xTitle: "Format",
    tableHeaders: [
      { label: "Format" },
      { label: series[0].label, num: true },
      { label: series[1].label, num: true },
      { label: "Total", num: true },
    ],
    tableRows: rows.map((row) => [
      row.label,
      formatNumber(row.values[0]),
      formatNumber(row.values[1]),
      formatNumber(row.values[0] + row.values[1]),
    ]),
  });
}

function buildRankSizeScatter(results, showQuery) {
  const images = results.filter(
    (r) =>
      r.status === "downloaded" && Number(r.search_rank) > 0 && r._bytes > 0,
  );
  if (images.length < 3) return null;

  const sorted = [...images].sort(
    (a, b) =>
      Number(a.search_rank) - Number(b.search_rank) || b._bytes - a._bytes,
  );
  const maxRank = d3.max(sorted, (r) => Number(r.search_rank));
  const [minBytes, maxBytes] = d3.extent(sorted, (r) => r._bytes);
  const useLog = maxBytes / Math.max(1, minBytes) >= 100;

  const { card, body } = vizCard("Search Rank vs. File Size");

  registerViz(card, body, (host, width) => {
    const height = 300;
    const margin = { top: 24, right: 18, bottom: 44, left: 58 };
    const x = d3
      .scaleLinear()
      .domain([0, maxRank])
      .nice()
      .range([margin.left, width - margin.right]);
    const y = (
      useLog
        ? d3.scaleLog().domain([Math.max(1, minBytes), maxBytes])
        : d3.scaleLinear().domain([0, maxBytes])
    )
      .nice()
      .range([height - margin.bottom, margin.top]);

    const svg = d3
      .select(host)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        `Scatter plot of ${formatNumber(sorted.length)} downloaded images by search rank and ` +
          `file size. Use arrow keys to move between images and Enter to open one.`,
      );

    drawYAxisGrid(svg, y, {
      left: margin.left,
      right: width - margin.right,
      format: formatBytesShort,
      tickValues: useLog
        ? y.ticks().filter((t) => Number.isInteger(Math.log10(t)))
        : y.ticks(4),
    });
    drawXAxis(svg, x, {
      y: height - margin.bottom,
      tickValues: x
        .ticks(Math.max(4, Math.min(10, Math.floor(width / 70))))
        .filter((t) => Number.isInteger(t)),
      format: d3.format(",d"),
    });
    drawBaseline(
      svg,
      margin.left,
      width - margin.right,
      height - margin.bottom,
    );
    svg
      .append("text")
      .attr("class", "viz-axis-title")
      .attr("x", (margin.left + width - margin.right) / 2)
      .attr("y", height - 6)
      .attr("text-anchor", "middle")
      .text("Search rank");
    svg
      .append("text")
      .attr("class", "viz-axis-title")
      .attr("x", margin.left - 50)
      .attr("y", 11)
      .text("Size");

    const px = (r) => x(Number(r.search_rank));
    const py = (r) => y(useLog ? Math.max(1, r._bytes) : r._bytes);
    const dots = svg.append("g");
    const circles = sorted.map((r) =>
      dots
        .append("circle")
        .attr("class", "viz-dot viz-dot-accent viz-point")
        .attr("cx", px(r))
        .attr("cy", py(r))
        .attr("r", 4)
        .node(),
    );

    const delaunay = d3.Delaunay.from(sorted, px, py);
    let activeIndex = -1;

    const activate = (index, clientX, clientY) => {
      if (activeIndex >= 0 && circles[activeIndex]) {
        circles[activeIndex].classList.remove("is-active");
      }
      activeIndex = index;
      const r = sorted[index];
      if (!r) return;
      circles[index].classList.add("is-active");
      const title = (r.title || r.link || "(untitled)").slice(0, 90);
      showTooltip(
        title,
        [
          { value: formatBytesShort(r._bytes), label: "file size" },
          {
            value: `#${r.search_rank}`,
            label: showQuery && r.query ? `in "${r.query}"` : "search rank",
          },
          { value: "", label: r._domain },
        ],
        clientX,
        clientY,
      );
    };
    const deactivate = () => {
      if (activeIndex >= 0 && circles[activeIndex]) {
        circles[activeIndex].classList.remove("is-active");
      }
      activeIndex = -1;
      svg.style("cursor", null);
      hideTooltip();
    };
    const openActive = () => {
      const r = sorted[activeIndex];
      const href = r ? safeHref(r.link || r.final_url || "") : null;
      if (href) window.open(href, "_blank", "noopener");
    };

    svg.on("pointermove", (event) => {
      const [mx, my] = d3.pointer(event);
      const index = delaunay.find(mx, my);
      const r = sorted[index];
      if (!r || Math.hypot(px(r) - mx, py(r) - my) > 36) {
        deactivate();
        return;
      }
      svg.style("cursor", "pointer");
      activate(index, event.clientX, event.clientY);
    });
    svg.on("pointerleave", deactivate);
    svg.on("click", openActive);
    svg.on("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openActive();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const from =
        activeIndex < 0 ? (step > 0 ? -1 : sorted.length) : activeIndex;
      const next = Math.max(0, Math.min(sorted.length - 1, from + step));
      const r = sorted[next];
      const [cx, cy] = clientPoint(svg.node(), px(r), py(r));
      activate(next, cx, cy);
    });
    svg.on("blur", deactivate);
  });

  const tableCap = 400;
  const tableRows = sorted
    .slice(0, tableCap)
    .map((r) => [
      `#${r.search_rank}`,
      (r.title || r.link || "(untitled)").slice(0, 90),
      r._domain,
      formatBytesShort(r._bytes),
    ]);
  if (sorted.length > tableCap) {
    tableRows.push([
      "",
      `...and ${formatNumber(sorted.length - tableCap)} more (see the Images tab)`,
      "",
      "",
    ]);
  }
  appendChartTable(
    card,
    [
      { label: "Rank", num: true },
      { label: "Image" },
      { label: "Domain" },
      { label: "Size", num: true },
    ],
    tableRows,
  );

  return card;
}

function buildDimensionsScatter(results) {
  const images = results.filter(
    (r) => r.status === "downloaded" && r._w > 0 && r._h > 0,
  );
  if (images.length < 3) return null;

  const sorted = [...images].sort((a, b) => b._pixels - a._pixels);
  const maxW = d3.max(sorted, (r) => r._w);
  const maxH = d3.max(sorted, (r) => r._h);

  const { card, body } = vizCard("Image Dimensions");

  registerViz(card, body, (host, width) => {
    const height = 300;
    const margin = { top: 24, right: 18, bottom: 44, left: 58 };
    const x = d3
      .scaleLinear()
      .domain([0, maxW])
      .nice()
      .range([margin.left, width - margin.right]);
    const y = d3
      .scaleLinear()
      .domain([0, maxH])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const svg = d3
      .select(host)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        `Scatter plot of ${formatNumber(sorted.length)} downloaded images by pixel width and ` +
          `height. Use arrow keys to move between images and Enter to open one.`,
      );

    drawYAxisGrid(svg, y, {
      left: margin.left,
      right: width - margin.right,
    });
    drawXAxis(svg, x, {
      y: height - margin.bottom,
      tickValues: x
        .ticks(Math.max(4, Math.min(10, Math.floor(width / 70))))
        .filter((t) => Number.isInteger(t)),
      format: formatCompact,
    });
    drawBaseline(
      svg,
      margin.left,
      width - margin.right,
      height - margin.bottom,
    );
    svg
      .append("text")
      .attr("class", "viz-axis-title")
      .attr("x", (margin.left + width - margin.right) / 2)
      .attr("y", height - 6)
      .attr("text-anchor", "middle")
      .text("Width (px)");
    svg
      .append("text")
      .attr("class", "viz-axis-title")
      .attr("x", margin.left - 50)
      .attr("y", 11)
      .text("Height (px)");

    const px = (r) => x(r._w);
    const py = (r) => y(r._h);
    const dots = svg.append("g");
    const circles = sorted.map((r) =>
      dots
        .append("circle")
        .attr("class", "viz-dot viz-dot-accent viz-point")
        .attr("cx", px(r))
        .attr("cy", py(r))
        .attr("r", 4)
        .node(),
    );

    const delaunay = d3.Delaunay.from(sorted, px, py);
    let activeIndex = -1;

    const activate = (index, clientX, clientY) => {
      if (activeIndex >= 0 && circles[activeIndex]) {
        circles[activeIndex].classList.remove("is-active");
      }
      activeIndex = index;
      const r = sorted[index];
      if (!r) return;
      circles[index].classList.add("is-active");
      const title = (r.title || r.link || "(untitled)").slice(0, 90);
      const rows = [{ value: dimsLabel(r._w, r._h), label: "pixels" }];
      if (r._bytes) {
        rows.push({ value: formatBytesShort(r._bytes), label: "file size" });
      }
      rows.push({ value: "", label: r._domain });
      showTooltip(title, rows, clientX, clientY);
    };
    const deactivate = () => {
      if (activeIndex >= 0 && circles[activeIndex]) {
        circles[activeIndex].classList.remove("is-active");
      }
      activeIndex = -1;
      svg.style("cursor", null);
      hideTooltip();
    };
    const openActive = () => {
      const r = sorted[activeIndex];
      const href = r ? safeHref(r.link || r.final_url || "") : null;
      if (href) window.open(href, "_blank", "noopener");
    };

    svg.on("pointermove", (event) => {
      const [mx, my] = d3.pointer(event);
      const index = delaunay.find(mx, my);
      const r = sorted[index];
      if (!r || Math.hypot(px(r) - mx, py(r) - my) > 36) {
        deactivate();
        return;
      }
      svg.style("cursor", "pointer");
      activate(index, event.clientX, event.clientY);
    });
    svg.on("pointerleave", deactivate);
    svg.on("click", openActive);
    svg.on("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openActive();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const from =
        activeIndex < 0 ? (step > 0 ? -1 : sorted.length) : activeIndex;
      const next = Math.max(0, Math.min(sorted.length - 1, from + step));
      const r = sorted[next];
      const [cx, cy] = clientPoint(svg.node(), px(r), py(r));
      activate(next, cx, cy);
    });
    svg.on("blur", deactivate);
  });

  const tableCap = 400;
  const tableRows = sorted
    .slice(0, tableCap)
    .map((r) => [
      (r.title || r.link || "(untitled)").slice(0, 90),
      r._domain,
      formatNumber(r._w),
      formatNumber(r._h),
      formatBytesShort(r._bytes) || "",
    ]);
  if (sorted.length > tableCap) {
    tableRows.push([
      `...and ${formatNumber(sorted.length - tableCap)} more (see the Images tab)`,
      "",
      "",
      "",
      "",
    ]);
  }
  appendChartTable(
    card,
    [
      { label: "Image" },
      { label: "Domain" },
      { label: "Width", num: true },
      { label: "Height", num: true },
      { label: "Size", num: true },
    ],
    tableRows,
  );

  return card;
}

function buildDomainTreemap(results) {
  const byDomain = new Map();
  for (const r of results) {
    if (r.status !== "downloaded" || !(r._bytes > 0)) continue;
    const entry = byDomain.get(r._domain) || {
      domain: r._domain,
      bytes: 0,
      images: 0,
    };
    entry.bytes += r._bytes;
    entry.images += 1;
    byDomain.set(r._domain, entry);
  }
  const entries = [...byDomain.values()].sort((a, b) => b.bytes - a.bytes);
  if (entries.length < 2) return null;

  const MAX_CELLS = 18;
  const nodes = entries
    .slice(0, MAX_CELLS)
    .map((e) => ({ ...e, other: false }));
  const rest = entries.slice(MAX_CELLS);
  if (rest.length) {
    nodes.push({
      domain: `Other (${formatNumber(rest.length)} domains)`,
      bytes: d3.sum(rest, (e) => e.bytes),
      images: d3.sum(rest, (e) => e.images),
      other: true,
    });
  }
  const totalBytes = d3.sum(entries, (e) => e.bytes);

  const { card, body } = vizCard("Bytes By Domain");

  registerViz(card, body, (host, width) => {
    const height = Math.max(240, Math.min(340, Math.round(width * 0.4)));
    const root = d3.hierarchy({ children: nodes }).sum((d) => d.bytes || 0);
    d3.treemap().size([width, height]).paddingInner(2).round(true)(root);

    const svg = d3
      .select(host)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("role", "img")
      .attr(
        "aria-label",
        `Treemap of downloaded image bytes across ${formatNumber(entries.length)} domains.`,
      );

    for (const leaf of root.leaves()) {
      const d = leaf.data;
      const w = leaf.x1 - leaf.x0;
      const h = leaf.y1 - leaf.y0;
      const share = totalBytes ? Math.round((d.bytes / totalBytes) * 100) : 0;
      const g = svg
        .append("g")
        .attr("class", "viz-cell-group")
        .attr("transform", `translate(${leaf.x0},${leaf.y0})`)
        .attr("tabindex", 0)
        .attr(
          "aria-label",
          `${d.domain}: ${formatBytesShort(d.bytes)} from ${formatNumber(d.images)} ` +
            `images, ${share}% of downloaded data`,
        );
      g.append("rect")
        .attr("class", d.other ? "viz-cell viz-cell-other" : "viz-cell")
        .attr("width", w)
        .attr("height", h)
        .attr("rx", 3);

      if (h >= 30 && w >= measureVizText(d.domain, VIZ_FONT_SEMIBOLD) + 14) {
        g.append("text")
          .attr("class", "viz-cell-label")
          .attr("x", 7)
          .attr("y", 17)
          .text(d.domain);
        const sub = formatBytesShort(d.bytes);
        if (h >= 46 && w >= measureVizText(sub) + 14) {
          g.append("text")
            .attr("class", "viz-cell-sub")
            .attr("x", 7)
            .attr("y", 32)
            .text(sub);
        }
      }

      const tipRows = () => [
        { value: formatBytesShort(d.bytes), label: "downloaded" },
        {
          value: formatNumber(d.images),
          label: d.images === 1 ? "image" : "images",
        },
        { value: `${share}%`, label: "of all downloaded data" },
      ];
      g.on("pointermove", (event) =>
        showTooltip(d.domain, tipRows(), event.clientX, event.clientY),
      );
      g.on("pointerleave", hideTooltip);
      g.on("focus", () => {
        const [cx, cy] = clientPoint(
          svg.node(),
          leaf.x0 + w / 2,
          leaf.y0 + h / 2,
        );
        showTooltip(d.domain, tipRows(), cx, cy);
      });
      g.on("blur", hideTooltip);
    }
  });

  appendChartTable(
    card,
    [
      { label: "Domain" },
      { label: "Images", num: true },
      { label: "Bytes", num: true },
      { label: "Share", num: true },
    ],
    entries.map((e) => [
      e.domain,
      formatNumber(e.images),
      formatBytesShort(e.bytes),
      `${totalBytes ? ((e.bytes / totalBytes) * 100).toFixed(1) : "0.0"}%`,
    ]),
  );

  return card;
}

function renderCharts() {
  els.charts.textContent = "";
  clearCharts();
  hideTooltip();

  if (!state.results.length) {
    els.charts.appendChild(
      el("p", "empty-state", "This run has no results to chart."),
    );
    return;
  }

  let results = state.results;
  if (state.multiRun && state.chartRun !== "all") {
    results = results.filter((r) => r._runId === state.chartRun);
  }
  if (state.chartQuery !== "all") {
    results = results.filter((r) => r.query === state.chartQuery.slice(2));
  }
  if (!results.length) {
    els.charts.appendChild(
      el("p", "empty-state", "No results match this scope."),
    );
    return;
  }

  const hasD3 = typeof window.d3 !== "undefined";
  if (!hasD3) {
    els.charts.appendChild(
      el(
        "p",
        "empty-state",
        "Interactive charts need vendor/d3.v7.min.js; showing the basic charts only.",
      ),
    );
  }

  const anyNotDownloaded = results.some((r) => r.status === "not_downloaded");
  const outcomeSeries = [
    { key: "downloaded", label: "Downloaded", cls: "seg-accent" },
    {
      key: "rest",
      label: anyNotDownloaded ? "Not downloaded" : "Skipped",
      cls: "seg-muted",
    },
  ];
  const splitOf = (items) => {
    const downloaded = items.filter((r) => r.status === "downloaded").length;
    return [downloaded, items.length - downloaded];
  };

  const add = (card) => {
    if (card) els.charts.appendChild(card);
  };

  const chartRuns = state.multiRun
    ? state.loadedRuns.filter(
        (entry) => state.chartRun === "all" || entry.run.id === state.chartRun,
      )
    : [];
  const runSets = chartRuns
    .map((entry) => ({
      run: entry.run,
      results:
        state.chartQuery === "all"
          ? entry.results
          : entry.results.filter((r) => r.query === state.chartQuery.slice(2)),
    }))
    .filter((set) => set.results.length);
  const compareRuns = runSets.length > 1;

  if (hasD3) {
    add(
      (compareRuns && buildRunPaceChart(runSets)) ||
        buildTimelineChart(results, outcomeSeries),
    );
  }

  if (compareRuns) {
    add(
      buildBarChart({
        title: "Outcome By Run",
        series: outcomeSeries,
        rows: runSets.map((set) => ({
          label: runShortLabel(set.run),
          values: splitOf(set.results),
        })),
      }),
    );
  }

  const queries = [...new Set(results.map((r) => r.query).filter(Boolean))];
  if (queries.length > 1) {
    add(
      buildBarChart({
        title: "Outcome By Query",
        series: outcomeSeries,
        rows: queries.map((query) => ({
          label: query,
          values: splitOf(results.filter((r) => r.query === query)),
        })),
      }),
    );
  }

  if (hasD3) add(buildRankDepthChart(results, outcomeSeries));

  const skipped = results.filter((r) => r.status === "skipped");
  if (skipped.length) {
    const byReason = new Map();
    for (const item of skipped) {
      byReason.set(item._reason, (byReason.get(item._reason) || 0) + 1);
    }
    const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
    add(
      buildBarChart({
        title: "Skip Reasons",
        series: [{ key: "count", label: "Skipped results", cls: "seg-muted" }],
        rows: reasons.map(([reason, count]) => ({
          label: reason,
          values: [count],
        })),
      }),
    );
  }

  const byDomain = new Map();
  for (const item of results) {
    if (!byDomain.has(item._domain)) byDomain.set(item._domain, []);
    byDomain.get(item._domain).push(item);
  }
  const domains = [...byDomain.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  add(buildDomainsChart(domains, outcomeSeries, splitOf, false));

  if (hasD3) {
    add(buildDomainTreemap(results));
    add(buildSizeHistogram(results));
    add(buildFormatsChart(results, outcomeSeries));
    add(buildRankSizeScatter(results, queries.length > 1));
    add(buildDimensionsScatter(results));
  }

  if (!chartObserver) {
    for (const rec of chartDrawers.values()) {
      const width = rec.measure();
      if (width >= VIZ_MIN_WIDTH && width !== rec.width) {
        rec.width = width;
        rec.draw(width);
      }
    }
  }
}

function renderErrors() {
  const box = els.errorsContent;
  box.textContent = "";

  const errors = state.errors;
  const count = errors
    ? errors.length
    : (state.summary?.search_error_count ?? 0);
  els.errorBadge.textContent = formatNumber(count);
  els.errorBadge.classList.toggle("has-errors", count > 0);

  if (errors === null) {
    box.appendChild(el("p", "empty-state", state.errorsNote));
    return;
  }

  if (state.errorsMissingRuns.length) {
    box.appendChild(
      el(
        "p",
        "chart-note",
        `Search errors could not be loaded for: ${state.errorsMissingRuns.join(
          ", ",
        )}.`,
      ),
    );
  }

  if (!errors.length) {
    box.appendChild(
      el(
        "p",
        "empty-state",
        "No search errors; every Google CSE request succeeded.",
      ),
    );
    return;
  }

  const showRun = state.multiRun;
  const scroll = el("div", "table-scroll");
  const table = el("table", "data-table");
  const thead = el("thead");
  const headRow = el("tr");
  const headings = ["Query", "Page", "Type", "HTTP", "Message"];
  if (showRun) headings.unshift("Run");
  for (const heading of headings) {
    headRow.appendChild(
      el("th", heading === "Page" || heading === "HTTP" ? "num" : "", heading),
    );
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const err of errors) {
    if (!err || typeof err !== "object") continue;
    const tr = el("tr");
    if (showRun) tr.appendChild(el("td", "", err._runLabel ?? ""));
    tr.appendChild(el("td", "", err.query ?? ""));
    tr.appendChild(el("td", "num", err.page_number ?? ""));
    tr.appendChild(el("td", "", err.error_type ?? ""));
    tr.appendChild(el("td", "num", err.http_status ?? ""));
    tr.appendChild(el("td", "", err.message ?? ""));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  box.appendChild(scroll);
}

function init() {
  const params = new URLSearchParams(window.location.search);

  let theme = params.get("theme");
  if (!THEMES.includes(theme)) {
    try {
      theme = localStorage.getItem("imgf-theme");
    } catch {
      theme = null;
    }
  }
  applyTheme(theme || "auto");

  els.themeToggle.addEventListener("click", () => {
    const next = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    applyTheme(next);
  });

  for (const tab of els.tabs) {
    tab.addEventListener("click", () => setTab(tab.dataset.tab));
  }
  const requestedTab = params.get("tab");
  if (["results", "overview", "errors"].includes(requestedTab)) {
    setTab(requestedTab);
  }

  els.runPickerToggle.addEventListener("click", () => {
    setRunMenuOpen(els.runPickerMenu.hidden);
  });
  document.addEventListener("click", (event) => {
    if (!els.runPicker.contains(event.target)) setRunMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.runPickerMenu.hidden) {
      setRunMenuOpen(false);
      els.runPickerToggle.focus();
    }
  });

  els.runFilter.addEventListener("change", () => {
    state.runFilter = els.runFilter.value;
    state.visibleCount = PAGE_SIZE;
    applyFilters();
  });

  els.chartRunFilter.addEventListener("change", () => {
    state.chartRun = els.chartRunFilter.value;
    renderCharts();
  });

  els.fileInput.addEventListener("change", () => {
    if (els.fileInput.files.length) {
      loadFromFile(els.fileInput.files[0]);
      els.fileInput.value = "";
    }
  });

  for (const eventName of ["dragenter", "dragover"]) {
    document.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("drag-over");
    });
  }
  document.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget) els.dropZone.classList.remove("drag-over");
  });
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("drag-over");
    if (event.dataTransfer.files.length) {
      loadFromFile(event.dataTransfer.files[0]);
    }
  });

  els.search.addEventListener(
    "input",
    debounce(() => {
      state.search = els.search.value;
      state.visibleCount = PAGE_SIZE;
      applyFilters();
    }, 150),
  );

  els.chartQueryFilter.addEventListener("change", () => {
    state.chartQuery = els.chartQueryFilter.value;
    renderCharts();
  });

  for (const [element, key] of [
    [els.queryFilter, "query"],
    [els.formatFilter, "format"],
    [els.statusFilter, "status"],
    [els.sort, "sort"],
  ]) {
    element.addEventListener("change", () => {
      state[key] = element.value;
      state.visibleCount = PAGE_SIZE;
      applyFilters();
    });
  }

  els.showMore.addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderResults();
  });
  els.showAll.addEventListener("click", () => {
    state.visibleCount = state.filtered.length;
    renderResults();
  });

  els.lightboxClose.addEventListener("click", closeLightbox);
  els.lightboxPrev.addEventListener("click", () => stepLightbox(-1));
  els.lightboxNext.addEventListener("click", () => stepLightbox(1));
  els.lightbox.addEventListener("click", (event) => {
    if (event.target === els.lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (els.lightbox.hidden) return;
    if (event.key === "Escape") {
      closeLightbox();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepLightbox(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      stepLightbox(1);
    }
  });

  tryAutoLoad();
}

init();
