// The pure parts of Home-Dashboard's server/hermes.js: what Hermes's API
// answers, turned into what the chat shows.

const MAX_CONTENT = 32_000;
const DEFAULT_MODEL = 'hermes-agent';
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// One message typed into the chat.
function cleanMessage(input, { allowEmpty = false } = {}) {
  if (typeof input !== 'string' || (!input.trim() && !allowEmpty)) throw badRequest('Type a message first.');
  if (input.length > MAX_CONTENT) throw badRequest('That message is too long.');
  return input;
}

// Pictures sent with a message: up to four data: URLs of common image types,
// each at most 5 MB once decoded.
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_URL = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
function cleanImages(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw badRequest('images must be a list.');
  if (input.length > MAX_IMAGES) throw badRequest(`Up to ${MAX_IMAGES} pictures per message.`);
  for (const url of input) {
    if (typeof url !== 'string' || !IMAGE_URL.test(url)) throw badRequest('Pictures must be PNG, JPEG, GIF or WebP.');
    if ((url.length - url.indexOf(',') - 1) * 0.75 > MAX_IMAGE_BYTES) throw badRequest('A picture is over 5 MB.');
  }
  return input;
}

// What a message with pictures looks like to Hermes: text and image parts.
const withImages = (text, images) => (images?.length ? [...(text.trim() ? [{ type: 'text', text }] : []), ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] : text);

const RUN_ID = /^[\w.-]{1,120}$/;
const CHOICES = new Set(['once', 'session', 'always', 'deny']);

function checkId(id) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) throw badRequest('Invalid session id');
  return encodeURIComponent(id);
}

const PAGE = 100;

const seconds = (t) => (typeof t === 'number' ? Math.round(t * 1000) : t ? Date.parse(t) || null : null);

// What the session list shows of one Hermes session.
function toSession(s) {
  return {
    id: s.id,
    title: s.title || null,
    preview: typeof s.preview === 'string' ? s.preview.slice(0, 200) : null,
    source: s.source || null,
    messages: s.message_count ?? null,
    startedAt: seconds(s.started_at),
    lastActive: seconds(s.last_active ?? s.started_at),
    pinned: Boolean(s.pinned),
  };
}

// A chat's details for /usage and the model label: what it runs on and what it has cost.
function toSessionDetail(s) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    ...toSession(s),
    model: s.model || null,
    provider: s.billing_provider || s.provider || null,
    inputTokens: num(s.input_tokens),
    outputTokens: num(s.output_tokens),
    cacheReadTokens: num(s.cache_read_tokens),
    reasoningTokens: num(s.reasoning_tokens),
    toolCalls: num(s.tool_call_count),
    apiCalls: num(s.api_call_count),
    cost: num(s.actual_cost_usd) ?? num(s.estimated_cost_usd),
    costEstimated: s.actual_cost_usd == null && s.estimated_cost_usd != null,
  };
}

// Hermes's model picker inventory, cut down to what /model lists: each
// configured provider and its models (newest picks first), plus what's in use now.
// A provider with no model list cached still shows, so a model can be typed for it.
function toModelOptions(payload) {
  const ids = (list) => (list || []).map((m) => (typeof m === 'string' ? m : m?.id || m?.name)).filter((m) => typeof m === 'string' && m);
  const providers = (payload?.providers || [])
    .map((p) => {
      const models = ids(p.models);
      const featured = ids(p.featured_models).filter((m) => models.includes(m));
      return {
        slug: String(p.slug || p.id || ''),
        name: String(p.name || p.label || p.slug || ''),
        current: Boolean(p.is_current),
        models: [...featured, ...models.filter((m) => !featured.includes(m))],
      };
    })
    .filter((p) => p.slug);
  return { model: payload?.model || null, provider: payload?.provider || null, providers };
}

// The pictures in a message's content parts, as their URLs.
function imagesOf(content) {
  if (!Array.isArray(content)) return [];
  return content
    .map((p) => (p && typeof p === 'object' && (p.type === 'image_url' || p.type === 'input_image') ? (typeof p.image_url === 'string' ? p.image_url : p.image_url?.url) : null))
    .filter((u) => typeof u === 'string' && /^(data:image\/|https?:\/\/)/.test(u));
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  return '';
}

const MAX_THINKING = 20_000;
const MAX_DETAIL = 400;

function clip(text, max) {
  const t = String(text ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// A tool call's input in a line: the one argument that says what it did
// (a command, a query, a path), or the arguments as compact JSON.
function toolArgs(args) {
  let a = args;
  if (typeof a === 'string') {
    try {
      a = JSON.parse(a);
    } catch {
      return clip(a, MAX_DETAIL);
    }
  }
  if (a == null || typeof a !== 'object') return a == null ? '' : clip(a, MAX_DETAIL);
  const values = Object.values(a);
  if (values.length === 1 && typeof values[0] !== 'object') return clip(values[0], MAX_DETAIL);
  for (const key of ['command', 'cmd', 'query', 'url', 'path', 'file_path', 'code', 'prompt', 'goal']) {
    if (typeof a[key] === 'string' && a[key].trim()) return clip(a[key], MAX_DETAIL);
  }
  return clip(JSON.stringify(a), MAX_DETAIL);
}

// A session's transcript as the chat shows it: what you typed and Hermes's
// replies, each reply carrying the steps that led to it: its thinking, the
// tools it ran (with what went in and what came back), and remarks made
// along the way.
function toTranscript(rows) {
  const out = [];
  let steps = [];
  const calls = new Map();
  for (const m of rows || []) {
    if (m.display_kind === 'hidden') continue;
    if (m.role === 'tool') {
      const step = calls.get(m.tool_call_id);
      const result = clip(textOf(m.content), MAX_DETAIL);
      if (step) step.result = result;
      else if (m.tool_name) steps.push({ kind: 'tool', name: m.tool_name, args: '', result });
      continue;
    }
    if (m.role === 'user') steps = [];
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = textOf(m.content);
    if (m.role === 'assistant') {
      const thinking = textOf(m.reasoning) || textOf(m.reasoning_content);
      if (thinking.trim()) steps.push({ kind: 'thinking', text: clip(thinking, MAX_THINKING) });
      const toolCalls = m.tool_calls || [];
      if (toolCalls.length) {
        if (content.trim()) steps.push({ kind: 'note', text: content.trim() });
        for (const c of toolCalls) {
          const name = c?.function?.name || c?.name;
          if (!name) continue;
          const step = { kind: 'tool', name, args: toolArgs(c?.function?.arguments ?? c?.arguments) };
          if (c.id) calls.set(c.id, step);
          steps.push(step);
        }
        continue;
      }
    }
    if (!content.trim() && !imagesOf(m.content).length) continue;
    const msg = { id: m.id ?? null, role: m.role, content, at: seconds(m.timestamp) };
    const images = imagesOf(m.content);
    if (images.length) msg.images = images;
    if (m.role === 'assistant' && steps.length) {
      msg.steps = steps;
      steps = [];
    }
    out.push(msg);
  }
  return out;
}

// "10.1.1.3:8642" -> "http://10.1.1.3:8642/v1"; trailing slashes and a pasted
// /chat/completions are dropped.
function cleanUrl(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  let p = u.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (!p) p = '/v1';
  return `${u.protocol}//${u.host}${p}`;
}

// What an address answered when asked for /v1/models. Hermes's web
// dashboard (port 9119) answers any path with its web page, and its
// sessions API wants a browser login, so either reply means the address is
// the dashboard rather than the API server on 8642.
function modelFrom(text) {
  try {
    return JSON.parse(text).data?.[0]?.id || null;
  } catch {
    return null;
  }
}
function isPage(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^<!doctype html|^<html|^<head|^<body|^<!--/i.test(t)) return true;
  try {
    JSON.parse(t);
    return false;
  } catch {
    return t.startsWith('<');
  }
}
function isLoginWall(text) {
  try {
    const json = JSON.parse(text);
    return Boolean(json.login_url) || /session/i.test(String(json.reason || json.error || ''));
  } catch {
    return /<form[^>]*login|href="\/login"/i.test(String(text || ''));
  }
}
const DASHBOARD_HINT = "That address is Hermes's web dashboard (its port is usually 9119), which only answers to a browser login. The app needs Hermes's API server instead, usually port 8642, with the container's API_SERVER_KEY.";

// Splits server-sent events out of a buffer: [{ event, data }], plus whatever
// partial event is left over. Comment lines (": keepalive") are skipped.
function parseEvents(buffer) {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = blocks.pop();
  const events = [];
  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    try {
      events.push({ event, data: JSON.parse(data.join('\n')) });
    } catch {}
  }
  return { events, rest };
}

// Turns one Hermes session-stream event into what the browser needs, or null.
function toChatEvent({ event, data }) {
  switch (event) {
    case 'assistant.delta':
      return data.delta ? { text: data.delta } : null;
    case 'tool.progress':
      // Hermes passes the model's reasoning along as progress of a "_thinking" tool.
      return data.tool_name === '_thinking' && data.delta ? { thinking: data.delta } : null;
    case 'tool.started':
      return data.tool_name && !data.tool_name.startsWith('_') ? { tool: data.tool_name, args: toolArgs(data.args ?? data.preview) } : null;
    case 'tool.completed':
    case 'tool.failed':
      return data.tool_name && !data.tool_name.startsWith('_') ? { toolDone: data.tool_name, result: clip(data.preview, MAX_DETAIL), failed: event === 'tool.failed' } : null;
    case 'assistant.commentary':
      return typeof data.text === 'string' && data.text.trim() ? { note: data.text.trim() } : null;
    case 'assistant.completed':
      return { final: typeof data.content === 'string' ? data.content : '' };
    case 'approval.request': {
      // Hermes parks the turn until POST /v1/runs/{run_id}/approval answers.
      const choices = (Array.isArray(data.choices) ? data.choices : []).filter((c) => CHOICES.has(c));
      return {
        approval: {
          runId: typeof data.run_id === 'string' ? data.run_id : null,
          requestId: data.request_id ?? data.prompt_id ?? null,
          generation: Number.isInteger(data.execution_generation) ? data.execution_generation : null,
          command: typeof data.command === 'string' ? data.command : typeof data.tool_name === 'string' ? data.tool_name : '',
          description: typeof data.description === 'string' ? data.description : typeof data.preview === 'string' ? data.preview : '',
          choices: choices.length ? choices : ['once', 'deny'],
        },
      };
    }
    case 'run.failed':
      return { error: data.error || data.message || 'Hermes stopped before finishing.' };
    case 'error':
      return { error: data.message || 'Hermes ran into an error.' };
    default:
      return null;
  }
}

// The Chat page. The browser talks only to this server, which forwards to
// Hermes Agent's API server (sessions under /api/sessions, OpenAI-style
// /v1/models for the status check), so the API key never leaves the server.
//
// Where Hermes is, in order: what was saved from the chat's settings
// (/config/hermes.json), then HERMES_URL / HERMES_API_KEY / HERMES_MODEL,
// then a running container named "hermes" found through Docker.

module.exports = { cleanMessage, cleanImages, withImages, toSession, toSessionDetail, toModelOptions, toolArgs, toTranscript, cleanUrl, parseEvents, toChatEvent, modelFrom, isPage, isLoginWall, DASHBOARD_HINT };
