// Builds the "Needs you" feed from what the server reports. Each item carries
// the question its Hermes suggestion chip asks.
//
// tone: red (broken now), brass (will be a problem), cyan (worth a look)
const ORDER = { red: 0, brass: 1, cyan: 2, mag: 3 };

export function needsFromServer({ containers = [], host = null } = {}) {
  const items = [];

  for (const c of containers) {
    if (c.health === 'unhealthy') {
      items.push({
        id: `unhealthy:${c.name}`,
        tone: 'red',
        title: `${c.displayName || c.name} is unhealthy`,
        body: `Its health check is failing. ${c.status}.`,
        from: 'Docker',
        ask: `Why is ${c.displayName || c.name} unhealthy?`,
        actions: [{ label: 'Open Docker', go: 'docker', primary: true }],
      });
    }
  }

  const stopped = containers.filter((c) => c.state === 'exited' || c.state === 'dead');
  if (stopped.length) {
    const names = stopped.map((c) => c.displayName || c.name);
    items.push({
      id: 'stopped',
      tone: 'cyan',
      title: stopped.length === 1 ? `${names[0]} is stopped` : `${stopped.length} containers are stopped`,
      body: stopped.length === 1 ? `${stopped[0].status}.` : `${names.join(', ')}.`,
      from: 'Docker',
      ask: stopped.length === 1 ? `Should ${names[0]} be running?` : 'Which stopped containers should be running?',
      actions: [{ label: 'Open Docker', go: 'docker' }],
    });
  }

  for (const d of host?.disks ?? []) {
    const used = d.total ? d.used / d.total : 0;
    if (used < 0.8) continue;
    const full = Math.round(used * 100);
    items.push({
      id: `disk:${d.label}`,
      tone: used >= 0.9 ? 'red' : 'brass',
      title: `${d.label} is ${full}% full`,
      body: used >= 0.9 ? 'Writes will start failing soon.' : 'Worth clearing some space before it fills.',
      from: 'Array & disks',
      ask: `What's taking up space on ${d.label}?`,
      actions: [{ label: 'Array & disks', go: 'array' }],
    });
  }

  for (const g of host?.gpus ?? []) {
    if (g.temp != null && g.temp >= 80) {
      items.push({
        id: `gpu:${g.id}`,
        tone: 'brass',
        title: `${g.name} is running hot`,
        body: `${Math.round(g.temp)}°C at ${Math.round(g.util ?? 0)}% use.`,
        from: 'GPU',
        ask: `What's using ${g.name}?`,
        actions: [{ label: 'Overview', go: 'overview' }],
      });
    }
  }

  return items.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
}

export function summaryLine(items) {
  if (!items.length) return 'Nothing needs you right now. Cubecrusher is running smoothly.';
  const urgent = items.filter((i) => i.tone === 'red');
  const count = items.length === 1 ? '1 thing needs you.' : `${items.length} things need you.`;
  if (urgent.length) return `${count} The urgent one: ${urgent[0].title}.`;
  return `${count} Nothing is urgent.`;
}
