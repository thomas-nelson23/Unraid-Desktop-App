import { useEffect, useMemo, useState } from 'react';
import { usePoll } from '../lib/api.js';
import { demoEvents, demoWeather } from '../lib/demo.js';
import { desktop, usePollFn } from '../lib/api.js';
import { clock, dayLabel, deg, greeting, hourLabel, shortTime, weatherLabel } from '../lib/format.js';
import { summaryLine } from '../lib/needs.js';
import { load, save } from '../lib/store.js';

const TONE = { red: 'var(--red)', brass: 'var(--brass)', cyan: 'var(--cyan)', mag: 'var(--ch-mag)' };

// The time, ticking over each minute.
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = setTimeout(function tick() {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    }, 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(timer);
  }, []);
  return now;
}

function Hero({ now, name, needs, onAsk }) {
  const [text, setText] = useState('');
  const send = (e) => {
    e.preventDefault();
    if (text.trim()) onAsk(text.trim());
  };
  return (
    <section className="card hero" aria-label="Hermes and your day">
      <div className="hero-row">
        <div className="greet">
          <span className="eyebrow c">Hermes · {dayLabel(now)}</span>
          <h1>
            {greeting(now.getHours())}
            {name ? `, ${name}` : ''}.
          </h1>
          <p>{summaryLine(needs)}</p>
        </div>
        <div className="time">
          <span className="clk">{clock(now)}</span>
        </div>
      </div>
      <form className="ask" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about the server, a service, or your day…" aria-label="Ask Hermes" />
        <button type="button" className="btn md quiet" onClick={() => onAsk('')}>
          Full chat
        </button>
        <button className="btn md primary" disabled={!text.trim()}>
          Send
        </button>
      </form>
      {needs.length > 0 && (
        <div className="chips">
          {needs.map((item) => (
            <button key={item.id} className="chip" style={{ '--k': TONE[item.tone] }} onClick={() => onAsk(item.ask)}>
              <i />
              {item.ask}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Feed({ needs, sample, onPage }) {
  return (
    <div className="left">
      <div className="feedhead">
        <h2>Needs you</h2>
        <span className="eyebrow">{sample ? 'Sample · urgent first' : 'Urgent first'}</span>
      </div>
      {needs.length === 0 ? (
        <div className="item calm">
          <span className="k" style={{ '--k': 'var(--cyan)' }} />
          <div>
            <b>All clear</b>
            <p>Containers are healthy and the disks have room.</p>
          </div>
        </div>
      ) : (
        <div className="feed">
          {needs.map((item) => (
            <div className="item" key={item.id} style={{ '--k': TONE[item.tone] }}>
              <span className="k" />
              <div>
                <b>{item.title}</b>
                {item.body && <p>{item.body}</p>}
                {item.thumbs && (
                  <div className="thumbs" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                )}
                <div className="from">{item.from}</div>
              </div>
              <div className="acts">
                {item.actions.map((a) => (
                  <button
                    key={a.label}
                    className={`btn md${a.primary ? ' primary' : ''}${a.quiet ? ' quiet' : ''}`}
                    onClick={a.go ? () => onPage(a.go) : undefined}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Weather({ weather, now }) {
  if (!weather?.current) return null;
  const today = weather.days?.[0];
  const hours = (weather.hours ?? []).filter((h) => h.at >= now.getTime() - 3600e3).slice(0, 6);
  const details = [weather.location?.name, weatherLabel(weather.current.code), today && `H ${Math.round(today.high)} L ${Math.round(today.low)}`].filter(Boolean);
  return (
    <>
      <div className="wxrow">
        <span className="deg">{deg(weather.current.temp)}</span>
        <span className="dim">{details.join(' · ')}</span>
      </div>
      {hours.length > 0 && (
        <div className="wx6">
          {hours.map((h, i) => (
            <div key={h.at} className={i === 0 ? 'now' : undefined}>
              <b>{deg(i === 0 ? weather.current.temp : h.temp)}</b>
              {i === 0 ? 'NOW' : hourLabel(new Date(h.at))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Calendar events from the server, cut to what the timeline needs.
function toTimeline(data) {
  const colors = Object.fromEntries((data?.sources ?? []).map((s) => [s.id, s.color]));
  const names = Object.fromEntries((data?.sources ?? []).map((s) => [s.id, s.name]));
  return (data?.events ?? []).map((e) => ({
    calendar: e.calendar,
    title: e.title || 'Untitled',
    note: e.allDay ? `All day · ${names[e.calendar] ?? ''}`.replace(/ · $/, '') : (names[e.calendar] ?? e.location ?? ''),
    start: e.allDay ? new Date(`${e.start}T00:00`) : new Date(e.start),
    allDay: e.allDay,
    color: colors[e.calendar],
  }));
}

function Timeline({ events, now }) {
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const nowAt = sorted.findIndex((e) => !e.allDay && e.start > now);
  const split = nowAt < 0 ? sorted.length : nowAt;
  const today = startOfDay(now).getTime();
  const row = (e, past) => {
    const day = startOfDay(e.start).getTime();
    const prefix = day !== today ? `${e.start.toLocaleDateString([], { weekday: 'short' })} · ` : '';
    const k = e.tone ? `var(--ch-${e.tone})` : (e.color ?? 'var(--cyan)');
    return (
      <div key={`${e.title}${e.start.getTime()}`} className={`t${past ? ' past' : ''}`} style={{ '--k': k }}>
        <span className="h">{e.allDay ? 'DAY' : shortTime(e.start)}</span>
        <b>
          {e.title}
          {e.server && <span className="tag2">Server</span>}
        </b>
        <span className="dim">
          {prefix}
          {e.note}
        </span>
      </div>
    );
  };
  if (!sorted.length) return <p className="dim">Nothing on this calendar for today and tonight.</p>;
  return (
    <div className="tl">
      {sorted.slice(0, split).map((e) => row(e, !e.allDay))}
      <div className="nowline">
        <span>NOW</span>
      </div>
      {sorted.slice(split).map((e) => row(e, false))}
    </div>
  );
}

// Which calendar the card shows: all of them, or one. Remembered on this computer.
function CalendarPick({ sources, picked, onPick }) {
  if (!sources.length) return <span className="eyebrow">Calendar</span>;
  return (
    <label className="lcd pick small" title="Which calendar to show">
      <select value={picked} onChange={(e) => onPick(e.target.value)} aria-label="Calendar">
        <option value="">All calendars</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name || s.id}
          </option>
        ))}
      </select>
    </label>
  );
}

function Today({ live, dash, hasPlace, now, onPage }) {
  // Today from midnight through 6 AM tomorrow, so tonight's jobs show.
  const dayStart = startOfDay(now).getTime();
  const range = useMemo(() => {
    const from = new Date(dayStart).toISOString();
    const to = new Date(dayStart + 30 * 3600e3).toISOString();
    return `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }, [dayStart]);
  // The calendar lives in the dashboard; the weather comes straight from
  // Open-Meteo for the place picked in Settings, or from the dashboard's
  // place when none is picked here.
  const cal = usePoll(range, { enabled: dash, every: 5 * 60_000 });
  const own = usePollFn(() => desktop.weather.get(), { key: 'weather', enabled: Boolean(desktop) && hasPlace, every: 15 * 60_000 });
  const wx = usePoll('/api/weather', { enabled: dash && !(desktop && hasPlace), every: 15 * 60_000 });
  const [picked, setPicked] = useState(() => load('homeCalendar', ''));
  const pick = (id) => {
    setPicked(id);
    save('homeCalendar', id);
  };
  const sources = cal.data?.sources ?? [];
  // A calendar that's gone from the server means "all" again.
  const showing = sources.some((s) => s.id === picked) ? picked : '';
  const events = (dash ? toTimeline(cal.data) : live ? [] : demoEvents()).filter((e) => !showing || e.calendar === showing);
  const weather = live ? (desktop && hasPlace ? own.data : wx.data) : demoWeather();
  return (
    <aside className="right">
      <section className="card">
        <div className="card-head">
          <h3 className="h4">Today and tonight</h3>
          {dash ? <CalendarPick sources={sources} picked={showing} onPick={pick} /> : <span className="eyebrow">{live ? 'Weather' : 'Sample'}</span>}
        </div>
        <Weather weather={weather} now={now} />
        {live && !weather && (
          <p className="dim small">
            {desktop ? (
              <>
                No weather place yet.{' '}
                <button className="linkish" onClick={() => onPage('settings')}>
                  Pick one in Settings
                </button>
                .
              </>
            ) : (
              'No weather yet.'
            )}
          </p>
        )}
        {dash && cal.error && !cal.data ? <p className="err">Couldn't load the calendar: {cal.error.message}</p> : dash || !live ? <Timeline events={events} now={now} /> : null}
        {live && !dash && (
          <div className="card-foot">
            Your calendar comes through Home-Dashboard.{' '}
            <button className="linkish" onClick={() => onPage('settings')}>
              Connect it in Settings
            </button>{' '}
            to see it here.
          </div>
        )}
        {!live && <div className="card-foot">Sample events. Server jobs will come from Unraid's schedules.</div>}
      </section>
    </aside>
  );
}

export default function Home({ conn, needs, onAsk, onPage }) {
  const now = useNow();
  const live = conn.state === 'live';
  const dash = conn.dashboard?.state === 'live';
  const name = dash ? (conn.user?.name || conn.user?.username || '').split(' ')[0] : '';
  return (
    <div className="content">
      <Hero now={now} name={name} needs={needs} onAsk={onAsk} />
      <div className="below">
        <Feed needs={needs} sample={!live} onPage={onPage} />
        <Today live={live} dash={dash} hasPlace={conn.hasPlace} now={now} onPage={onPage} />
      </div>
    </div>
  );
}
