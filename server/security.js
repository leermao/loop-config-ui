import { randomBytes, timingSafeEqual } from 'node:crypto';

export function createCsrfToken() {
  return randomBytes(32).toString('hex');
}

export function allowedOrigins(config) {
  const port = config.port || 4177;
  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1:5176',
    'http://localhost:5176'
  ]);
}

function equalTokens(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function assertWriteRequest(req, token, origins) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !origins.has(origin)) {
    throw Object.assign(new Error('请求来源不合法'), { statusCode: 403 });
  }
  const supplied = req.headers['x-autofix-console-token'];
  const value = Array.isArray(supplied) ? supplied[0] : supplied;
  if (!equalTokens(token, value)) {
    throw Object.assign(new Error('控制台令牌无效'), { statusCode: 403 });
  }
}

export function applySecurityHeaders(res, { html = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    html
      ? "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
      : "default-src 'none'; frame-ancestors 'none'"
  );
}
