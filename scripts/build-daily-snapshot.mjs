#!/usr/bin/env node
/**
 * Builds a cacheable daily temperature snapshot from a supplied city catalogue.
 * Input is NDJSON so the complete global catalogue can be processed without
 * loading it all before the provider request loop starts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const sourcePath = resolve(root, process.env.CITY_CATALOGUE || 'data/source/cities.ndjson');
const snapshotDate = process.env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);
const outputDir = resolve(root, `data/versions/${snapshotDate}`);
const providerUrl = process.env.WEATHER_API_URL || 'https://api.open-meteo.com/v1/forecast';
const batchSize = Number(process.env.WEATHER_BATCH_SIZE || 100);
const concurrency = Number(process.env.WEATHER_CONCURRENCY || 2);
const pauseMs = Number(process.env.WEATHER_PAUSE_MS || 500);

const sleep = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));
const cities = (await readFile(sourcePath, 'utf8')).trim().split('\n').filter(Boolean).map((line, index) => {
  const city = JSON.parse(line);
  if (!city.id || !city.name || !Number.isFinite(city.lat) || !Number.isFinite(city.lon)) throw new Error(`Invalid city at input line ${index + 1}`);
  return city;
});

async function fetchBatch(batch, attempt = 0) {
  const params = new URLSearchParams({
    latitude: batch.map(city => city.lat).join(','),
    longitude: batch.map(city => city.lon).join(','),
    current: 'temperature_2m',
    timezone: 'UTC',
  });
  try {
    const response = await fetch(`${providerUrl}?${params}`);
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
    const payload = await response.json();
    const readings = Array.isArray(payload) ? payload : [payload];
    if (readings.length !== batch.length) throw new Error(`Provider returned ${readings.length} readings for ${batch.length} cities`);
    return batch.map((city, index) => ({ ...city, temp_c: readings[index].current?.temperature_2m, provider_time: readings[index].current?.time }))
      .filter(city => Number.isFinite(city.temp_c));
  } catch (error) {
    if (attempt >= 4) throw error;
    await sleep(1000 * (2 ** attempt));
    return fetchBatch(batch, attempt + 1);
  }
}

const batches = Array.from({ length: Math.ceil(cities.length / batchSize) }, (_, index) => cities.slice(index * batchSize, (index + 1) * batchSize));
const readings = [];
let nextBatch = 0;
async function worker() {
  while (nextBatch < batches.length) {
    const index = nextBatch++;
    readings.push(...await fetchBatch(batches[index]));
    process.stderr.write(`Fetched batch ${index + 1}/${batches.length}\n`);
    if (pauseMs > 0) await sleep(pauseMs);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));

const observedAt = new Date().toISOString();
const featureCollection = {
  type: 'FeatureCollection',
  features: readings.map(city => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [city.lon, city.lat] },
    properties: { id: city.id, name: city.name, country: city.country, country_code: city.country_code, population: city.population || 0, lat: city.lat, lon: city.lon, temp_c: Math.round(city.temp_c * 10) / 10 },
  })),
};
const countries = new Set(readings.map(city => city.country_code));
const manifest = {
  snapshot_date: snapshotDate,
  display_date: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${snapshotDate}T00:00:00Z`)),
  observed_at: observedAt,
  provider_name: 'Open-Meteo daily snapshot',
  coverage: { city_count: readings.length, country_count: countries.size },
  tiles: { geojson_url: `data/versions/${snapshotDate}/cities.geojson` },
};

await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'cities.geojson'), `${JSON.stringify(featureCollection)}\n`);
await writeFile(resolve(outputDir, 'raw-readings.json'), `${JSON.stringify(readings)}\n`);
await writeFile(resolve(root, 'data/latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Published ${readings.length}/${cities.length} city readings for ${snapshotDate}.\n`);
