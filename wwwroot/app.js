// NWS Alert Reader — frontend logic.
// Polls /api/alerts every POLL_MS, renders polygons on a Leaflet map and
// summary cards in a horizontal strip below. Reads alerts aloud via the
// browser's SpeechSynthesis API. Settings persist in localStorage.

const POLL_MS = 60_000;
const STORAGE_KEY = "nws-reader.settings.v1";
const SEEN_KEY = "nws-reader.seen.v1";

const DEFAULT_FILTERS = ["tor-warning", "svr-warning"];
const DEFAULT_CENTER = [39.5, -98.35]; // CONUS-ish
const DEFAULT_ZOOM = 4;

const $ = (id) => document.getElementById(id);

const els = {
  type: $("type-select"),
  value: $("value-input"),
  voice: $("voice-select"),
  refresh: $("refresh-btn"),
  fit: $("fit-btn"),
  speakAll: $("speak-all-btn"),
  stop: $("stop-btn"),
  alerts: $("alerts"),
  empty: $("empty-state"),
  error: $("error-banner"),
  status: document.querySelector(".status"),
  statusText: $("status-text"),
  pulse: $("pulse"),
  updated: $("updated-text"),
  filterChips: document.querySelectorAll(".filter-chip input[type=checkbox]"),
  filterCount: $("filter-count"),
  map: $("map"),
};

const state = {
  type: "area",
  value: "KS",
  voiceURI: null,
  filters: new Set(DEFAULT_FILTERS),
  seen: new Set(),
  alertsById: new Map(),
  filteredAlerts: [],
  pollTimer: null,
  // map
  map: null,
  layerGroup: null,
  polygonsById: new Map(), // alert.id -> leaflet layer
  lastFittedQuery: null,   // "type:value" of last auto-fit
};

// --- settings persistence ---

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.type) state.type = saved.type;
      if (saved.value) state.value = saved.value;
      if (saved.voiceURI) state.voiceURI = saved.voiceURI;
      if (Array.isArray(saved.filters)) state.filters = new Set(saved.filters);
    }
  } catch { /* ignore */ }
  try {
    const seen = localStorage.getItem(SEEN_KEY);
    if (seen) state.seen = new Set(JSON.parse(seen));
  } catch { /* ignore */ }
}

function saveSettings() {
  const { type, value, voiceURI } = state;
  const filters = [...state.filters];
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ type, value, voiceURI, filters }));
}

function saveSeen() {
  const arr = [...state.seen].slice(-500);
  localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
}

function categorize(eventName) {
  if (eventName === "Tornado Warning") return "tor-warning";
  if (eventName === "Severe Thunderstorm Warning") return "svr-warning";
  if (eventName?.endsWith("Warning")) return "other-warnings";
  if (eventName?.endsWith("Watch")) return "watches";
  return "other";
}

function applyFilters(alerts) {
  return alerts.filter(a => state.filters.has(categorize(a.event)));
}

// --- map ---

function initMap() {
  state.map = L.map(els.map, {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(state.map);

  state.layerGroup = L.layerGroup().addTo(state.map);
}

const SEVERITY_COLORS = {
  Extreme: "#a855f7",
  Severe: "#ef4444",
  Moderate: "#f97316",
  Minor: "#eab308",
};

function polygonStyle(alert) {
  const base = SEVERITY_COLORS[alert.severity] ?? "#94a3b8";
  if (alert.isEmergency) {
    return {
      color: "#fbbf24",
      weight: 3,
      fillColor: "#7f1d1d",
      fillOpacity: 0.45,
      className: "polygon-emergency",
    };
  }
  if (alert.isPds) {
    return {
      color: "#ef4444",
      weight: 3,
      fillColor: "#b91c1c",
      fillOpacity: 0.4,
      className: "polygon-pds",
    };
  }
  return {
    color: base,
    weight: 2,
    fillColor: base,
    fillOpacity: 0.22,
  };
}

function renderPolygons() {
  state.layerGroup.clearLayers();
  state.polygonsById.clear();

  for (const alert of state.filteredAlerts) {
    if (!alert.geometry) continue;
    const layer = L.geoJSON(alert.geometry, {
      style: () => polygonStyle(alert),
    });
    layer.bindPopup(() => buildPopup(alert));
    layer.on("click", () => focusCard(alert.id, /* alsoFly */ false));
    state.layerGroup.addLayer(layer);
    state.polygonsById.set(alert.id, layer);
  }
}

function buildPopup(alert) {
  const wrap = document.createElement("div");
  const h3 = document.createElement("h3");
  h3.textContent = alert.event ?? "Alert";
  if (alert.isPds) {
    const b = document.createElement("span");
    b.className = "pds-badge";
    b.textContent = "PDS";
    h3.appendChild(b);
  }
  const sev = document.createElement("span");
  sev.className = `severity-badge severity-${(alert.severity ?? "Unknown").toLowerCase()}`;
  sev.textContent = alert.severity ?? "Unknown";
  // Severity badge needs the parent severity-* class to inherit colors —
  // apply both classes so colors resolve regardless of context.
  sev.style.setProperty("--badge-bg", SEVERITY_COLORS[alert.severity] ?? "#475569");
  sev.style.setProperty("--badge-fg", "#fff");
  h3.appendChild(sev);
  wrap.appendChild(h3);

  if (alert.areaDesc) {
    const meta = document.createElement("div");
    meta.className = "popup-meta";
    meta.textContent = alert.areaDesc;
    wrap.appendChild(meta);
  }
  if (alert.expires) {
    const meta = document.createElement("div");
    meta.className = "popup-meta";
    meta.textContent = `Until ${formatTime(alert.expires)}`;
    wrap.appendChild(meta);
  }
  if (alert.headline) {
    const p = document.createElement("p");
    p.textContent = alert.headline;
    wrap.appendChild(p);
  }

  const actions = document.createElement("div");
  actions.className = "popup-actions";

  const readBtn = document.createElement("button");
  readBtn.className = "read-btn";
  readBtn.type = "button";
  readBtn.textContent = "🔈 Read";
  readBtn.addEventListener("click", () => {
    speechSynthesis.cancel();
    speakAlert(alert);
  });
  actions.appendChild(readBtn);

  if (alert.description) {
    const fullBtn = document.createElement("button");
    fullBtn.type = "button";
    fullBtn.textContent = "Read full";
    fullBtn.addEventListener("click", () => {
      speechSynthesis.cancel();
      speakDescription(alert);
    });
    actions.appendChild(fullBtn);
  }
  wrap.appendChild(actions);
  return wrap;
}

function fitToAlerts() {
  const layers = [...state.polygonsById.values()];
  if (!layers.length) return;
  const group = L.featureGroup(layers);
  state.map.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 10 });
}

function flyToAlert(alert) {
  const layer = state.polygonsById.get(alert.id);
  if (!layer) return;
  state.map.flyToBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 10 });
  layer.openPopup();
}

function highlightPolygon(alertId, on) {
  const layer = state.polygonsById.get(alertId);
  if (!layer) return;
  layer.eachLayer?.(l => {
    const el = l.getElement?.();
    if (el) el.classList.toggle("polygon-highlight", on);
  });
  if (on) layer.bringToFront();
}

function focusCard(alertId, alsoFly = true) {
  const card = els.alerts.querySelector(`.alert[data-id="${cssEscape(alertId)}"]`);
  if (!card) return;
  for (const el of els.alerts.querySelectorAll(".alert.is-active")) {
    el.classList.remove("is-active");
  }
  card.classList.add("is-active");
  card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  if (alsoFly) {
    const alert = state.alertsById.get(alertId);
    if (alert) flyToAlert(alert);
  }
}

function cssEscape(s) {
  return CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"');
}

// --- voices ---

let availableVoices = [];

function loadVoices() {
  availableVoices = speechSynthesis.getVoices();
  els.voice.innerHTML = "";
  if (!availableVoices.length) {
    els.voice.add(new Option("(no voices available)", ""));
    return;
  }
  const sorted = [...availableVoices].sort((a, b) => {
    const aEn = a.lang.startsWith("en") ? 0 : 1;
    const bEn = b.lang.startsWith("en") ? 0 : 1;
    return aEn - bEn || a.name.localeCompare(b.name);
  });
  for (const v of sorted) {
    els.voice.add(new Option(`${v.name} (${v.lang})`, v.voiceURI));
  }
  if (state.voiceURI && availableVoices.some(v => v.voiceURI === state.voiceURI)) {
    els.voice.value = state.voiceURI;
  } else {
    state.voiceURI = els.voice.value;
  }
}

speechSynthesis.addEventListener?.("voiceschanged", loadVoices);

// --- TTS ---

function speak(text) {
  if (!text) return;
  const utter = new SpeechSynthesisUtterance(text);
  const voice = availableVoices.find(v => v.voiceURI === state.voiceURI);
  if (voice) utter.voice = voice;
  utter.rate = 1.0;
  utter.pitch = 1.0;
  speechSynthesis.speak(utter);
}

function composeSpeech(alert) {
  const parts = [];
  if (alert.isEmergency) parts.push("Emergency.");
  else if (alert.isPds) parts.push("Particularly dangerous situation.");
  parts.push(alert.event ?? "Weather alert");
  if (alert.areaDesc) {
    const area = alert.areaDesc.split(";")[0].split(",").slice(0, 3).join(", ");
    parts.push(`for ${area}`);
  }
  let intro = parts.join(" ") + ".";
  let headline = alert.headline ?? "";
  headline = headline.replace(/\s+by\s+NWS\b.*$/i, "").trim();
  if (headline) intro += " " + headline;
  return intro;
}

function speakAlert(alert) { speak(composeSpeech(alert)); }
function speakDescription(alert) {
  const text = alert.description?.trim();
  if (text) speak(text);
}
function stopSpeaking() { speechSynthesis.cancel(); }

// --- fetch ---

async function fetchAlerts() {
  els.error.classList.add("hidden");
  const value = state.value?.trim();
  const isNational = state.type === "national";
  if (!isNational && !value) {
    setStatus(null, "Enter a value to look up");
    state.alertsById = new Map();
    rerender();
    return;
  }

  setStatus("loading", "Loading...");

  try {
    const params = new URLSearchParams({ type: state.type });
    if (!isNational) params.set("value", value);
    const url = `/api/alerts?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || body.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    handleAlerts(data);
    setStatus("live", `Live — refresh in ${POLL_MS / 1000}s`);
    els.updated.textContent = `Updated ${formatTime(data.updated)}`;
  } catch (err) {
    console.error(err);
    setStatus("error", "Error");
    els.error.textContent = `Couldn't fetch alerts: ${err.message}`;
    els.error.classList.remove("hidden");
  }
}

function handleAlerts(data) {
  const newAlerts = data.alerts ?? [];
  const fresh = newAlerts.filter(a => !state.seen.has(a.id));

  state.alertsById = new Map(newAlerts.map(a => [a.id, a]));
  rerender(fresh.map(a => a.id));

  for (const a of fresh) state.seen.add(a.id);
  saveSeen();

  // Auto-fit on the first data load for a given query.
  const queryKey = `${state.type}:${state.value}`;
  if (state.lastFittedQuery !== queryKey && state.polygonsById.size > 0) {
    fitToAlerts();
    state.lastFittedQuery = queryKey;
  }
}

function rerender(freshIds = []) {
  const all = [...state.alertsById.values()];
  state.filteredAlerts = applyFilters(all);
  updateFilterCount(state.filteredAlerts.length, all.length);

  els.alerts.innerHTML = "";
  if (!state.filteredAlerts.length) {
    els.empty.classList.remove("hidden");
  } else {
    els.empty.classList.add("hidden");
    const freshSet = new Set(freshIds);
    for (const a of state.filteredAlerts) {
      els.alerts.appendChild(renderAlert(a, freshSet.has(a.id)));
    }
  }

  if (state.map) renderPolygons();
}

function updateFilterCount(shown, total) {
  if (total === 0) {
    els.filterCount.textContent = "";
    return;
  }
  if (shown === total) {
    els.filterCount.textContent = `${total} alert${total === 1 ? "" : "s"}`;
  } else {
    els.filterCount.textContent =
      `Showing ${shown} of ${total} (filters hide ${total - shown})`;
  }
}

function renderAlert(alert, isNew) {
  const li = document.createElement("li");
  const sevClass = `severity-${(alert.severity ?? "Unknown").toLowerCase()}`;
  const flags = [
    isNew ? "is-new" : null,
    alert.isPds ? "is-pds" : null,
    alert.isEmergency ? "is-emergency" : null,
  ].filter(Boolean).join(" ");
  li.className = `alert ${sevClass} ${flags}`.trim();
  li.dataset.id = alert.id;

  if (alert.isEmergency) {
    const banner = document.createElement("div");
    banner.className = "emergency-banner";
    banner.textContent = (alert.event ?? "").toUpperCase().includes("FLASH FLOOD")
      ? "⚠ FLASH FLOOD EMERGENCY"
      : "⚠ TORNADO EMERGENCY";
    li.appendChild(banner);
  }

  const header = document.createElement("div");
  header.className = "alert-header";
  const eventEl = document.createElement("h2");
  eventEl.className = "alert-event";
  eventEl.textContent = alert.event ?? "Alert";

  const headerActions = document.createElement("div");
  headerActions.className = "alert-header-actions";
  if (alert.isPds) {
    const pdsBadge = document.createElement("span");
    pdsBadge.className = "pds-badge";
    pdsBadge.textContent = "PDS";
    pdsBadge.title = "Particularly Dangerous Situation";
    headerActions.appendChild(pdsBadge);
  }
  const badge = document.createElement("span");
  badge.className = "severity-badge";
  badge.textContent = alert.severity ?? "Unknown";
  headerActions.appendChild(badge);
  header.append(eventEl, headerActions);

  const meta = document.createElement("div");
  meta.className = "alert-meta";
  if (alert.areaDesc) {
    const area = document.createElement("span");
    area.className = "area";
    area.title = alert.areaDesc;
    area.textContent = alert.areaDesc;
    meta.appendChild(area);
  }
  if (alert.expires) meta.appendChild(metaSpan(`Until ${formatTime(alert.expires)}`));
  if (alert.senderName) meta.appendChild(metaSpan(alert.senderName));

  const headline = document.createElement("p");
  headline.className = "alert-headline";
  headline.textContent = alert.headline ?? alert.description?.slice(0, 200) ?? "";

  const actions = document.createElement("div");
  actions.className = "alert-actions";

  const readBtn = document.createElement("button");
  readBtn.className = "read-btn";
  readBtn.type = "button";
  readBtn.innerHTML = "🔈 Read";
  readBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    speechSynthesis.cancel();
    speakAlert(alert);
  });

  const locateBtn = document.createElement("button");
  locateBtn.type = "button";
  locateBtn.textContent = alert.geometry ? "📍 Locate" : "📍 No map data";
  locateBtn.disabled = !alert.geometry;
  locateBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    flyToAlert(alert);
    focusCard(alert.id, /* alsoFly */ false);
  });

  actions.append(readBtn, locateBtn);

  // Card-level interactions
  li.addEventListener("click", () => {
    focusCard(alert.id, /* alsoFly */ true);
  });
  li.addEventListener("mouseenter", () => highlightPolygon(alert.id, true));
  li.addEventListener("mouseleave", () => highlightPolygon(alert.id, false));

  li.append(header, meta, headline, actions);
  return li;
}

function metaSpan(text) {
  const s = document.createElement("span");
  s.textContent = text;
  return s;
}

function severityRank(s) {
  return ({ Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 })[s] ?? 4;
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function setStatus(kind, text) {
  els.status.classList.remove("live", "error", "loading");
  if (kind) els.status.classList.add(kind);
  els.statusText.textContent = text;
}

// --- polling ---

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(fetchAlerts, POLL_MS);
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPolling();
    setStatus(null, "Paused (tab hidden)");
  } else {
    fetchAlerts();
    startPolling();
  }
});

// --- wire up controls ---

function applySettingsToUI() {
  els.type.value = state.type;
  els.value.value = state.value;
  syncValueVisibility();
  for (const cb of els.filterChips) {
    cb.checked = state.filters.has(cb.dataset.filter);
  }
}

function syncValueVisibility() {
  const valueGroup = els.value.closest(".control-group");
  valueGroup.classList.toggle("hidden", state.type === "national");
}

for (const cb of els.filterChips) {
  cb.addEventListener("change", () => {
    if (cb.checked) state.filters.add(cb.dataset.filter);
    else state.filters.delete(cb.dataset.filter);
    saveSettings();
    rerender();
  });
}

els.type.addEventListener("change", () => {
  state.type = els.type.value;
  state.lastFittedQuery = null; // re-fit for the new query
  syncValueVisibility();
  saveSettings();
  fetchAlerts();
});

function commitValueChange() {
  const v = els.value.value.trim();
  if (!v) {
    els.value.value = state.value;
    return;
  }
  if (v === state.value) return;
  state.value = v;
  state.lastFittedQuery = null;
  saveSettings();
  fetchAlerts();
}

els.value.addEventListener("change", commitValueChange);
els.value.addEventListener("keydown", (e) => {
  if (e.key === "Enter") commitValueChange();
});

els.voice.addEventListener("change", () => {
  state.voiceURI = els.voice.value;
  saveSettings();
});

els.refresh.addEventListener("click", fetchAlerts);
els.fit.addEventListener("click", fitToAlerts);
els.speakAll.addEventListener("click", () => {
  speechSynthesis.cancel();
  const list = [...state.filteredAlerts]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  for (const a of list) speak(composeSpeech(a));
});
els.stop.addEventListener("click", stopSpeaking);

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if (e.key === "r" || e.key === "R") fetchAlerts();
  else if (e.key === "f" || e.key === "F") fitToAlerts();
  else if (e.key === "Escape") stopSpeaking();
});

// --- boot ---

loadSettings();
applySettingsToUI();
loadVoices();
initMap();
fetchAlerts().then(startPolling);
