const { net } = require('electron');
const settings = require('./settings.cjs');

// Requests to the Home-Dashboard server on Cubecrusher. They go through the
// main process so the sign-in cookie lives in Electron's own cookie jar and
// no CORS rules get in the way.
async function request({ method = 'GET', path: apiPath, body }) {
  const { serverUrl } = settings.get();
  if (!serverUrl) return { status: 0, error: 'not-configured' };
  if (typeof apiPath !== 'string' || !apiPath.startsWith('/api/')) return { status: 400, error: 'Bad path' };
  try {
    const res = await net.fetch(serverUrl + apiPath, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text.slice(0, 200) };
    }
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

// A GET that answers with the JSON or throws with the server's message.
async function get(apiPath) {
  const res = await request({ path: apiPath });
  if (res.error === 'not-configured') throw new Error('The dashboard server is not set up.');
  if (res.status === 0) throw new Error(res.error || "Can't reach the dashboard server.");
  if (res.status >= 400) throw new Error(res.data?.error || `The dashboard answered HTTP ${res.status}.`);
  return res.data;
}

module.exports = { request, get };
