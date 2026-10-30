// Copied from Home-Dashboard (web/src/markdown.jsx) so chat replies render the same way.
// Markdown for wiki pages, turned straight into React elements so nothing a
// page says can run as HTML. Covers what notes need: headings, paragraphs
// (line breaks kept), **bold**, *italic*, ~~strike~~, `code`, ``` blocks,
// links, pictures, lists (nested, numbered, - [ ] checkboxes), > quotes,
// tables, --- rules, and [[Page]] / [[Page#Heading|label]] links between pages.
//
// With `obsidian` on (the Vault page) it also reads what Obsidian adds:
// front matter as properties, > [!note] callouts, ![[embeds]], #tags,
// ==highlights== and %%comments%%.

// The id a heading gets, so [[Page#Heading]] and [text](#heading) can find it.
export function slug(text) {
  return (
    'h-' +
    text
      .toLowerCase()
      .replace(/[`*_~[\]()]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

// [[Title]], [[Title#Heading]], [[Title|label]] → its parts.
export function parseWikiLink(inner) {
  const [target, label] = inner.split('|');
  const [title, heading] = target.split('#');
  return { title: title.trim(), heading: heading?.trim() || '', label: label?.trim() || '' };
}

const SAFE_URL = /^(https?:|mailto:|tel:)/i;
// A bare name like "photo.png" is a file added to the page.
const PAGE_FILE = /^[^:/?#]+$/;

const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|(!?)\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)|\[([^\]\n]+)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<]*[^\s<.,:;"')\]!?])|\*\*(?=\S)([^\n]*?\S)\*\*|__(?=\S)([^\n]*?\S)__|~~(?=\S)([^\n]*?\S)~~|\*(?=[^\s*])([^*\n]*?[^\s*])\*|(?<![\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w])|==(?=\S)([^\n]*?\S)==|(?<![^\s(])#([\p{L}_/-][\p{L}\p{N}_/-]*|\d+[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

function inline(text, ctx, keyBase = 'i') {
  const out = [];
  let last = 0;
  let n = 0;
  const key = () => `${keyBase}-${n++}`;
  INLINE.lastIndex = 0;
  const re = new RegExp(INLINE.source, 'gu');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    last = re.lastIndex;
    const [whole, , code, bang, wiki, alt, src, label, href, bare, bold, bold2, strike, em, em2, mark, tag] = m;
    if (code !== undefined) out.push(<code key={key()}>{code.replace(/^ (.*) $/, '$1')}</code>);
    else if (wiki !== undefined && bang && ctx.embed) out.push(ctx.embed(parseWikiLink(wiki), key()));
    else if (wiki !== undefined) {
      if (bang) out.push('!');
      out.push(ctx.wikiLink(parseWikiLink(wiki), key()));
    } else if (mark !== undefined) out.push(<mark key={key()}>{inline(mark, ctx, key())}</mark>);
    else if (tag !== undefined) out.push(ctx.tag ? ctx.tag(tag, key()) : whole);
    else if (src !== undefined) out.push(image(alt, src, ctx, key()) ?? whole);
    else if (href !== undefined) out.push(link(href, inline(label, ctx, key()), ctx, key()) ?? whole);
    else if (bare !== undefined) out.push(link(bare, bare, ctx, key()));
    else if (bold !== undefined || bold2 !== undefined) out.push(<strong key={key()}>{inline(bold ?? bold2, ctx, key())}</strong>);
    else if (strike !== undefined) out.push(<del key={key()}>{inline(strike, ctx, key())}</del>);
    else out.push(<em key={key()}>{inline(em ?? em2, ctx, key())}</em>);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function link(href, children, ctx, key) {
  if (href.startsWith('#')) {
    const id = slug(decode(href.slice(1)));
    return (
      <a
        key={key}
        href={href}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      >
        {children}
      </a>
    );
  }
  if (SAFE_URL.test(href)) {
    return (
      <a key={key} href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  }
  if (PAGE_FILE.test(href) && ctx.fileUrl) {
    return (
      <a key={key} href={ctx.fileUrl(decode(href), false)} download>
        {children}
      </a>
    );
  }
  return null;
}

function image(alt, src, ctx, key) {
  let url = null;
  if (/^https?:/i.test(src)) url = src;
  else if (PAGE_FILE.test(src) && ctx.fileUrl) url = ctx.fileUrl(decode(src), true);
  if (!url) return null;
  return <img key={key} src={url} alt={alt} loading="lazy" />;
}

// Lines carry their number in the source so checkboxes can be ticked in place.
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^\s*(```+|~~~+)\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
// > [!note] Title, with + or - to make it fold open or shut.
const CALLOUT = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/;
// Obsidian's callout types and their aliases, by the colour they share.
const CALLOUT_KINDS = {
  note: 'note', info: 'note', todo: 'note',
  abstract: 'tip', summary: 'tip', tldr: 'tip', tip: 'tip', hint: 'tip', important: 'tip',
  success: 'good', check: 'good', done: 'good',
  question: 'warn', help: 'warn', faq: 'warn', warning: 'warn', caution: 'warn', attention: 'warn',
  failure: 'bad', fail: 'bad', missing: 'bad', danger: 'bad', error: 'bad', bug: 'bad',
  example: 'quote', quote: 'quote', cite: 'quote',
};
const blank = (l) => !l.text.trim();
const indentOf = (s) => s.match(/^\s*/)[0].replace(/\t/g, '    ').length;

function cells(row) {
  let t = row.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function startsBlock(lines, i) {
  const t = lines[i].text;
  return FENCE.test(t) || HEADING.test(t) || RULE.test(t) || QUOTE.test(t) || LIST_ITEM.test(t) || (t.includes('|') && lines[i + 1] && TABLE_SEP.test(lines[i + 1].text));
}

function blocks(lines, ctx, keyBase = 'b') {
  const out = [];
  let i = 0;
  let n = 0;
  const key = () => `${keyBase}-${n++}`;
  while (i < lines.length) {
    const { text } = lines[i];
    if (blank(lines[i])) {
      i += 1;
      continue;
    }
    let m = text.match(FENCE);
    if (m) {
      const fence = m[1];
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].text.trim().startsWith(fence)) body.push(lines[i++].text);
      i += 1;
      out.push(
        <pre key={key()} className="md-code">
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    m = text.match(HEADING);
    if (m) {
      const level = m[1].length;
      const H = `h${level}`;
      out.push(
        <H key={key()} id={slug(m[2])}>
          {inline(m[2], ctx, key())}
        </H>,
      );
      i += 1;
      continue;
    }
    if (RULE.test(text)) {
      out.push(<hr key={key()} />);
      i += 1;
      continue;
    }
    if (QUOTE.test(text)) {
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i].text)) inner.push({ ...lines[i], text: lines[i++].text.match(QUOTE)[1] });
      const call = ctx.obsidian && inner[0].text.match(CALLOUT);
      if (call) {
        const type = call[1].toLowerCase();
        const kind = CALLOUT_KINDS[type] || 'note';
        const title = call[3] || type.charAt(0).toUpperCase() + type.slice(1);
        const body = blocks(inner.slice(1), ctx, key());
        const head = <span className="callout-title">{inline(title, ctx, key())}</span>;
        out.push(
          call[2] ? (
            <details key={key()} className={`callout callout-${kind}`} open={call[2] === '+'}>
              <summary>{head}</summary>
              {body}
            </details>
          ) : (
            <div key={key()} className={`callout callout-${kind}`}>
              {head}
              {body}
            </div>
          ),
        );
        continue;
      }
      out.push(<blockquote key={key()}>{blocks(inner, ctx, key())}</blockquote>);
      continue;
    }
    if (text.includes('|') && lines[i + 1] && TABLE_SEP.test(lines[i + 1].text)) {
      const head = cells(text);
      const align = cells(lines[i + 1].text).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : undefined));
      const rows = [];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && lines[i].text.includes('|')) rows.push(cells(lines[i++].text));
      out.push(
        <div key={key()} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} style={{ textAlign: align[j] }}>
                    {inline(c, ctx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>
                  {head.map((_, j) => (
                    <td key={j} style={{ textAlign: align[j] }}>
                      {inline(r[j] ?? '', ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (LIST_ITEM.test(text)) {
      const [list, next] = listAt(lines, i, ctx, key());
      out.push(list);
      i = next;
      continue;
    }
    const para = [];
    while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !startsBlock(lines, i))) para.push(lines[i++].text.trim());
    out.push(
      <p key={key()}>
        {para.flatMap((l, j) => (j ? [<br key={`br${j}`} />, ...inline(l, ctx, `${key()}`)] : inline(l, ctx, key())))}
      </p>,
    );
  }
  return out;
}

// One list starting at line i: its items are the marker lines at its indent;
// anything indented further (or following on the next lines) belongs to the
// item above, and is read as blocks of its own (so lists nest).
function listAt(lines, i, ctx, keyBase) {
  const first = lines[i].text.match(LIST_ITEM);
  const base = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const items = [];
  while (i < lines.length) {
    const l = lines[i];
    const m = l.text.match(LIST_ITEM);
    if (m && indentOf(m[1]) < base + 2 && /\d/.test(m[2]) === ordered && indentOf(m[1]) >= base) {
      items.push({ line: l.n, text: m[3], start: Number.parseInt(m[2], 10), rest: [], pad: indentOf(m[1]) + m[2].length + 1 });
      i += 1;
      continue;
    }
    if (m && indentOf(m[1]) < base) break;
    if (blank(l)) {
      // A blank line ends the list unless more of it follows, indented.
      const next = lines[i + 1];
      if (!next || indentOf(next.text) < base + 2) {
        const nm = next?.text.match(LIST_ITEM);
        if (!(nm && indentOf(nm[1]) >= base && /\d/.test(nm[2]) === ordered)) break;
      }
      items[items.length - 1].rest.push(l);
      i += 1;
      continue;
    }
    if (m && indentOf(m[1]) >= base + 2) {
      items[items.length - 1].rest.push(l);
      i += 1;
      continue;
    }
    if (m) break;
    // A plain line: continues the item when indented, or lazily right after it.
    const item = items[items.length - 1];
    if (indentOf(l.text) >= base + 2 || item.rest.length === 0 || !blank(item.rest[item.rest.length - 1])) {
      if (startsBlock(lines, i) && indentOf(l.text) < base + 2) break;
      item.rest.push(l);
      i += 1;
      continue;
    }
    break;
  }

  const Tag = ordered ? 'ol' : 'ul';
  const task = (t) => t.match(/^\[([ xX])\]\s+(.*)$/);
  const anyTask = items.some((it) => task(it.text));
  const list = (
    <Tag key={keyBase} className={anyTask ? 'md-tasks' : undefined} start={ordered && items[0].start !== 1 ? items[0].start : undefined}>
      {items.map((it, k) => {
        const t = task(it.text);
        const sub = it.rest.map((l) => ({ ...l, text: l.text.slice(Math.min(indentOf(l.text), it.pad)) }));
        const done = t && t[1] !== ' ';
        return (
          <li key={k} className={t ? `md-task${done ? ' done' : ''}` : undefined}>
            {t && (
              <input
                type="checkbox"
                checked={done}
                disabled={!ctx.onToggle}
                onChange={() => ctx.onToggle?.(it.line)}
                aria-label={done ? 'Mark not done' : 'Mark done'}
              />
            )}
            <span>{inline(t ? t[2] : it.text, ctx, `${keyBase}-${k}`)}</span>
            {sub.some((l) => !blank(l)) && blocks(sub, ctx, `${keyBase}-${k}-b`)}
          </li>
        );
      })}
    </Tag>
  );
  return [list, i];
}

// `wikiLink({ title, heading, label }, key)` draws a link to another page;
// `fileUrl(name, inline)` points at a file added to the page; `onToggle(line)`
// ticks the checkbox on that line of the source.
// `obsidian` turns on Obsidian's additions; `embed({ title, heading, label }, key)`
// draws an ![[embed]] and `tag(name, key)` a #tag.
export default function Markdown({ text, wikiLink, fileUrl, onToggle, className, obsidian, embed, tag }) {
  // %%Comments%% go, keeping the line breaks so checkboxes still find their line.
  const source = obsidian ? text.replace(/%%[\s\S]*?%%/g, (c) => c.replace(/[^\n]/g, '')) : text;
  let lines = source.split('\n').map((t, n) => ({ text: t, n }));
  const ctx = { wikiLink, fileUrl, onToggle, obsidian, embed: obsidian ? embed : null, tag: obsidian ? tag : null };
  let props = null;
  if (obsidian && lines[0]?.text === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.text === '---');
    if (end > 0) {
      props = properties(lines.slice(1, end).map((l) => l.text));
      lines = lines.slice(end + 1);
    }
  }
  return (
    <div className={`md ${className || ''}`}>
      {props && props.length > 0 && (
        <dl className="md-props">
          {props.map(([k, v]) => (
            <div key={k} className="md-prop">
              <dt>{k}</dt>
              <dd>
                {(Array.isArray(v) ? v : [v]).map((x, i) => (
                  <span key={i} className="md-prop-value">
                    {k === 'tags' || k === 'tag' ? (ctx.tag ? ctx.tag(String(x).replace(/^#/, ''), `p${i}`) : `#${x}`) : inline(String(x), ctx, `p${k}${i}`)}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {blocks(lines, ctx)}
    </div>
  );
}

// Front matter's key: value lines and - list items, as [key, value] pairs.
export function properties(lines) {
  const out = [];
  const unquote = (v) => v.replace(/^(['"])(.*)\1$/, '$2');
  for (const line of lines) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && out.length) {
      const last = out[out.length - 1];
      last[1] = [...(Array.isArray(last[1]) ? last[1] : last[1] ? [last[1]] : []), unquote(item[1].trim())];
      continue;
    }
    const kv = line.match(/^([^\s:#][^:]*):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    out.push([kv[1].trim(), v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1).split(',').map((x) => unquote(x.trim())).filter(Boolean) : unquote(v)]);
  }
  return out;
}

// Flips "- [ ]" and "- [x]" on one line of the source.
export function toggleTask(text, line) {
  const lines = text.split('\n');
  lines[line] = lines[line]?.replace(/^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\]/, (_, lead, mark) => `${lead}[${mark === ' ' ? 'x' : ' '}]`);
  return lines.join('\n');
}

// The page's headings, for an outline.
export function headings(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    const m = !fenced && line.match(HEADING);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/[`*_~]|\[\[|\]\]/g, ''), id: slug(m[2]) });
  }
  return out;
}
