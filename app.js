const DATA_URL = "./data/base_points.json";

const regionSelect = document.getElementById("regionSelect");
const provinceSelect = document.getElementById("provinceSelect");
const citySelect = document.getElementById("citySelect");
const showButton = document.getElementById("showButton");
const resetButton = document.getElementById("resetButton");
const statusText = document.getElementById("statusText");

const map = L.map("map").setView([42.5, 12.5], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

let allPoints = [];
let markersLayer = L.layerGroup().addTo(map);

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

function buildPopup(point) {
  return `
    <div>
      <h3 class="popup-title">${escapeHtml(point.id)}</h3>
      <div class="popup-grid">
        <strong>Regione</strong><span>${escapeHtml(point.regione)}</span>
        <strong>Provincia</strong><span>${escapeHtml(point.provincia)}</span>
        <strong>Comune</strong><span>${escapeHtml(point.comune)}</span>
        <strong>Tipo</strong><span>${escapeHtml(point.tipo)}</span>
        <strong>ACL</strong><span>${escapeHtml(point.codice_acl)}</span>
        <strong>Stato</strong><span>${escapeHtml(point.stato)}</span>
        <strong>Disponibilità</strong><span>${escapeHtml(point.data_disponibilita || "-")}</span>
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

function getFilteredPoints() {
  const selectedRegion = normalize(regionSelect.value);
  const selectedProvince = normalize(provinceSelect.value);
  const selectedCity = normalize(citySelect.value);

  if (!selectedRegion || !selectedProvince) {
    return [];
  }

  return allPoints.filter((point) => {
    const matchesRegion = normalize(point.regione) === selectedRegion;
    const matchesProvince = normalize(point.provincia) === selectedProvince;
    const matchesCity = !selectedCity || normalize(point.comune) === selectedCity;
    return matchesRegion && matchesProvince && matchesCity;
  });
}

function renderPoints(points) {
  clearMarkers();

  if (!points.length) {
    statusText.textContent = "Nessun punto trovato per il filtro selezionato.";
    map.setView([42.5, 12.5], 6);
    return;
  }

  const bounds = [];
  const uniqueCities = [...new Set(points.map((p) => normalize(p.comune)).filter(Boolean))].sort();

  for (const point of points) {
    const lat = Number(point.lat);
    const lon = Number(point.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    const marker = L.marker([lat, lon]);
    marker.bindPopup(buildPopup(point));
    marker.addTo(markersLayer);
    bounds.push([lat, lon]);
  }

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [20, 20] });
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

  populateProvinces(allPoints, selectedRegion);

  clearMarkers();
  statusText.textContent = selectedRegion
    ? "Regione selezionata. Ora scegli una provincia."
    : "Seleziona una regione e una provincia per visualizzare i punti.";

  map.setView([42.5, 12.5], 6);
}

function handleProvinceChange() {
  const selectedRegion = normalize(regionSelect.value);
  const selectedProvince = normalize(provinceSelect.value);

  populateCities(allPoints, selectedRegion, selectedProvince);

  clearMarkers();

  if (!selectedRegion || !selectedProvince) {
    statusText.textContent = "Seleziona una provincia per continuare.";
    map.setView([42.5, 12.5], 6);
    return;
  }

  statusText.textContent =
    "Provincia selezionata. Scegli un comune oppure lascia 'Tutti i comuni', poi premi 'Mostra punti'.";
  map.setView([42.5, 12.5], 6);
}

function handleCityChange() {
  const selectedCity = citySelect.value || "Tutti i comuni";
  statusText.textContent = `Comune selezionato: ${selectedCity}. Premi 'Mostra punti'.`;
}

function handleShowPoints() {
  const filteredPoints = getFilteredPoints();
  const uniqueCities = [...new Set(filteredPoints.map((p) => normalize(p.comune)).filter(Boolean))].sort();

  renderPoints(filteredPoints);

  console.log("Filtro applicato:", {
    regione: regionSelect.value,
    provincia: provinceSelect.value,
    comune: citySelect.value || "(tutti)",
    risultati: filteredPoints.length,
    comuni_distinti: uniqueCities.length,
    primi_comuni: uniqueCities.slice(0, 10),
    esempio: filteredPoints.slice(0, 5),
  });
}

function resetFilters() {
  regionSelect.value = "";
  provinceSelect.innerHTML = '<option value="">Seleziona una provincia</option>';
  provinceSelect.disabled = true;

  citySelect.innerHTML = '<option value="">Tutti i comuni</option>';
  citySelect.disabled = true;

  clearMarkers();
  statusText.textContent =
    "Seleziona una regione e una provincia per visualizzare i punti.";
  map.setView([42.5, 12.5], 6);
}

async function loadData() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    allPoints = await response.json();
    populateRegions(allPoints);
    statusText.textContent =
      "Seleziona una regione e una provincia per visualizzare i punti.";
  } catch (error) {
    console.error(error);
    statusText.textContent = "Errore nel caricamento dei dati.";
  }
}

regionSelect.addEventListener("change", handleRegionChange);
provinceSelect.addEventListener("change", handleProvinceChange);
citySelect.addEventListener("change", handleCityChange);
showButton.addEventListener("click", handleShowPoints);
resetButton.addEventListener("click", resetFilters);

loadData();