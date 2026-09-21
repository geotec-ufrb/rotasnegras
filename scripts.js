const BRAZIL_CENTER = [-14.235, -51.9253];
const BRAZIL_ZOOM = 4;

const map = L.map('map', { zoomControl: true }).setView(BRAZIL_CENTER, BRAZIL_ZOOM);

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

const satelliteLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
  subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
  attribution: '&copy; Google Maps',
  maxZoom: 20
});

L.control.layers({
  'Mapa': osmLayer,
  'Satélite': satelliteLayer
}, null, { position: 'topright' }).addTo(map);

L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

const northControl = L.control({ position: 'topright' });
northControl.onAdd = function () {
  const container = L.DomUtil.create('div', 'compass-control');
  container.innerHTML = '<img src="compass.png" alt="Norte">';
  return container;
};
northControl.addTo(map);

const fullscreenControl = L.control({ position: 'topright' });
fullscreenControl.onAdd = function () {
  const button = L.DomUtil.create('button', 'fullscreen-control');
  button.type = 'button';
  button.setAttribute('aria-label', 'Exibir mapa em tela cheia');
  button.textContent = '⛶ Tela cheia';
  L.DomEvent.disableClickPropagation(button);
  L.DomEvent.on(button, 'click', () => {
    const mapElement = document.getElementById('map');
    if (!document.fullscreenElement) {
      mapElement.requestFullscreen().catch(error => console.error('Não foi possível abrir a tela cheia:', error));
    } else {
      document.exitFullscreen();
    }
  });
  return button;
};
fullscreenControl.addTo(map);

const legend = L.control({ position: 'bottomright' });
legend.onAdd = function () {
  const container = L.DomUtil.create('div', 'map-legend');
  container.innerHTML = '<span aria-hidden="true"></span> Roteiro mapeado';
  return container;
};
legend.addTo(map);

const blackIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-black.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  shadowAnchor: [12, 41]
});

const sinapirIcon = L.divIcon({
  className: 'sinapir-marker-icon',
  html: `
    <svg viewBox="0 0 28 40" aria-hidden="true" focusable="false">
      <path class="sinapir-marker-shape" d="M14 1C6.82 1 1 6.82 1 14c0 9.75 13 25 13 25s13-15.25 13-25C27 6.82 21.18 1 14 1Z" />
      <circle class="sinapir-marker-center" cx="14" cy="14" r="4.5" />
    </svg>
  `,
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  popupAnchor: [0, -36]
});

const markerLayer = L.layerGroup().addTo(map);
const filterToggle = document.getElementById('filter-toggle');
const filterPanel = document.getElementById('filter-panel');
const filterClose = document.getElementById('filter-close');
const searchInput = document.getElementById('search-input');
const stateFilter = document.getElementById('state-filter');
const cityFilter = document.getElementById('city-filter');
const clearFilters = document.getElementById('clear-filters');
const resultCount = document.getElementById('result-count');
const filterSummary = document.getElementById('filter-summary');
const mapMessage = document.getElementById('map-message');

let routes = [];
let searchTimer;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

function normalizeSinapirValue(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sinapirMunicipalityKey(municipality, state) {
  return `${normalizeSinapirValue(municipality)}|${String(state || '').trim().toUpperCase()}`;
}

function isSinapirMunicipality(route) {
  return MUNICIPIOS_SINAPIR.has(sinapirMunicipalityKey(route.municipio, route.uf));
}

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = String(value || '');
  return element.innerHTML;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function setSelectOptions(select, values, defaultLabel) {
  const selected = select.value;
  select.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = defaultLabel;
  select.appendChild(defaultOption);

  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  if (values.includes(selected)) {
    select.value = selected;
  }
}

function updateCityOptions() {
  const state = stateFilter.value;
  const matchingRoutes = state ? routes.filter(route => route.uf === state) : routes;
  setSelectOptions(cityFilter, uniqueSorted(matchingRoutes.map(route => route.municipio)), 'Todos os municípios');
}

function markerPopup(route) {
  const contact = route.contato
    ? `<p class="popup-contact">${escapeHtml(route.contato)}</p>`
    : '';

  return `
    <article class="route-popup">
      <div class="popup-location">${escapeHtml(route.municipio)} · ${escapeHtml(route.uf)}</div>
      <strong>${escapeHtml(route.roteiros)}</strong>
      ${contact}
    </article>
  `;
}

function addMarkers(items) {
  markerLayer.clearLayers();

  items.forEach(route => {
    const markerIcon = isSinapirMunicipality(route) ? sinapirIcon : blackIcon;

    L.marker([Number(route.y), Number(route.x)], {
      icon: markerIcon,
      title: `${route.roteiros} — ${route.municipio}/${route.uf}`
    })
      .bindPopup(markerPopup(route), { maxWidth: 320 })
      .addTo(markerLayer);
  });
}

function applyFilters({ adjustMap = true } = {}) {
  const query = normalizeText(searchInput.value);
  const state = stateFilter.value;
  const city = cityFilter.value;

  const filtered = routes.filter(route => {
    const searchableText = normalizeText(`${route.roteiros} ${route.municipio} ${route.uf} ${route.contato || ''}`);
    return (!query || searchableText.includes(query))
      && (!state || route.uf === state)
      && (!city || route.municipio === city);
  });

  addMarkers(filtered);

  const totalLabel = filtered.length === 1 ? '1 roteiro' : `${filtered.length} roteiros`;
  resultCount.textContent = totalLabel;
  filterSummary.textContent = filtered.length === routes.length
    ? 'Mostrando todos os roteiros.'
    : `Mostrando ${totalLabel} de ${routes.length}.`;
  mapMessage.hidden = filtered.length > 0;

  if (!adjustMap) return;

  const hasActiveFilters = Boolean(query || state || city);
  if (filtered.length > 0 && hasActiveFilters) {
    const bounds = L.latLngBounds(filtered.map(route => [Number(route.y), Number(route.x)]));
    map.fitBounds(bounds, { padding: [55, 55], maxZoom: 9 });
  } else if (!hasActiveFilters) {
    map.setView(BRAZIL_CENTER, BRAZIL_ZOOM);
  }
}

function openFilters() {
  filterPanel.hidden = false;
  filterToggle.setAttribute('aria-expanded', 'true');
  window.setTimeout(() => searchInput.focus(), 0);
}

function closeFilters() {
  filterPanel.hidden = true;
  filterToggle.setAttribute('aria-expanded', 'false');
  filterToggle.focus();
}

filterToggle.addEventListener('click', () => {
  if (filterPanel.hidden) openFilters();
  else closeFilters();
});

filterClose.addEventListener('click', closeFilters);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !filterPanel.hidden) closeFilters();
});

searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => applyFilters(), 180);
});

stateFilter.addEventListener('change', () => {
  updateCityOptions();
  applyFilters();
});

cityFilter.addEventListener('change', () => applyFilters());

clearFilters.addEventListener('click', () => {
  searchInput.value = '';
  stateFilter.value = '';
  updateCityOptions();
  cityFilter.value = '';
  applyFilters();
  searchInput.focus();
});

document.addEventListener('fullscreenchange', () => {
  window.setTimeout(() => map.invalidateSize(), 120);
});

document.getElementById('current-year').textContent = new Date().getFullYear();

fetch('rotas_completo.json')
  .then(response => {
    if (!response.ok) throw new Error(`Falha ao carregar os dados (${response.status})`);
    return response.json();
  })
  .then(data => {
    routes = data.filter(route => Number.isFinite(Number(route.x)) && Number.isFinite(Number(route.y)));
    setSelectOptions(stateFilter, uniqueSorted(routes.map(route => route.uf)), 'Todos os estados');
    updateCityOptions();
    applyFilters({ adjustMap: false });
  })
  .catch(error => {
    console.error('Erro ao carregar os roteiros:', error);
    resultCount.textContent = 'Dados indisponíveis';
    filterSummary.textContent = 'Não foi possível carregar os roteiros.';
    mapMessage.hidden = false;
    mapMessage.querySelector('strong').textContent = 'Não foi possível carregar o mapa';
    mapMessage.querySelector('span').textContent = 'Atualize a página e tente novamente.';
  });
