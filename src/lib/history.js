import { useEffect, useRef, useState } from 'react';
import { pct } from './format.js';

const DAY = 86400e3;

// Keeps the last 24 hours of the server's readings while the app is open, for
// the Overview's lanes. The dashboard doesn't keep a history of its own yet,
// so this starts empty each time the app opens.
export function useServerHistory(host) {
  const samples = useRef([]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!host) return;
    const now = Date.now();
    const gpu = host.gpus?.[0];
    const list = samples.current;
    list.push({
      at: now,
      cpu: host.cpu,
      ram: host.memory ? pct(host.memory.used, host.memory.total) : null,
      gpu: gpu?.util ?? null,
      vram: gpu?.memTotal ? pct(gpu.memUsed, gpu.memTotal) : null,
    });
    while (list.length && list[0].at < now - DAY) list.shift();
    setTick((t) => t + 1);
  }, [host]);
  return samples.current;
}
