#!/usr/bin/env node
/**
 * Converts GeoNames cities15000.txt data into the compact NDJSON catalogue used
 * by the daily weather job. Download the archive from GeoNames separately and
 * pass the extracted text file as the first argument.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputPath = resolve(process.cwd(), process.argv[2] || 'cities15000.txt');
const outputPath = resolve(process.cwd(), process.env.CITY_CATALOGUE_OUTPUT || 'data/source/cities.ndjson');
const minimumPopulation = Number(process.env.MIN_POPULATION || 100000);
const maximumCities = Number(process.env.MAX_CITIES || 500);
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

const cities = (await readFile(inputPath, 'utf8')).split('\n').flatMap((line, index) => {
  if (!line) return [];
  const fields = line.split('\t');
  const [id, name, asciiName, , latitude, longitude, featureClass, featureCode, countryCode] = fields;
  const population = Number(fields[14]);
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (featureClass !== 'P' || !featureCode.startsWith('PPL') || !Number.isFinite(lat) || !Number.isFinite(lon) || population < minimumPopulation || !countryCode) return [];
  return [{
    id: `geonames-${id}`,
    name: name || asciiName,
    country: countryNames.of(countryCode) || countryCode,
    country_code: countryCode,
    lat,
    lon,
    population,
    _line: index + 1,
  }];
});

cities.sort((a, b) => b.population - a.population || a.name.localeCompare(b.name));
const selected = cities.slice(0, maximumCities).map(({ _line, ...city }) => city);
await writeFile(outputPath, `${selected.map(city => JSON.stringify(city)).join('\n')}\n`);
process.stdout.write(`Wrote ${selected.length} cities from ${cities.length.toLocaleString()} eligible GeoNames records to ${outputPath}.\n`);
