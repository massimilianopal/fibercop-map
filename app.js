const DATA_URL = "./data/base_points.json";

const regionSelect = document.getElementById("regionSelect");
const provinceSelect = document.getElementById("provinceSelect");
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

function populateRegions(points) {
  const regions = [...new Set(points.map((p) => p.regione).filter(Boolean))].sort();

  for (const region of regions) {
    const option = document.createElement("option");
    option.value = region;
    option.textContent = region;
    regionSelect.appendChild(option);
  }
}

function populateProvinces(points, selectedRegion) {
  provinceSelect.innerHTML = '<option value="">Seleziona una provincia</option>';

  if (!selectedRegion) {
    provinceSelect.disabled = true;
    return;
  }

  const provinces = [
    ...new Set(
      points
        .filter((p) => p.regione === selectedRegion)
        .map((p) => p.provincia)
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

function buildPopup(point) {
  return `
    <div>
      <h3 class="popup-title">${escapeHtml(point.id)}</h3>
      <div class="popup-grid">
        <strong>Tipo</strong><span>${escapeHtml(point.tipo)}</span>
        <strong>Provincia</strong><span>${escapeHtml(point.provincia)}</span>
        <strong>Comune</strong><span>${escapeHtml(point.comune)}</span>
        <strong>ACL</strong><span>${escapeHtml(point.codice_acl)}</span>
        <strong>Stato</strong><span>${escapeHtml(point.stato)}</span>
        <strong>Disponibilità</strong><span>${escapeHtml(point.data_disponibilita || "-")}</span>
        <strong>Indirizzo</strong><span>${escapeHtml(point.indirizzo || "-")}</span>
      </div>
    </div>
  `;
}

function clearMarkers() {
  markersLayer.clearLayers();
}

function renderPoints(points) {
  clearMarkers();

  if (!points.length) {
    statusText.textContent = "Nessun punto trovato per il filtro selezionato.";
    map.setView([42.5, 12.5], 6);
    return;
  }

  const bounds = [];

  for (const point of points) {
    const marker = L.marker([point.lat, point.lon]);
    marker.bindPopup(buildPopup(point));
    marker.addTo(markersLayer);
    bounds.push([point.lat, point.lon]);
  }

  statusText.textContent = `Punti mostrati: ${points.length}`;
  map.fitBounds(bounds, { padding: [20, 20] });
}

function handleRegionChange() {
  const selectedRegion = regionSelect.value;
  populateProvinces(allPoints, selectedRegion);
  clearMarkers();

  if (!selectedRegion) {
    statusText.textContent = "Seleziona una regione e una provincia per visualizzare i punti.";
    map.setView([42.5, 12.5], 6);
    return;
  }

  statusText.textContent = "Regione selezionata. Ora scegli una provincia.";
  map.setView([42.5, 12.5], 6);
}

function handleProvinceChange() {
  const selectedRegion = regionSelect.value;
  const selectedProvince = provinceSelect.value;

  if (!selectedRegion || !selectedProvince) {
    clearMarkers();
    statusText.textContent = "Seleziona una provincia per visualizzare i punti.";
    return;
  }

  const filteredPoints = allPoints.filter(
    (p) => p.regione === selectedRegion && p.provincia === selectedProvince
  );

  renderPoints(filteredPoints);
}

function resetFilters() {
  regionSelect.value = "";
  provinceSelect.innerHTML = '<option value="">Seleziona una provincia</option>';
  provinceSelect.disabled = true;
  clearMarkers();
  statusText.textContent = "Seleziona una regione e una provincia per visualizzare i punti.";
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
    statusText.textContent = "Seleziona una regione e una provincia per visualizzare i punti.";
  } catch (error) {
    console.error(error);
    statusText.textContent = "Errore nel caricamento dei dati.";
  }
}

regionSelect.addEventListener("change", handleRegionChange);
provinceSelect.addEventListener("change", handleProvinceChange);
resetButton.addEventListener("click", resetFilters);

loadData();