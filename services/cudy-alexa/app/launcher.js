'use strict';

const fs = require('node:fs');
const http = require('node:http');

const PUBLIC_PORT = Number(process.env.GUARD_PORT || 3000);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 3001);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 256 * 1024);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 32);
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60_000);
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 60);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12_000);
const HA_TOKEN_FILE = process.env.HA_TOKEN_FILE || '/run/secrets/ha_token';

function loadSecret(filePath) {
  const value = fs.readFileSync(filePath, 'utf8').trim();
  if (!value) throw new Error(`secret file is empty: ${filePath}`);
  return value;
}

// Keep the Home Assistant long-lived token out of the container environment
// supplied by Compose. It is loaded from a read-only file immediately before
// the original application is started.
process.env.HA_TOKEN = loadSecret(HA_TOKEN_FILE);
process.env.PORT = String(BACKEND_PORT);
const { startServer } = require('./server.js');
startServer(BACKEND_PORT);

let concurrent = 0;
const buckets = new Map();

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function rateAllowed(key) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT;
}

setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS * 2;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.startedAt < cutoff) buckets.delete(key);
  }
}, RATE_WINDOW_MS).unref();

function reject(res, status, message) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    connection: 'close',
  });
  res.end(JSON.stringify({ error: message }));
}

const guard = http.createServer((req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) {
    reject(res, 403, 'forbidden');
    return;
  }

  if (concurrent >= MAX_CONCURRENT) {
    reject(res, 503, 'busy');
    return;
  }

  const key = clientKey(req);
  if (!rateAllowed(key)) {
    res.setHeader('retry-after', String(Math.ceil(RATE_WINDOW_MS / 1000)));
    reject(res, 429, 'rate limit exceeded');
    return;
  }

  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    reject(res, 413, 'request too large');
    return;
  }

  concurrent += 1;
  let completed = false;
  let size = 0;
  const chunks = [];

  const finish = () => {
    if (!completed) {
      completed = true;
      concurrent = Math.max(0, concurrent - 1);
    }
  };

  req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('request timeout')));

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy(new Error('request too large'));
      return;
    }
    chunks.push(chunk);
  });

  req.on('error', (error) => {
    finish();
    if (!res.headersSent) reject(res, error.message === 'request too large' ? 413 : 408, error.message);
    else res.destroy();
  });

  req.on('end', () => {
    if (size > MAX_BODY_BYTES) {
      finish();
      if (!res.headersSent) reject(res, 413, 'request too large');
      return;
    }

    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}`, 'content-length': String(body.length) };
    const upstream = http.request({
      host: '127.0.0.1',
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      upstreamRes.on('end', finish);
    });

    upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
    upstream.on('error', (error) => {
      finish();
      if (!res.headersSent) reject(res, 502, 'backend unavailable');
      else res.destroy(error);
    });
    upstream.end(body);
  });
});

guard.requestTimeout = REQUEST_TIMEOUT_MS;
guard.headersTimeout = 5_000;
guard.keepAliveTimeout = 5_000;
guard.maxHeadersCount = 64;

guard.listen(PUBLIC_PORT, '127.0.0.1', () => {
  console.log(`Alexa security guard listening on 127.0.0.1:${PUBLIC_PORT}; backend 127.0.0.1:${BACKEND_PORT}`);
});
