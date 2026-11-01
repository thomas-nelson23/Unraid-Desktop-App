// Open-Meteo's answers, cut down to what the Home card draws. A port of the
// same functions in Home-Dashboard's server/weather.js.
function toForecast(body) {
  const c = body.current ?? {};
  const h = body.hourly ?? {};
  const d = body.daily ?? {};
  // Times come back in the place's own time zone without an offset; the
  // offset turns them into instants so the page can label them.
  const offset = (body.utc_offset_seconds ?? 0) * 1000;
  const at = (t) => Date.parse(`${t}Z`) - offset;
  const hours = (h.time ?? []).map((t, i) => ({ at: at(t), temp: h.temperature_2m?.[i], code: h.weather_code?.[i], rain: h.precipitation_probability?.[i], day: h.is_day?.[i] === 1 }));
  const days = (d.time ?? []).map((t, i) => ({ date: t, code: d.weather_code?.[i], high: d.temperature_2m_max?.[i], low: d.temperature_2m_min?.[i], rain: d.precipitation_probability_max?.[i] }));
  return { current: { temp: c.temperature_2m, feels: c.apparent_temperature, code: c.weather_code, day: c.is_day === 1 }, hours, days, timezone: body.timezone ?? null };
}

function toPlaces(body) {
  return (body?.results ?? [])
    .filter((r) => r && r.name && Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .map((r) => ({ id: String(r.id ?? `${r.latitude},${r.longitude}`), name: r.name, region: r.admin1 || '', country: r.country || '', latitude: r.latitude, longitude: r.longitude }));
}

module.exports = { toForecast, toPlaces };
