# Temperature Atlas

An interactive, zoomable world map with real daily city-temperature snapshots. The browser reads a static snapshot; weather-provider requests run only in the scheduled publishing job.

## Run locally

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173`. The checked-in snapshot contains real readings for 500 GeoNames cities in 100 countries.

## Daily ingestion

`data/source/cities.ndjson` is a small development catalogue. Replace it with the complete, licensed city catalogue using the same NDJSON structure:

```json
{"id":"stable-id","name":"City","country":"Country","country_code":"GB","lat":51.5072,"lon":-0.1276,"population":8982000}
```

To create a larger seed catalogue from the GeoNames `cities15000.zip` download, extract the included text file and run:

```sh
MAX_CITIES=500 MIN_POPULATION=100000 node scripts/import-geonames-cities.mjs /path/to/cities15000.txt
```

This keeps the 500 most populous eligible populated places. Raise `MAX_CITIES` progressively for broader coverage, subject to the weather provider's daily batch quota.

Run one daily job from the repository root:

```sh
node scripts/build-daily-snapshot.mjs
```

It batches coordinate requests, retries transient failures, writes raw readings to `data/versions/YYYY-MM-DD/raw-readings.json`, publishes map data at `data/versions/YYYY-MM-DD/cities.geojson`, and updates `data/latest.json` last. Use `SNAPSHOT_DATE`, `WEATHER_BATCH_SIZE`, `WEATHER_CONCURRENCY`, `WEATHER_PAUSE_MS`, and `WEATHER_API_URL` to configure the run.

## GitHub Pages

The repository includes [.github/workflows/publish-pages.yml](.github/workflows/publish-pages.yml). Enable **Settings → Pages → Source → GitHub Actions** after pushing to GitHub.

The workflow deploys on every push to `main`, can be run manually, and refreshes the weather data daily at 07:17 UTC before publishing. It deploys only the frontend and current map snapshot; source catalogues, scripts, and raw readings are not public Pages assets.

## Production tiles

For the global catalogue, generate PMTiles after the daily snapshot and publish it to object storage/CDN. Create a `cities` layer for individual points and an `aggregates` layer for low-zoom cells with `count` and `temp_c` properties. Set the manifest tile declaration to:

```json
"tiles": { "pmtiles_url": "https://cdn.example.com/temperature/2026-07-10.pmtiles" }
```

The UI detects this automatically and avoids downloading a worldwide GeoJSON file. The `aggregates` layer is used at low zoom and individual city points are used from zoom 3 upward.
