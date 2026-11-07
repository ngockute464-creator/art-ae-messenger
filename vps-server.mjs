import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.ARTAE_API_PORT || 3100);
const ORIGIN = process.env.ARTAE_PUBLIC_ORIGIN || 'https://artae.duckdns.org';
const PREFIX = '/.netlify/functions/';
const MAX_BODY = 4 * 1024 * 1024;

const allowed = [
  'auth',
  'sync',
  'pins',
  'files-explorer',
  'realtime-token',
  'voice',
  'voice-transcript'
];

const handlers = new Map();

for (const name of allowed) {
  const path = resolve('netlify/functions', name + '.mjs');
  const mod = await import(pathToFileURL(path).href);
  if (typeof mod.default !== 'function') {
    throw Error('Invalid handler: ' + name);
  }
  handlers.set(name, mod.default);
}

function error(res, status, message) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify({error: message}));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', ORIGIN);

    if (!url.pathname.startsWith(PREFIX)) {
      return error(res, 404, 'Not found');
    }

    const name = url.pathname.slice(PREFIX.length);
    const handler = handlers.get(name);

    if (!handler) return error(res, 404, 'Not found');

    const method = req.method || 'GET';
    const sizeHeader = req.headers['content-length'];

    if (sizeHeader !== undefined) {
      const size = Number(sizeHeader);
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BODY) {
        return error(res, 413, 'Request too large');
      }
    }

    const headers = new Headers();

    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      if (['host', 'connection', 'transfer-encoding', 'content-length'].includes(key)) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }

    let body;

    if (method !== 'GET' && method !== 'HEAD') {
      let total = 0;
      body = Readable.toWeb(req).pipeThrough(new TransformStream({
        transform(chunk, controller) {
          total += chunk.byteLength;
          if (total > MAX_BODY) throw Error('Request too large');
          controller.enqueue(chunk);
        }
      }));
    }

    const request = new Request(url, {
      method,
      headers,
      ...(body ? {body, duplex: 'half'} : {})
    });

    const response = await handler(request);

    if (!(response instanceof Response)) {
      throw Error('Invalid handler response');
    }

    const outputHeaders = {};

    for (const [key, value] of response.headers) {
      if (!['connection', 'transfer-encoding', 'content-length', 'set-cookie'].includes(key)) {
        outputHeaders[key] = value;
      }
    }

    const cookies = response.headers.getSetCookie();
    if (cookies.length) outputHeaders['Set-Cookie'] = cookies;

    res.writeHead(response.status, outputHeaders);

    if (!response.body || method === 'HEAD') {
      return res.end();
    }

    await new Promise((done, reject) => {
      Readable.fromWeb(response.body)
        .on('error', reject)
        .pipe(res)
        .on('finish', done)
        .on('error', reject);
    });

  } catch (e) {
    console.error('ART-AE API error:', e?.message || e);
    if (!res.headersSent) {
      error(res, e?.message === 'Request too large' ? 413 : 500, 'Request failed');
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ART-AE API listening on ${HOST}:${PORT}`);
});
