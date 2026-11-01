const test = require('node:test');
const assert = require('node:assert/strict');
const { toForecast, toPlaces } = require('./weatherShape.cjs');

test('toForecast turns Open-Meteo local times into instants', () => {
  const out = toForecast({
    utc_offset_seconds: -18000,
    timezone: 'America/Chicago',
    current: { temperature_2m: 74.2, apparent_temperature: 75, weather_code: 0, is_day: 1 },
    hourly: { time: ['2026-11-01T00:00', '2026-11-01T01:00'], temperature_2m: [70, 69], weather_code: [0, 1], precipitation_probability: [0, 5], is_day: [0, 0] },
    daily: { time: ['2026-11-01'], weather_code: [2], temperature_2m_max: [81], temperature_2m_min: [58], precipitation_probability_max: [10] },
  });
  assert.equal(out.current.temp, 74.2);
  assert.equal(out.current.code, 0);
  assert.equal(out.hours[0].at, Date.parse('2026-11-01T05:00:00Z'));
  assert.equal(out.hours[1].temp, 69);
  assert.deepEqual(out.days[0], { date: '2026-11-01', code: 2, high: 81, low: 58, rain: 10 });
  assert.equal(out.timezone, 'America/Chicago');
});

test('toPlaces keeps only usable results', () => {
  const places = toPlaces({ results: [{ id: 1, name: 'Austin', admin1: 'Texas', country: 'United States', latitude: 30.26, longitude: -97.74 }, { name: 'Nowhere' }] });
  assert.deepEqual(places, [{ id: '1', name: 'Austin', region: 'Texas', country: 'United States', latitude: 30.26, longitude: -97.74 }]);
  assert.deepEqual(toPlaces({}), []);
});
