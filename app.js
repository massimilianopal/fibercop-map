const BASE_DATA_URL = "./data/base_points.json";
const STATUS_DATA_URL = "./data/status_points.json";
const ABRUZZO_GEOJSON_URL = "./data/geojson/regions/abruzzo.geojson";

const DEFAULT_MAP_CENTER = [42.5, 12.5];
const DEFAULT_MAP_ZOOM = 6;
const MUNICIPALITY_FILTER_REGION = "ABRUZZO";
const MUNICIPALITY_NAME_ALIASES = {
  "POPOLI TERME": "POPOLI",
};

const regionSelect = document.getElementById("regionSelect");
const provinceSelect = document.getElementById("provinceSelect");
const citySelect = document.getElementById("citySelect");
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

const municipalityLayer = L.geoJSON(null, {
  style: {
    color: "#2563eb",
    weight: 3,
    fillColor: "#93c5fd",
    fillOpacity: 0.12,
  },
  interactive: false,
}).addTo(map);

let allPoints = [];
let markersLayer = L.layerGroup().addTo(map);
let statusMetadata = {
  source_file: "",
  updated_at: "",
};
let abruzzoGeoJsonPromise = null;
let abruzzoMunicipalityIndex = null;
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

function normalizeGeoLookupValue(value) {
  return normalize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['`\u2019]/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMunicipalityLookup(value) {
  const normalizedValue = normalizeGeoLookupValue(value);
  return MUNICIPALITY_NAME_ALIASES[normalizedValue] ?? normalizedValue;
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
  };
}

function populateRegions(points) {
  regionSelect.innerHTML = '<option value="">Seleziona una regione</option>';

  const regions = [...new Set(points.map((p) => normalize(p.regione)).filter(Boolean))].sort();

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
        .filter((p) => normalize(p.regione) === selectedRegion)
        .map((p) => normalize(p.provincia))
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
          (p) =>
            normalize(p.regione) === selectedRegion &&
            normalize(p.provincia) === selectedProvince
        )
        .map((p) => normalize(p.comune))
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

function hasAreaMismatch(point, selectedArea) {
  if (!selectedArea) {
    return false;
  }

  return (
    normalize(point.regione) !== selectedArea.region ||
    normalize(point.provincia) !== selectedArea.province ||
    normalize(point.comune) !== selectedArea.city
  );
}

function buildPopup(point, options = {}) {
  const mismatchNotice =
    options.selectedArea && hasAreaMismatch(point, options.selectedArea)
      ? `
        <p class="popup-alert">
          Questo punto ricade nell'area selezionata ma nel dataset ufficiale e' associato a un comune/provincia/regione diversi.
        </p>
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
    </div>
  `;
}

function clearMarkers() {
  markersLayer.clearLayers();
}

function clearMunicipalityOverlay() {
  municipalityLayer.clearLayers();
}

function setDefaultMapView() {
  map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
}

function invalidatePendingRender() {
  activeRenderRequestId += 1;
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
  return filters.region === MUNICIPALITY_FILTER_REGION && Boolean(filters.city);
}

function buildMunicipalityFeatureKey(city, province) {
  return `${normalizeMunicipalityLookup(city)}::${normalizeGeoLookupValue(province)}`;
}

function buildMunicipalityIndex(geoJson) {
  const municipalityIndex = new Map();

  for (const feature of geoJson.features ?? []) {
    const cityName = feature?.properties?.name;
    const provinceName = feature?.properties?.prov_name;

    if (!cityName || !provinceName) {
      continue;
    }

    municipalityIndex.set(buildMunicipalityFeatureKey(cityName, provinceName), feature);
  }

  return municipalityIndex;
}

async function loadAbruzzoMunicipalityData() {
  if (!abruzzoGeoJsonPromise) {
    abruzzoGeoJsonPromise = fetch(ABRUZZO_GEOJSON_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      })
      .then((geoJson) => {
        abruzzoMunicipalityIndex = buildMunicipalityIndex(geoJson);
        return geoJson;
      })
      .catch((error) => {
        abruzzoGeoJsonPromise = null;
        abruzzoMunicipalityIndex = null;
        throw error;
      });
  }

  const geoJson = await abruzzoGeoJsonPromise;

  if (!abruzzoMunicipalityIndex) {
    abruzzoMunicipalityIndex = buildMunicipalityIndex(geoJson);
  }

  return {
    geoJson,
    municipalityIndex: abruzzoMunicipalityIndex,
  };
}

function findMunicipalityFeature(municipalityIndex, selectedCity, selectedProvince) {
  return municipalityIndex.get(buildMunicipalityFeatureKey(selectedCity, selectedProvince)) ?? null;
}

function isPointInsideBbox(lat, lon, bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

function filterPointsWithinMunicipality(points, municipalityFeature) {
  if (!window.turf) {
    throw new Error("Turf.js non disponibile.");
  }

  const municipalityBbox = turf.bbox(municipalityFeature);

  return points.filter((point) => {
    const lat = Number(point.lat);
    const lon = Number(point.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return false;
    }

    // Cheap pre-check before the exact point-in-polygon test.
    if (!isPointInsideBbox(lat, lon, municipalityBbox)) {
      return false;
    }

    return turf.booleanPointInPolygon(turf.point([lon, lat]), municipalityFeature);
  });
}

async function resolveFilteredPoints(filters) {
  const administrativePoints = getAdministrativeFilteredPoints(filters);

  // Keep the current administrative flow unless an Abruzzo municipality is selected.
  if (!shouldUseMunicipalityGeographicFilter(filters)) {
    return {
      points: administrativePoints,
      municipalityFeature: null,
      selectedArea: null,
      mode: "administrative",
      fallbackUsed: false,
    };
  }

  try {
    const { municipalityIndex } = await loadAbruzzoMunicipalityData();
    const municipalityFeature = findMunicipalityFeature(
      municipalityIndex,
      filters.city,
      filters.province
    );

    if (!municipalityFeature) {
      console.warn("Comune non trovato nel GeoJSON Abruzzo:", filters.city, filters.province);
      return {
        points: administrativePoints,
        municipalityFeature: null,
        selectedArea: null,
        mode: "administrative",
        fallbackUsed: true,
      };
    }

    return {
      points: filterPointsWithinMunicipality(allPoints, municipalityFeature),
      municipalityFeature,
      selectedArea: {
        region: filters.region,
        province: filters.province,
        city: filters.city,
      },
      mode: "municipality-geographic",
      fallbackUsed: false,
    };
  } catch (error) {
    console.warn("Filtro geografico non disponibile, uso fallback anagrafico:", error);
    return {
      points: administrativePoints,
      municipalityFeature: null,
      selectedArea: null,
      mode: "administrative",
      fallbackUsed: true,
    };
  }
}

function fitMapToResults(markerBounds, municipalityFeature) {
  if (municipalityFeature) {
    const municipalityBounds = municipalityLayer.getBounds();

    if (municipalityBounds.isValid()) {
      map.fitBounds(municipalityBounds, { padding: [20, 20] });
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
  clearMunicipalityOverlay();

  if (options.municipalityFeature) {
    municipalityLayer.addData(options.municipalityFeature);
  }

  const markerBounds = [];
  const uniqueCities = [...new Set(points.map((p) => normalize(p.comune)).filter(Boolean))].sort();

  for (const point of points) {
    const lat = Number(point.lat);
    const lon = Number(point.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    const marker = L.marker([lat, lon]);
    marker.bindPopup(
      buildPopup(point, {
        selectedArea: options.selectedArea,
      })
    );
    marker.addTo(markersLayer);
    markerBounds.push([lat, lon]);
  }

  fitMapToResults(markerBounds, options.municipalityFeature);

  if (!points.length && !options.municipalityFeature) {
    statusText.textContent = "Nessun punto trovato per il filtro selezionato.";
    return;
  }

  const region = regionSelect.value || "-";
  const province = provinceSelect.value || "-";
  const city = citySelect.value || "Tutti i comuni";

  statusText.textContent =
    `Regione: ${region} | Provincia: ${province} | Comune: ${city} | ` +
    `Punti mostrati: ${points.length} | Comuni distinti nel risultato: ${uniqueCities.length}`;
}

function handleRegionChange() {
  const selectedRegion = normalize(regionSelect.value);

  invalidatePendingRender();
  populateProvinces(allPoints, selectedRegion);

  clearMarkers();
  clearMunicipalityOverlay();
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
  clearMunicipalityOverlay();

  if (!selectedRegion || !selectedProvince) {
    statusText.textContent = "Seleziona una provincia per continuare.";
    setDefaultMapView();
    return;
  }

  statusText.textContent =
    "Provincia selezionata. Scegli un comune oppure lascia 'Tutti i comuni', poi premi 'Mostra punti'.";
  setDefaultMapView();
}

function handleCityChange() {
  invalidatePendingRender();
  const selectedCity = citySelect.value || "Tutti i comuni";
  statusText.textContent = `Comune selezionato: ${selectedCity}. Premi 'Mostra punti'.`;
}

async function handleShowPoints() {
  const filters = getSelectedFilters();
  const requestId = ++activeRenderRequestId;

  if (shouldUseMunicipalityGeographicFilter(filters)) {
    statusText.textContent = `Caricamento del confine comunale di ${citySelect.value}...`;
  }

  const result = await resolveFilteredPoints(filters);

  if (requestId !== activeRenderRequestId) {
    return;
  }

  const uniqueCities = [...new Set(result.points.map((p) => normalize(p.comune)).filter(Boolean))].sort();

  renderPoints(result.points, {
    municipalityFeature: result.municipalityFeature,
    selectedArea: result.selectedArea,
  });

  console.log("Filtro applicato:", {
    regione: regionSelect.value,
    provincia: provinceSelect.value,
    comune: citySelect.value || "(tutti)",
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

  clearMarkers();
  clearMunicipalityOverlay();
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
showButton.addEventListener("click", handleShowPoints);
resetButton.addEventListener("click", resetFilters);

loadData();
