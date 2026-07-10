const CONFIG = {
  manifestUrl: 'data/latest.json',
  fallbackManifestUrl: 'data/demo-latest.json',
  basemapStyle: 'https://tiles.openfreemap.org/styles/liberty',
  initialView: { center: [8, 22], zoom: 1.45 },
  citySource: 'city-temperatures',
  clusters: 'temperature-clusters',
  unit: 'c',
};

const TEMP_STOPS = [
  [-20, '#315eb8'], [0, '#2fa7b2'], [12, '#b8d36e'],
  [22, '#f6c552'], [32, '#e8582c'], [42, '#9d2e20'],
];

const state = { manifest: null, cities: [], map: null, protocol: null, unit: 'c', selected: null };
const ui = {
  loading: document.querySelector('#map-loading'),
  status: document.querySelector('#snapshot-status'),
  date: document.querySelector('#snapshot-date'),
  source: document.querySelector('#snapshot-source'),
  coverage: document.querySelector('#coverage-count'),
  selection: document.querySelector('#selection'),
  search: document.querySelector('#city-search'),
  results: document.querySelector('#search-results'),
  clear: document.querySelector('#clear-search'),
  scaleUnit: document.querySelector('#scale-unit'),
};

function celsiusToFahrenheit(value) { return (value * 9) / 5 + 32; }
function formatTemperature(celsius) {
  const value = state.unit === 'f' ? celsiusToFahrenheit(celsius) : celsius;
  return `${Math.round(value)}°${state.unit.toUpperCase()}`;
}
function temperatureExpression(property = 'temp_c') {
  const input = Array.isArray(property) ? property : ['get', property];
  return ['interpolate', ['linear'], input, ...TEMP_STOPS.flat()];
}
function temperatureLabelExpression(unit = state.unit, property = 'temp_c') {
  const celsius = Array.isArray(property) ? property : ['get', property];
  const value = unit === 'f'
    ? ['round', ['+', ['*', celsius, 9 / 5], 32]]
    : ['round', celsius];
  return ['concat', ['to-string', value], '°'];
}
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
function showLoading(isLoading) { ui.loading.classList.toggle('is-hidden', !isLoading); }
function pointFeature(city) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [city.lon, city.lat] },
    properties: city,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function loadManifest() {
  try {
    return await fetchJson(CONFIG.manifestUrl);
  } catch (error) {
    console.warn('Daily manifest unavailable, using local demo snapshot.', error);
    return fetchJson(CONFIG.fallbackManifestUrl);
  }
}

async function loadSnapshot() {
  state.manifest = await loadManifest();
  const { manifest } = state;
  ui.date.textContent = manifest.display_date || manifest.snapshot_date;
  ui.source.textContent = manifest.provider_name || 'Temperature snapshot';
  ui.status.textContent = `Snapshot ${manifest.snapshot_date} · ${manifest.coverage.city_count.toLocaleString()} cities`;
  ui.coverage.textContent = `${manifest.coverage.city_count.toLocaleString()} cities`;

  if (manifest.tiles?.pmtiles_url) {
    state.cities = [];
    return { mode: 'pmtiles', url: manifest.tiles.pmtiles_url };
  }

  const snapshot = await fetchJson(manifest.tiles.geojson_url);
  state.cities = snapshot.features.map(feature => ({ ...feature.properties, lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] }));
  return { mode: 'geojson', data: snapshot };
}

function addLayers(source, mode) {
  const map = state.map;
  map.addSource(CONFIG.citySource, source);

  if (mode === 'pmtiles') {
    addPmtilesLayers(map);
    return;
  }

  map.addLayer({
    id: CONFIG.clusters,
    type: 'circle',
    source: CONFIG.citySource,
    filter: ['has', 'point_count'],
    maxzoom: 5.5,
    paint: {
      'circle-color': temperatureExpression(['/', ['get', 'temperature_sum'], ['get', 'point_count']]),
      'circle-opacity': 0.88,
      'circle-radius': ['step', ['get', 'point_count'], 15, 20, 21, 100, 27, 500, 34],
      'circle-stroke-color': '#fbfaf5',
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: CONFIG.citySource,
    filter: ['has', 'point_count'],
    maxzoom: 5.5,
    layout: {
      'text-field': temperatureLabelExpression(state.unit, ['/', ['get', 'temperature_sum'], ['get', 'point_count']]),
      'text-font': ['Noto Sans Bold'],
      'text-size': 11,
    },
    paint: { 'text-color': '#172321' },
  });
  map.addLayer({
    id: 'city-halo',
    type: 'circle',
    source: CONFIG.citySource,
    filter: ['!', ['has', 'point_count']],
    minzoom: 2.8,
    paint: { 'circle-color': '#fbfaf5', 'circle-radius': 15, 'circle-opacity': 0.92 },
  });
  map.addLayer({
    id: 'cities',
    type: 'circle',
    source: CONFIG.citySource,
    filter: ['!', ['has', 'point_count']],
    minzoom: 2.8,
    paint: {
      'circle-color': temperatureExpression(),
      'circle-radius': 13,
      'circle-stroke-color': '#172321',
      'circle-stroke-width': 0.8,
    },
  });
  map.addLayer({
    id: 'city-labels',
    type: 'symbol',
    source: CONFIG.citySource,
    filter: ['all', ['!', ['has', 'point_count']], ['>=', ['get', 'population'], 300000]],
    minzoom: 4.2,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 7, 12],
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#172321', 'text-halo-color': '#fbfaf5', 'text-halo-width': 1.25 },
  });
  map.addLayer({
    id: 'city-temperature-labels',
    type: 'symbol',
    source: CONFIG.citySource,
    filter: ['!', ['has', 'point_count']],
    minzoom: 4.1,
    layout: {
      'text-field': temperatureLabelExpression(),
      'text-font': ['Noto Sans Bold'],
      'text-size': 10,
      'text-offset': [0, 0],
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#172321', 'text-halo-color': '#fbfaf5', 'text-halo-width': 1.5 },
  });
}

function addPmtilesLayers(map) {
  const aggregateLayer = {
    source: CONFIG.citySource,
    'source-layer': 'aggregates',
  };
  const cityLayer = {
    source: CONFIG.citySource,
    'source-layer': 'cities',
  };
  map.addLayer({
    id: CONFIG.clusters,
    type: 'circle',
    ...aggregateLayer,
    maxzoom: 5.5,
    paint: {
      'circle-color': temperatureExpression(),
      'circle-opacity': 0.88,
      'circle-radius': ['step', ['get', 'count'], 15, 20, 21, 100, 27, 500, 34],
      'circle-stroke-color': '#fbfaf5',
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    ...aggregateLayer,
    maxzoom: 5.5,
    layout: { 'text-field': temperatureLabelExpression(), 'text-font': ['Noto Sans Bold'], 'text-size': 11 },
    paint: { 'text-color': '#172321' },
  });
  map.addLayer({
    id: 'city-halo',
    type: 'circle',
    ...cityLayer,
    minzoom: 2.8,
    paint: { 'circle-color': '#fbfaf5', 'circle-radius': 15, 'circle-opacity': 0.92 },
  });
  map.addLayer({
    id: 'cities',
    type: 'circle',
    ...cityLayer,
    minzoom: 2.8,
    paint: {
      'circle-color': temperatureExpression(),
      'circle-radius': 13,
      'circle-stroke-color': '#172321',
      'circle-stroke-width': 0.8,
    },
  });
  map.addLayer({
    id: 'city-labels',
    type: 'symbol',
    ...cityLayer,
    minzoom: 4.2,
    filter: ['>=', ['get', 'population'], 300000],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 7, 12],
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#172321', 'text-halo-color': '#fbfaf5', 'text-halo-width': 1.25 },
  });
  map.addLayer({
    id: 'city-temperature-labels',
    type: 'symbol',
    ...cityLayer,
    minzoom: 4.1,
    layout: {
      'text-field': temperatureLabelExpression(),
      'text-font': ['Noto Sans Bold'],
      'text-size': 10,
      'text-offset': [0, 0],
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#172321', 'text-halo-color': '#fbfaf5', 'text-halo-width': 1.5 },
  });
}

function renderSelection(properties) {
  state.selected = properties;
  const measuredAt = state.manifest.observed_at ? new Date(state.manifest.observed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : 'Daily snapshot';
  ui.selection.className = 'selection';
  ui.selection.innerHTML = `
    <p class="selection-kicker">${escapeHtml(measuredAt)}</p>
    <h2 class="selection-city">${escapeHtml(properties.name)}</h2>
    <p class="selection-country">${escapeHtml(properties.country)}</p>
    <div class="selection-temp"><span class="selection-value">${formatTemperature(Number(properties.temp_c))}</span><span class="selection-label">2m air temp</span></div>
    <div class="selection-meta"><span>${escapeHtml(properties.country_code)}</span><span>${Number(properties.lat).toFixed(2)}°, ${Number(properties.lon).toFixed(2)}°</span></div>`;
}

function setupInteractions(mode) {
  const map = state.map;
  map.on('click', CONFIG.clusters, async event => {
    const feature = event.features?.[0];
    if (!feature) return;
    if (mode === 'pmtiles') {
      map.easeTo({ center: event.lngLat, zoom: Math.min(map.getZoom() + 2, 7), duration: 600 });
      return;
    }
    const source = map.getSource(CONFIG.citySource);
    const zoom = await source.getClusterExpansionZoom(feature.properties.cluster_id);
    map.easeTo({ center: feature.geometry.coordinates, zoom, duration: 600 });
  });
  map.on('click', 'cities', event => {
    const feature = event.features?.[0];
    if (feature) renderSelection(feature.properties);
  });
  for (const layer of [CONFIG.clusters, 'cities']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }
}

function setupSearch() {
  const renderResults = query => {
    const term = query.trim().toLocaleLowerCase();
    ui.clear.hidden = !term;
    if (!term || state.cities.length === 0) { ui.results.hidden = true; return; }
    const matches = state.cities.filter(city => `${city.name} ${city.country} ${city.country_code}`.toLocaleLowerCase().includes(term))
      .sort((a, b) => b.population - a.population).slice(0, 7);
    ui.results.hidden = matches.length === 0;
    ui.results.innerHTML = matches.map(city => `<button class="search-result" type="button" data-city-id="${escapeHtml(city.id)}"><span><span class="result-name">${escapeHtml(city.name)}</span><br><span class="result-country">${escapeHtml(city.country)}</span></span><span class="result-temp">${formatTemperature(city.temp_c)}</span></button>`).join('');
  };
  ui.search.addEventListener('input', event => renderResults(event.target.value));
  document.querySelector('#search-form').addEventListener('submit', event => event.preventDefault());
  ui.clear.addEventListener('click', () => { ui.search.value = ''; renderResults(''); ui.search.focus(); });
  ui.results.addEventListener('click', event => {
    const button = event.target.closest('[data-city-id]');
    if (!button) return;
    const city = state.cities.find(item => item.id === button.dataset.cityId);
    if (!city) return;
    state.map.flyTo({ center: [city.lon, city.lat], zoom: 7, essential: true });
    renderSelection(city);
    ui.results.hidden = true;
  });
}

function setUnit(unit) {
  state.unit = unit;
  document.querySelectorAll('.unit-button').forEach(button => button.classList.toggle('is-active', button.dataset.unit === unit));
  ui.scaleUnit.textContent = `°${unit.toUpperCase()}`;
  document.querySelectorAll('.scale-labels span').forEach((label, index) => {
    const celsius = [-20, 0, 20, 40][index];
    label.textContent = `${Math.round(unit === 'f' ? celsiusToFahrenheit(celsius) : celsius)}°`;
  });
  if (state.map?.getLayer('city-temperature-labels')) {
    state.map.setLayoutProperty('city-temperature-labels', 'text-field', temperatureLabelExpression(unit));
  }
  if (state.map?.getLayer('cluster-count')) {
    const clusterTemperature = state.manifest.tiles?.pmtiles_url
      ? temperatureLabelExpression(unit)
      : temperatureLabelExpression(unit, ['/', ['get', 'temperature_sum'], ['get', 'point_count']]);
    state.map.setLayoutProperty('cluster-count', 'text-field', clusterTemperature);
  }
  if (state.selected) renderSelection(state.selected);
}

async function initialise() {
  try {
    const data = await loadSnapshot();
    if (data.mode === 'pmtiles') {
      const { Protocol } = await import('https://cdn.jsdelivr.net/npm/pmtiles@4.3.0/+esm');
      state.protocol = new Protocol();
      maplibregl.addProtocol('pmtiles', state.protocol.tile);
    }
    state.map = new maplibregl.Map({
      container: 'map', style: CONFIG.basemapStyle, ...CONFIG.initialView,
      maxZoom: 13, minZoom: 1, attributionControl: true,
    });
    state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    state.map.once('load', () => {
      const source = data.mode === 'pmtiles'
        ? { type: 'vector', url: `pmtiles://${data.url}`, promoteId: 'id' }
        : { type: 'geojson', data: data.data, cluster: true, clusterRadius: 45, clusterMaxZoom: 5, clusterProperties: { temperature_sum: ['+', ['get', 'temp_c']] } };
      addLayers(source, data.mode);
      setupInteractions(data.mode);
      showLoading(false);
    });
    setupSearch();
  } catch (error) {
    console.error(error);
    ui.status.textContent = 'Daily snapshot could not be loaded';
    ui.loading.textContent = 'Unable to load the atlas';
  }
}

document.querySelectorAll('.unit-button').forEach(button => button.addEventListener('click', () => setUnit(button.dataset.unit)));
document.querySelector('#reset-view').addEventListener('click', () => state.map?.flyTo({ ...CONFIG.initialView, essential: true }));
document.querySelector('#reload-button').addEventListener('click', () => window.location.reload());
window.addEventListener('keydown', event => { if (event.key === '/' && document.activeElement !== ui.search) { event.preventDefault(); ui.search.focus(); } });
window.addEventListener('beforeunload', () => { if (state.protocol) maplibregl.removeProtocol('pmtiles'); });
window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
initialise();
