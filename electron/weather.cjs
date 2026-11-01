const { net } = require('electron');
const settings = require('./settings.cjs');
const { toForecast, toPlaces } = require('./weatherShape.cjs');

// Weather straight from Open-Meteo for the place picked in Settings; no
// account, no key, nothing on Cubecrusher in between.
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

async function getJson(url) {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Open-Meteo answered HTTP ${res.status}.`);
  return res.json();
}

let cache = { key: '', at: 0, data: null };

async function forecast() {
  const place = settings.get().weather;
  if (!place?.latitude) return null;
  const units = place.units === 'celsius' ? 'celsius' : 'fahrenheit';
  const key = `${place.latitude},${place.longitude},${units}`;
  if (cache.key === key && Date.now() - cache.at < 10 * 60_000) return cache.data;
  const q = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '3',
    temperature_unit: units,
  });
  const data = { ...toForecast(await getJson(`${FORECAST}?${q}`)), location: { name: place.name, region: place.region, country: place.country }, units };
  cache = { key, at: Date.now(), data };
  return data;
}

async function search(q) {
  const text = String(q || '').trim();
  if (text.length < 2) return [];
  return toPlaces(await getJson(`${GEOCODE}?${new URLSearchParams({ name: text, count: '8', language: 'en', format: 'json' })}`));
}

async function setPlace(place) {
  const next = place && Number.isFinite(Number(place.latitude)) ? { name: String(place.name || '').slice(0, 80), region: String(place.region || '').slice(0, 80), country: String(place.country || '').slice(0, 80), latitude: Number(place.latitude), longitude: Number(place.longitude), units: place.units === 'celsius' ? 'celsius' : 'fahrenheit' } : null;
  await settings.update({ weather: next });
  cache = { key: '', at: 0, data: null };
  return next;
}

function register(ipcMain) {
  ipcMain.handle('weather:get', () => forecast());
  ipcMain.handle('weather:search', (_e, q) => search(q));
  ipcMain.handle('weather:setPlace', (_e, place) => setPlace(place));
}

module.exports = { register, forecast };
