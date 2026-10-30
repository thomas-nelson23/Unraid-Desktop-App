import { NAV } from './nav.js';

export default function Sidebar({ page, onPage, counts }) {
  return (
    <nav className="side" aria-label="Sections">
      <div className="side-brand">
        <span className="wordmark">
          Cube<b>crusher</b>
        </span>
      </div>
      {NAV.map((group, i) => (
        <div className={`group${i === NAV.length - 1 ? ' bottom' : ''}`} key={group.title ?? i}>
          {group.title && <span className="eyebrow">{group.title}</span>}
          {group.items.map((item) => {
            // A page's tabs (Overview's Array & disks) keep it lit.
            const cur = page === item.id || item.tabs?.includes(page);
            return (
              <button key={item.id} className={`nav${cur ? ' cur' : ''}`} aria-current={cur ? 'page' : undefined} onClick={() => onPage(item.id)}>
                {item.label}
                {counts[item.id] != null && <span className="n">{counts[item.id]}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
