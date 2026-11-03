// The sidebar, in the order of the approved Home design. `built` pages have
// a real screen; the rest show what's coming.
export const NAV = [
  { items: [{ id: 'home', label: 'Home', built: true }, { id: 'hermes', label: 'Hermes', built: true }] },
  {
    title: 'Server',
    items: [
      { id: 'overview', label: 'Overview', built: true, tabs: ['array'] },
      { id: 'docker', label: 'Docker', built: true },
      { id: 'vms', label: 'VMs', built: true },
      { id: 'files', label: 'Shares & files' },
      { id: 'terminal', label: 'Terminal' },
      { id: 'logs', label: 'Logs' },
    ],
  },
  {
    title: 'Folders',
    items: [
      { id: 'folder-ai', label: 'AI' },
      { id: 'folder-media', label: 'Media' },
      { id: 'folder-network', label: 'Network' },
    ],
  },
  {
    title: 'Personal',
    items: [
      { id: 'calendar', label: 'Calendar' },
      { id: 'todo', label: 'To-Do' },
      { id: 'notes', label: 'Notes & wiki' },
    ],
  },
  { items: [{ id: 'settings', label: 'Settings', built: true }] },
];

export const PAGE_LABEL = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.id, i.label])));
