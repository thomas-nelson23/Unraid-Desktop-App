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
        <div className="group" key={group.title ?? i}>
          {group.title && <span className="eyebrow">{group.title}</span>}
          {group.items.map((item) => (
            <button
              key={item.id}
              className={`nav${page === item.id ? ' cur' : ''}`}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => onPage(item.id)}
            >
              {item.label}
              {counts[item.id] != null && <span className="n">{counts[item.id]}</span>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
