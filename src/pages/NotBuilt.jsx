import { PAGE_LABEL } from '../nav.js';

const PLANS = {
  overview: 'Array status, disks, parity, GPUs and temperatures at a glance.',
  docker: 'Start, stop and update containers, read logs, open consoles, and open each WebUI inside the app. Grouped into your own folders.',
  vms: 'Your VMs with start, stop and a console.',
  array: 'Every disk with SMART health, temperatures, and the parity schedule.',
  files: 'Browse shares, move files between them, and preview what you find.',
  terminal: 'A terminal on Cubecrusher, in a tab.',
  logs: "Unraid's system log and each container's log, searchable.",
  'folder-ai': 'Your AI services (Ollama, ComfyUI, Hermes, Odysseus) in one place.',
  'folder-media': 'Plex and the media apps in one place.',
  'folder-network': 'Network services in one place.',
  calendar: 'Your calendars, with server jobs on the same timeline.',
  todo: 'Your to-do lists from Home-Dashboard.',
  notes: 'Notes and the wiki from Home-Dashboard.',
};

export default function NotBuilt({ page }) {
  return (
    <div className="content">
      <section className="card notbuilt">
        <span className="eyebrow c">Coming next</span>
        <h1 className="h1">{PAGE_LABEL[page]}</h1>
        <p className="soft">{PLANS[page]}</p>
        <p className="dim small">This page hasn't been designed yet. Home and Hermes are the first two.</p>
      </section>
    </div>
  );
}
