const BASE_DATA_URL = "./data/base_points.json";
const STATUS_DATA_URL = "./data/status_points.json";
const MUNICIPALITY_GEOJSON_BASE_URL = "./data/geojson/regions";
const PROVINCE_GEOJSON_BASE_URL = "./data/geojson/provinces";
const TELEGRAM_BOT_USERNAME = "fibercop_alert_bot";

const DEFAULT_MAP_CENTER = [42.5, 12.5];
const DEFAULT_MAP_ZOOM = 6;
const FIXED_STATUS_OPTIONS = ["ATTIVO", "PIANIFICATO", "DISPONIBILE"];
const MUNICIPALITY_NAME_ALIASES = {
  "POPOLI TERME": "POPOLI",
  JONADI: "IONADI",
  "REGGIO CALABRIA": "REGGIO DI CALABRIA",
  "MONTAGNA SULLA STRADA DEL VINO": "MONTAGNA",
};
const PROVINCE_NAME_ALIASES = {
  "REGGIO CALABRIA": "REGGIO DI CALABRIA",
  "REGGIO EMILIA": "REGGIO NELLEMILIA",
  AOSTA: "VALLE DAOSTA",
};

const regionSelect = document.getElementById("regionSelect");
const provinceSelect = document.getElementById("provinceSelect");
const citySelect = document.getElementById("citySelect");
const stateSelect = document.getElementById("stateSelect");
const showButton = document.getElementById("showButton");
const resetButton = document.getElementById("resetButton");
const statusText = document.getElementById("statusText");
const statusSourceFile = document.getElementById("statusSourceFile");
const statusUpdatedAt = document.getElementById("statusUpdatedAt");

const map = L.map("map").setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const selectedAreaLayer = L.geoJSON(null, {
  style: {
    color: "#2563eb",
    weight: 3,
    fillColor: "#93c5fd",
    fillOpacity: 0.12,
  },
  interactive: false,
}).addTo(map);

let allPoints = [];
const markersLayer = L.layerGroup().addTo(map);
let statusMetadata = {
  source_file: "",
  updated_at: "",
};
const municipalityGeoJsonRequests = new Map();
const municipalityIndexes = new Map();
const provinceGeoJsonRequests = new Map();
const provinceIndexes = new Map();
let activeRenderRequestId = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeLookupValue(value) {
  return normalize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['`\u2019]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCurrentStatus(point) {
  return normalize(point.current_stato);
}

function buildRegionGeoJsonSlug(regionName) {
  return normalize(regionName)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split("/")[0]
    .replace(/['`\u2019]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function buildRegionGeoJsonUrl(regionName, baseUrl) {
  const regionSlug = buildRegionGeoJsonSlug(regionName);
  return regionSlug ? `${baseUrl}/${regionSlug}.geojson` : "";
}

function createLookupVariants(value, options = {}) {
  const rawValue = String(value ?? "").trim();
  const aliases = options.aliases ?? {};
  const variants = new Set();

  function addVariant(candidate) {
    const normalizedCandidate = normalizeLookupValue(candidate);

    if (!normalizedCandidate) {
      return;
    }

    variants.add(aliases[normalizedCandidate] ?? normalizedCandidate);
  }

  addVariant(rawValue);

  for (const slashPart of rawValue.split("/")) {
    addVariant(slashPart);
  }

  // Some bilingual labels use a hyphen between the Italian and minority-language names.
  if (rawValue.includes("-")) {
    const hyphenParts = rawValue.split("-").map((part) => part.trim()).filter(Boolean);

    if (hyphenParts.length === 2 && hyphenParts.every((part) => part.includes(" "))) {
      for (const hyphenPart of hyphenParts) {
        addVariant(hyphenPart);
      }
    }
  }

  return [...variants];
}

function createMunicipalityLookupVariants(value) {
  return createLookupVariants(value, {
    aliases: MUNICIPALITY_NAME_ALIASES,
  });
}

function createProvinceLookupVariants(value) {
  return createLookupVariants(value, {
    aliases: PROVINCE_NAME_ALIASES,
  });
}

function formatDisplayValue(value) {
  const normalizedValue = String(value ?? "").trim();
  return normalizedValue || "-";
}

function formatUpdatedAt(value) {
  const normalizedValue = String(value ?? "").trim();

  if (!normalizedValue) {
    return "Non disponibile";
  }

  const parsedDate = new Date(normalizedValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue;
  }

  return parsedDate.toLocaleString("it-IT", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function buildTelegramDeepLink(pointId) {
  const normalizedPointId = String(pointId ?? "").trim();

  if (!TELEGRAM_BOT_USERNAME || !normalizedPointId) {
    return "";
  }

  return `https://t.me/${encodeURIComponent(TELEGRAM_BOT_USERNAME)}?start=${encodeURIComponent(normalizedPointId)}`;
}

function renderStatusMetadata() {
  statusSourceFile.textContent = statusMetadata.source_file || "Non disponibile";
  statusUpdatedAt.textContent = formatUpdatedAt(statusMetadata.updated_at);
}

function mergePointsWithStatus(points, statusItems) {
  return points.map((point) => {
    const statusPoint = statusItems?.[point.id] ?? null;

    return {
      ...point,
      current_stato: statusPoint?.stato ?? null,
      current_data_disponibilita: statusPoint?.data_disponibilita ?? "",
    };
  });
}

function getSelectedFilters() {
  return {
    region: normalize(regionSelect.value),
    province: normalize(provinceSelect.value),
    city: normalize(citySelect.value),
    status: normalize(stateSelect.value),
  };
}

function populateRegions(points) {
  regionSelect.innerHTML = '<option value="">Seleziona una regione</option>';

  const regions = [...new Set(points.map((point) => normalize(point.regione)).filter(Boolean))].sort();

  for (const region of regions) {
    const option = document.createElement("option");
    option.value = region;
    option.textContent = region;
    regionSelect.appendChild(option);
  }
}

function populateProvinces(points, selectedRegion) {
  provinceSelect.innerHTML = '<option value="">Seleziona una provincia</option>';
  citySelect.innerHTML = '<option value="">Tutti i comuni</option>';
  citySelect.disabled = true;

  if (!selectedRegion) {
    provinceSelect.disabled = true;
    return;
  }

  const provinces = [
    ...new Set(
      points
        .filter((point) => normalize(point.regione) === selectedRegion)
        .map((point) => normalize(point.provincia))
        .filter(Boolean)
    ),
  ].sort();

  for (const province of provinces) {
    const option = document.createElement("option");
    option.value = province;
    option.textContent = province;
    provinceSelect.appendChild(option);
  }

  provinceSelect.disabled = false;
}

function populateCities(points, selectedRegion, selectedProvince) {
  citySelect.innerHTML = '<option value="">Tutti i comuni</option>';

  if (!selectedRegion || !selectedProvince) {
    citySelect.disabled = true;
    return;
  }

  const cities = [
    ...new Set(
      points
        .filter(
          (point) =>
            normalize(point.regione) === selectedRegion &&
            normalize(point.provincia) === selectedProvince
        )
        .map((point) => normalize(point.comune))
        .filter(Boolean)
    ),
  ].sort();

  for (const city of cities) {
    const option = document.createElement("option");
    option.value = city;
    option.textContent = city;
    citySelect.appendChild(option);
  }

  citySelect.disabled = false;
}

function populateStateOptions(points) {
  const selectedValue = normalize(stateSelect.value);
  const dynamicStates = [...new Set(points.map(getCurrentStatus).filter(Boolean))].sort();
  const stateOptions = [...new Set([...FIXED_STATUS_OPTIONS, ...dynamicStates])];

  stateSelect.innerHTML = '<option value="">Tutti gli stati</option>';

  for (const state of stateOptions) {
    const option = document.createElement("option");
    option.value = state;
    option.textContent = state;
    stateSelect.appendChild(option);
  }

  if (selectedValue && stateOptions.includes(selectedValue)) {
    stateSelect.value = selectedValue;
  }
}

function hasAreaMismatch(point, selectedArea) {
  if (!selectedArea) {
    return false;
  }

  if (selectedArea.region && normalize(point.regione) !== selectedArea.region) {
    return true;
  }

  if (selectedArea.province && normalize(point.provincia) !== selectedArea.province) {
    return true;
  }

  if (selectedArea.city && normalize(point.comune) !== selectedArea.city) {
    return true;
  }

  return false;
}

function buildPopup(point, options = {}) {
  const telegramDeepLink = buildTelegramDeepLink(point.id);
  const mismatchNotice =
    options.selectedArea && hasAreaMismatch(point, options.selectedArea)
      ? `
        <p class="popup-alert">
          Questo punto ricade nell'area selezionata ma nel dataset ufficiale e' associato a un comune/provincia/regione diversi.
        </p>
      `
      : "";
  const telegramAction = telegramDeepLink
    ? `
      <div class="popup-actions">
        <a
          class="popup-telegram-link"
          href="${telegramDeepLink}"
          target="_blank"
          rel="noopener noreferrer"
        >
          🔔 Avvisami su Telegram
        </a>
      </div>
    `
    : "";

  return `
    <div>
      <h3 class="popup-title">${escapeHtml(point.id)}</h3>
      ${mismatchNotice}
      <div class="popup-grid">
        <strong>ID</strong><span>${escapeHtml(point.id)}</span>
        <strong>Regione</strong><span>${escapeHtml(point.regione)}</span>
        <strong>Provincia</strong><span>${escapeHtml(point.provincia)}</span>
        <strong>Comune</strong><span>${escapeHtml(point.comune)}</span>
        <strong>Tipo</strong><span>${escapeHtml(point.tipo)}</span>
        <strong>ACL</strong><span>${escapeHtml(point.codice_acl)}</span>
        <strong>Stato attuale</strong><span>${escapeHtml(formatDisplayValue(point.current_stato))}</span>
        <strong>Data disponibilita attuale</strong><span>${escapeHtml(formatDisplayValue(point.current_data_disponibilita))}</span>
        <strong class="popup-secondary-label">Stato storico</strong><span class="popup-secondary-value">${escapeHtml(formatDisplayValue(point.stato))}</span>
        <strong class="popup-secondary-label">Data disponibilita storica</strong><span class="popup-secondary-value">${escapeHtml(formatDisplayValue(point.data_disponibilita))}</span>
        <strong>Indirizzo</strong><span>${escapeHtml(point.indirizzo || "-")}</span>
        <strong>Lat</strong><span>${escapeHtml(point.lat)}</span>
        <strong>Lon</strong><span>${escapeHtml(point.lon)}</span>
      </div>
      ${telegramAction}
    </div>
  `;
}

function clearMarkers() {
  markersLayer.clearLayers();
}

function clearAreaOverlay() {
  selectedAreaLayer.clearLayers();
}

function setDefaultMapView() {
  map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
}

function invalidatePendingRender() {
  activeRenderRequestId += 1;
}

function applyStatusFilter(points, selectedStatus) {
  if (!selectedStatus) {
    return points;
  }

  return points.filter((point) => getCurrentStatus(point) === selectedStatus);
}

function getAdministrativeFilteredPoints(filters, sourcePoints = allPoints) {
  if (!filters.region || !filters.province) {
    return [];
  }

  return sourcePoints.filter((point) => {
    const matchesRegion = normalize(point.regione) === filters.region;
    const matchesProvince = normalize(point.provincia) === filters.province;
    const matchesCity = !filters.city || normalize(point.comune) === filters.city;
    return matchesRegion && matchesProvince && matchesCity;
  });
}

function shouldUseMunicipalityGeographicFilter(filters) {
  return Boolean(filters.region && filters.province && filters.city);
}

function shouldUseProvinceGeographicFilter(filters) {
  return Boolean(filters.region && filters.province && !filters.city);
}

function buildMunicipalityFeatureKey(city, province) {
  return `${city}::${province}`;
}

function buildMunicipalityIndex(geoJson) {
  const byCity = new Map();
  const byCityProvince = new Map();

  for (const feature of geoJson.features ?? []) {
    const cityVariants = createMunicipalityLookupVariants(feature?.properties?.name);
    const provinceVariants = createProvinceLookupVariants(feature?.properties?.prov_name);

    if (!cityVariants.length) {
      continue;
    }

    for (const cityVariant of cityVariants) {
      if (!byCity.has(cityVariant)) {
        byCity.set(cityVariant, feature);
      }

      for (const provinceVariant of provinceVariants) {
        const featureKey = buildMunicipalityFeatureKey(cityVariant, provinceVariant);

        if (!byCityProvince.has(featureKey)) {
          byCityProvince.set(featureKey, feature);
        }
      }
    }
  }

  return {
    byCity,
    byCityProvince,
  };
}

function buildProvinceIndex(geoJson) {
  const byProvince = new Map();

  for (const feature of geoJson.features ?? []) {
    const provinceVariants = createProvinceLookupVariants(feature?.properties?.prov_name);

    for (const provinceVariant of provinceVariants) {
      if (!byProvince.has(provinceVariant)) {
        byProvince.set(provinceVariant, feature);
      }
    }
  }

  return {
    byProvince,
  };
}

async function loadRegionalGeoJsonData(regionName, baseUrl, requestCache, indexCache, indexBuilder) {
  const regionSlug = buildRegionGeoJsonSlug(regionName);

  if (!regionSlug) {
    return null;
  }

  if (!requestCache.has(regionSlug)) {
    requestCache.set(
      regionSlug,
      fetch(buildRegionGeoJsonUrl(regionName, baseUrl))
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          return response.json();
        })
        .then((geoJson) => {
          indexCache.set(regionSlug, indexBuilder(geoJson));
          return geoJson;
        })
        .catch((error) => {
          requestCache.delete(regionSlug);
          indexCache.delete(regionSlug);
          throw error;
        })
    );
  }

  const geoJson = await requestCache.get(regionSlug);

  if (!indexCache.has(regionSlug)) {
    indexCache.set(regionSlug, indexBuilder(geoJson));
  }

  return {
    regionSlug,
    geoJson,
    featureIndex: indexCache.get(regionSlug),
  };
}

function loadRegionMunicipalityData(regionName) {
  return loadRegionalGeoJsonData(
    regionName,
    MUNICIPALITY_GEOJSON_BASE_URL,
    municipalityGeoJsonRequests,
    municipalityIndexes,
    buildMunicipalityIndex
  );
}

function loadRegionProvinceData(regionName) {
  return loadRegionalGeoJsonData(
    regionName,
    PROVINCE_GEOJSON_BASE_URL,
    provinceGeoJsonRequests,
    provinceIndexes,
    buildProvinceIndex
  );
}

function findMunicipalityFeature(municipalityIndex, selectedCity, selectedProvince) {
  const cityVariants = createMunicipalityLookupVariants(selectedCity);
  const provinceVariants = createProvinceLookupVariants(selectedProvince);

  for (const cityVariant of cityVariants) {
    for (const provinceVariant of provinceVariants) {
      const feature = municipalityIndex.byCityProvince.get(
        buildMunicipalityFeatureKey(cityVariant, provinceVariant)
      );

      if (feature) {
        return feature;
      }
    }
  }

  for (const cityVariant of cityVariants) {
    const feature = municipalityIndex.byCity.get(cityVariant);

    if (feature) {
      return feature;
    }
  }

  return null;
}

function findProvinceFeature(provinceIndex, selectedProvince) {
  const provinceVariants = createProvinceLookupVariants(selectedProvince);

  for (const provinceVariant of provinceVariants) {
    const feature = provinceIndex.byProvince.get(provinceVariant);

    if (feature) {
      return feature;
    }
  }

  return null;
}

function isPointInsideBbox(lat, lon, bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

function filterPointsWithinArea(points, areaFeature) {
  if (!window.turf) {
    throw new Error("Turf.js non disponibile.");
  }

  const areaBbox = turf.bbox(areaFeature);

  return points.filter((point) => {
    const lat = Number(point.lat);
    const lon = Number(point.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return false;
    }

    // Cheap pre-check before the exact point-in-polygon test.
    if (!isPointInsideBbox(lat, lon, areaBbox)) {
      return false;
    }

    return turf.booleanPointInPolygon(turf.point([lon, lat]), areaFeature);
  });
}

function createAdministrativeResult(filters, options = {}) {
  const administrativePoints = getAdministrativeFilteredPoints(filters);

  return {
    points: applyStatusFilter(administrativePoints, filters.status),
    areaFeature: null,
    selectedArea: null,
    mode: "administrative",
    fallbackUsed: options.fallbackUsed ?? false,
  };
}

async function resolveMunicipalityGeographicResult(filters, fallbackResult) {
  try {
    const regionData = await loadRegionMunicipalityData(filters.region);

    if (!regionData) {
      return {
        ...fallbackResult,
        fallbackUsed: true,
      };
    }

    const municipalityFeature = findMunicipalityFeature(
      regionData.featureIndex,
      filters.city,
      filters.province
    );

    if (!municipalityFeature) {
      console.warn(
        "Comune non trovato nel GeoJSON regionale:",
        filters.region,
        regionData.regionSlug,
        filters.city
      );

      return {
        ...fallbackResult,
        fallbackUsed: true,
      };
    }

    return {
      points: applyStatusFilter(filterPointsWithinArea(allPoints, municipalityFeature), filters.status),
      areaFeature: municipalityFeature,
      selectedArea: {
        region: filters.region,
        province: filters.province,
        city: filters.city,
      },
      mode: "municipality-geographic",
      fallbackUsed: false,
    };
  } catch (error) {
    console.warn("Filtro geografico comunale non disponibile, uso fallback anagrafico:", error);
    return {
      ...fallbackResult,
      fallbackUsed: true,
    };
  }
}

async function resolveProvinceGeographicResult(filters, fallbackResult) {
  try {
    const regionData = await loadRegionProvinceData(filters.region);

    if (!regionData) {
      return {
        ...fallbackResult,
        fallbackUsed: true,
      };
    }

    const provinceFeature = findProvinceFeature(regionData.featureIndex, filters.province);

    if (!provinceFeature) {
      console.warn(
        "Provincia non trovata nel GeoJSON regionale:",
        filters.region,
        regionData.regionSlug,
        filters.province
      );

      return {
        ...fallbackResult,
        fallbackUsed: true,
      };
    }

    return {
      points: applyStatusFilter(filterPointsWithinArea(allPoints, provinceFeature), filters.status),
      areaFeature: provinceFeature,
      selectedArea: {
        region: filters.region,
        province: filters.province,
      },
      mode: "province-geographic",
      fallbackUsed: false,
    };
  } catch (error) {
    console.warn("Filtro geografico provinciale non disponibile, uso fallback anagrafico:", error);
    return {
      ...fallbackResult,
      fallbackUsed: true,
    };
  }
}

async function resolveFilteredPoints(filters) {
  const fallbackResult = createAdministrativeResult(filters);

  if (shouldUseMunicipalityGeographicFilter(filters)) {
    return resolveMunicipalityGeographicResult(filters, fallbackResult);
  }

  if (shouldUseProvinceGeographicFilter(filters)) {
    return resolveProvinceGeographicResult(filters, fallbackResult);
  }

  return fallbackResult;
}

function getMarkerStatusClass(point) {
  switch (getCurrentStatus(point)) {
    case "ATTIVO":
      return "point-marker--active";
    case "PIANIFICATO":
      return "point-marker--planned";
    case "DISPONIBILE":
      return "point-marker--available";
    default:
      return "point-marker--unknown";
  }
}

function createPointMarker(point, options = {}) {
  const lat = Number(point.lat);
  const lon = Number(point.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const marker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: "point-marker-icon",
      html: `<span class="point-marker ${getMarkerStatusClass(point)}"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -10],
    }),
  });

  marker.bindPopup(
    buildPopup(point, {
      selectedArea: options.selectedArea,
    })
  );

  return marker;
}

function fitMapToResults(markerBounds, areaFeature) {
  if (areaFeature) {
    const areaBounds = selectedAreaLayer.getBounds();

    if (areaBounds.isValid()) {
      map.fitBounds(areaBounds, { padding: [20, 20] });
      return;
    }
  }

  if (markerBounds.length > 0) {
    map.fitBounds(markerBounds, { padding: [20, 20] });
    return;
  }

  setDefaultMapView();
}

function renderPoints(points, options = {}) {
  clearMarkers();
  clearAreaOverlay();

  if (options.areaFeature) {
    selectedAreaLayer.addData(options.areaFeature);
  }

  const markerBounds = [];
  const uniqueCities = [...new Set(points.map((point) => normalize(point.comune)).filter(Boolean))].sort();

  for (const point of points) {
    const marker = createPointMarker(point, {
      selectedArea: options.selectedArea,
    });

    if (!marker) {
      continue;
    }

    marker.addTo(markersLayer);
    markerBounds.push([Number(point.lat), Number(point.lon)]);
  }

  fitMapToResults(markerBounds, options.areaFeature);

  if (!points.length && !options.areaFeature) {
    statusText.textContent = "Nessun punto trovato per il filtro selezionato.";
    return;
  }

  const region = regionSelect.value || "-";
  const province = provinceSelect.value || "-";
  const city = citySelect.value || "Tutti i comuni";
  const state = stateSelect.value || "Tutti gli stati";

  statusText.textContent =
    `Regione: ${region} | Provincia: ${province} | Comune: ${city} | Stato: ${state} | ` +
    `Punti mostrati: ${points.length} | Comuni distinti nel risultato: ${uniqueCities.length}`;
}

function handleRegionChange() {
  const selectedRegion = normalize(regionSelect.value);

  invalidatePendingRender();
  populateProvinces(allPoints, selectedRegion);

  clearMarkers();
  clearAreaOverlay();
  statusText.textContent = selectedRegion
    ? "Regione selezionata. Ora scegli una provincia."
    : "Seleziona una regione e una provincia per visualizzare i punti.";

  setDefaultMapView();
}

function handleProvinceChange() {
  const selectedRegion = normalize(regionSelect.value);
  const selectedProvince = normalize(provinceSelect.value);

  invalidatePendingRender();
  populateCities(allPoints, selectedRegion, selectedProvince);

  clearMarkers();
  clearAreaOverlay();

  if (!selectedRegion || !selectedProvince) {
    statusText.textContent = "Seleziona una provincia per continuare.";
    setDefaultMapView();
    return;
  }

  statusText.textContent =
    "Provincia selezionata. Scegli un comune, imposta uno stato se serve, poi premi 'Mostra punti'.";
  setDefaultMapView();
}

function handleCityChange() {
  invalidatePendingRender();
  const selectedCity = citySelect.value || "Tutti i comuni";
  statusText.textContent = `Comune selezionato: ${selectedCity}. Premi 'Mostra punti'.`;
}

function handleStateChange() {
  invalidatePendingRender();
  const selectedState = stateSelect.value || "Tutti gli stati";
  statusText.textContent = `Stato selezionato: ${selectedState}. Premi 'Mostra punti'.`;
}

function getLoadingMessage(filters) {
  if (shouldUseMunicipalityGeographicFilter(filters)) {
    return `Caricamento del confine comunale di ${citySelect.value}...`;
  }

  if (shouldUseProvinceGeographicFilter(filters)) {
    return `Caricamento del confine provinciale di ${provinceSelect.value}...`;
  }

  return "Applicazione dei filtri...";
}

async function handleShowPoints() {
  const filters = getSelectedFilters();
  const requestId = ++activeRenderRequestId;

  statusText.textContent = getLoadingMessage(filters);

  const result = await resolveFilteredPoints(filters);

  if (requestId !== activeRenderRequestId) {
    return;
  }

  const uniqueCities = [...new Set(result.points.map((point) => normalize(point.comune)).filter(Boolean))].sort();

  renderPoints(result.points, {
    areaFeature: result.areaFeature,
    selectedArea: result.selectedArea,
  });

  console.log("Filtro applicato:", {
    regione: regionSelect.value,
    provincia: provinceSelect.value,
    comune: citySelect.value || "(tutti)",
    stato: stateSelect.value || "(tutti)",
    modalita: result.mode,
    fallback: result.fallbackUsed,
    risultati: result.points.length,
    comuni_distinti: uniqueCities.length,
    primi_comuni: uniqueCities.slice(0, 10),
    esempio: result.points.slice(0, 5),
  });
}

function resetFilters() {
  invalidatePendingRender();

  regionSelect.value = "";
  provinceSelect.innerHTML = '<option value="">Seleziona una provincia</option>';
  provinceSelect.disabled = true;

  citySelect.innerHTML = '<option value="">Tutti i comuni</option>';
  citySelect.disabled = true;

  stateSelect.value = "";

  clearMarkers();
  clearAreaOverlay();
  statusText.textContent =
    "Seleziona una regione e una provincia per visualizzare i punti.";
  setDefaultMapView();
}

async function loadData() {
  try {
    const baseRequest = fetch(BASE_DATA_URL).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    });

    const statusRequest = fetch(STATUS_DATA_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      })
      .catch((error) => {
        console.warn("Impossibile caricare status_points.json:", error);
        return null;
      });

    const [basePoints, statusData] = await Promise.all([baseRequest, statusRequest]);

    statusMetadata = {
      source_file: statusData?.source_file ?? "",
      updated_at: statusData?.updated_at ?? "",
    };

    allPoints = mergePointsWithStatus(basePoints, statusData?.items ?? {});
    populateRegions(allPoints);
    populateStateOptions(allPoints);
    renderStatusMetadata();
    statusText.textContent =
      "Seleziona una regione e una provincia per visualizzare i punti.";
  } catch (error) {
    console.error(error);
    renderStatusMetadata();
    statusText.textContent = "Errore nel caricamento dei dati.";
  }
}

regionSelect.addEventListener("change", handleRegionChange);
provinceSelect.addEventListener("change", handleProvinceChange);
citySelect.addEventListener("change", handleCityChange);
stateSelect.addEventListener("change", handleStateChange);
showButton.addEventListener("click", handleShowPoints);
resetButton.addEventListener("click", resetFilters);

loadData();
