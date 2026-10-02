import http from 'node:http';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, 'public');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, 'data');
const adminPath = path.join(dataDir, 'admin.json');
const dashboardPath = path.join(dataDir, 'dashboard.json');
const setupKeyPath = path.join(dataDir, 'setup-key.txt');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const sessionMaxAge = 8 * 60 * 60 * 1000;
const sessionCookie = 'fieldnote_session';
const sessions = new Map();
const authAttempts = new Map();
const authWindow = 15 * 60 * 1000;
const maxAuthAttempts = 8;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const defaultDashboard = {
  profile: {
    displayName: 'Developer',
    headline: ['Learning in public.', 'Building for what’s next.'].join(String.fromCharCode(10)),
    bio: 'A personal record of the skills I’m growing, the work I’m shipping, and the milestones along the way.',
  },
  sampleData: true,
  skills: [
    { id: 'python', name: 'Python', level: 68 },
    { id: 'java', name: 'Java', level: 48 },
    { id: 'html-css', name: 'HTML / CSS', level: 86 },
  ],
  learningPath: [
    {
      id: 'web-basics',
      title: 'HTML & CSS foundations',
      description: 'Build accessible, responsive layouts with semantic markup and thoughtful styling.',
      status: 'completed',
      progress: 100,
    },
    {
      id: 'python-core',
      title: 'Python foundations',
      description: 'Practice core syntax, data structures, and problem solving through small builds.',
      status: 'in-progress',
      progress: 64,
    },
    {
      id: 'java-oop',
      title: 'Java and object-oriented design',
      description: 'Get comfortable structuring applications with classes, interfaces, and tests.',
      status: 'planned',
      progress: 0,
    },
    {
      id: 'ship-project',
      title: 'Build and ship a portfolio project',
      description: 'Bring the learning together in a complete, documented project.',
      status: 'planned',
      progress: 0,
    },
  ],
  projects: [],
  updatedAt: null,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function atomicWrite(filePath, contents, mode = 0o600) {
  const tempPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tempPath, contents, { encoding: 'utf8', mode });
  await rename(tempPath, filePath);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

let adminConfig = null;
let setupSecret = null;
let generatedSetupSecret = false;

async function initializeStorage() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  try {
    adminConfig = await readJson(adminPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  try {
    await readFile(dashboardPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const seeded = clone(defaultDashboard);
    seeded.updatedAt = new Date().toISOString();
    await atomicWrite(dashboardPath, JSON.stringify(seeded, null, 2));
  }

  if (!adminConfig) {
    if (process.env.SETUP_KEY) {
      setupSecret = process.env.SETUP_KEY;
    } else {
      try {
        setupSecret = (await readFile(setupKeyPath, 'utf8')).trim();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        setupSecret = randomBytes(24).toString('base64url');
        await atomicWrite(setupKeyPath, `${setupSecret}\n`);
        generatedSetupSecret = true;
      }
    }
  }
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
  );
}

function sendJson(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function requestIsSecure(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return req.socket.encrypted === true || forwardedProto === 'https';
}

function setSessionCookie(req, res, token) {
  const secure = requestIsSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionMaxAge / 1000)}${secure}`);
}

function clearSessionCookie(req, res) {
  const secure = requestIsSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function pruneSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

function createSession(req, res) {
  pruneSessions();
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { expiresAt: Date.now() + sessionMaxAge });
  setSessionCookie(req, res, token);
}

function isAuthenticated(req) {
  pruneSessions();
  const token = getCookie(req, sessionCookie);
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  return true;
}

function ensureAuthenticated(req) {
  if (!isAuthenticated(req)) throw new HttpError(401, 'Your admin session has expired. Sign in again to continue.');
}

function ensureSameOrigin(req) {
  // Mutating requests also require a non-simple custom header; the origin check is
  // a second guard for browsers, including when the app is behind a reverse proxy.
  if (req.headers['x-requested-with'] !== 'fetch') {
    throw new HttpError(403, 'This request could not be verified. Reload the page and try again.');
  }
  const origin = req.headers.origin;
  if (!origin) return;
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw new HttpError(403, 'This request could not be verified.');
  }
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
  const requestHost = String(req.headers.host || '').toLowerCase();
  const knownHosts = new Set([forwardedHost, requestHost].filter(Boolean));
  if (knownHosts.has(originHost)) return;
  // TLS/reverse-proxy deployments can terminate the public request before Node
  // sees it. The required custom header plus the absence of CORS permission
  // remains the browser-side CSRF barrier in that case.
  if (req.headers['x-forwarded-proto'] || req.headers['forwarded']) return;
  throw new HttpError(403, 'Cross-origin requests are not allowed.');
}

function clientKey(req) {
  return req.socket.remoteAddress || 'unknown';
}

function checkAuthLimit(req) {
  const key = clientKey(req);
  const now = Date.now();
  let record = authAttempts.get(key);
  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + authWindow };
  }
  if (record.count >= maxAuthAttempts) {
    authAttempts.set(key, record);
    throw new HttpError(429, 'Too many sign-in attempts. Please wait a while and try again.');
  }
  return { key, record };
}

function recordFailedAuth(key, record) {
  record.count += 1;
  authAttempts.set(key, record);
}

async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'The submitted data is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const value = JSON.parse(text || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, 'The request body must be a JSON object.');
    }
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Please submit valid JSON.');
  }
}

function requireString(value, label, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be text.`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) throw new HttpError(400, `${label} is required.`);
  if (trimmed.length > maxLength) throw new HttpError(400, `${label} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

function requireId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new HttpError(400, 'One of the entries has an invalid identifier.');
  }
  return value;
}

function requirePercent(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw new HttpError(400, `${label} must be a whole number from 0 to 100.`);
  }
  return number;
}

function validateGithubUrl(value) {
  const trimmed = requireString(value, 'GitHub repository URL', 300);
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new HttpError(400, 'Enter a valid GitHub repository URL.');
  }
  const repoParts = url.pathname.split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || repoParts.length < 2) {
    throw new HttpError(400, 'Use a direct https://github.com/owner/repository link.');
  }
  return url.toString();
}

function validateDashboard(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Dashboard data must be an object.');
  if (!input.profile || typeof input.profile !== 'object') throw new HttpError(400, 'Profile details are missing.');
  if (!Array.isArray(input.skills) || input.skills.length > 20) throw new HttpError(400, 'Add up to 20 language or skill entries.');
  if (!Array.isArray(input.learningPath) || input.learningPath.length > 30) throw new HttpError(400, 'Add up to 30 learning milestones.');
  if (!Array.isArray(input.projects) || input.projects.length > 30) throw new HttpError(400, 'Add up to 30 GitHub projects.');
  if (typeof input.sampleData !== 'boolean') throw new HttpError(400, 'Choose whether the sample-data notice should be shown.');

  const ids = new Set();
  const uniqueId = (value) => {
    const id = requireId(value);
    if (ids.has(id)) throw new HttpError(400, 'Each dashboard entry must have a unique identifier.');
    ids.add(id);
    return id;
  };

  const profile = {
    displayName: requireString(input.profile.displayName, 'Display name', 60),
    headline: requireString(input.profile.headline, 'Headline', 120),
    bio: requireString(input.profile.bio, 'About text', 320, { allowEmpty: true }),
  };

  const skills = input.skills.map((item) => {
    if (!item || typeof item !== 'object') throw new HttpError(400, 'A language entry is invalid.');
    return {
      id: uniqueId(item.id),
      name: requireString(item.name, 'Language or skill name', 40),
      level: requirePercent(item.level, 'Language proficiency'),
    };
  });

  const validStatuses = new Set(['completed', 'in-progress', 'planned']);
  const learningPath = input.learningPath.map((item) => {
    if (!item || typeof item !== 'object') throw new HttpError(400, 'A learning milestone is invalid.');
    const status = requireString(item.status, 'Milestone status', 20);
    if (!validStatuses.has(status)) throw new HttpError(400, 'Choose a valid milestone status.');
    return {
      id: uniqueId(item.id),
      title: requireString(item.title, 'Milestone title', 90),
      description: requireString(item.description, 'Milestone description', 240, { allowEmpty: true }),
      status,
      progress: requirePercent(item.progress, 'Milestone progress'),
    };
  });

  const projects = input.projects.map((item) => {
    if (!item || typeof item !== 'object') throw new HttpError(400, 'A project entry is invalid.');
    const tag = typeof item.tag === 'string' ? item.tag.trim() : '';
    if (tag.length > 32) throw new HttpError(400, 'Project tags must be 32 characters or fewer.');
    return {
      id: uniqueId(item.id),
      title: requireString(item.title, 'Project title', 80),
      description: requireString(item.description, 'Project description', 260, { allowEmpty: true }),
      repoUrl: validateGithubUrl(item.repoUrl),
      tag,
    };
  });

  return {
    profile,
    sampleData: input.sampleData,
    skills,
    learningPath,
    projects,
    updatedAt: new Date().toISOString(),
  };
}

async function getDashboard() {
  try {
    const data = await readJson(dashboardPath);
    // Return only the public dashboard shape; admin credentials are stored elsewhere.
    return data;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const data = clone(defaultDashboard);
    data.updatedAt = new Date().toISOString();
    await atomicWrite(dashboardPath, JSON.stringify(data, null, 2));
    return data;
  }
}

async function saveDashboard(data) {
  await atomicWrite(dashboardPath, JSON.stringify(data, null, 2));
}

function safeSecretMatch(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const candidateHash = createHash('sha256').update(candidate, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJson(res, 200, { setupRequired: !adminConfig });
  }
  if (req.method === 'GET' && pathname === '/api/dashboard') {
    return sendJson(res, 200, await getDashboard());
  }

  if (pathname === '/api/setup' && req.method === 'POST') {
    ensureSameOrigin(req);
    if (adminConfig) throw new HttpError(409, 'The private workspace is already set up. Sign in instead.');
    const attempt = checkAuthLimit(req);
    const body = await readBody(req);
    if (!setupSecret || !safeSecretMatch(body.setupKey, setupSecret)) {
      recordFailedAuth(attempt.key, attempt.record);
      throw new HttpError(401, 'The one-time setup key is not correct.');
    }
    if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 200) {
      throw new HttpError(400, 'Choose a password with at least 12 characters.');
    }
    if (body.password !== body.confirmPassword) throw new HttpError(400, 'The passwords do not match.');

    const salt = randomBytes(16);
    const passwordHash = await scrypt(body.password, salt, 64, { N: 16384, r: 8, p: 1 });
    const nextAdmin = {
      salt: salt.toString('hex'),
      passwordHash: Buffer.from(passwordHash).toString('hex'),
      createdAt: new Date().toISOString(),
    };
    await atomicWrite(adminPath, JSON.stringify(nextAdmin, null, 2));
    adminConfig = nextAdmin;
    const configuredSecret = setupSecret;
    setupSecret = null;
    if (!process.env.SETUP_KEY && configuredSecret) {
      try { await unlink(setupKeyPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    authAttempts.delete(attempt.key);
    createSession(req, res);
    return sendJson(res, 201, { ok: true, data: await getDashboard() });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    ensureSameOrigin(req);
    if (!adminConfig) throw new HttpError(409, 'Set up the private workspace first.');
    const attempt = checkAuthLimit(req);
    const body = await readBody(req);
    if (typeof body.password !== 'string') {
      recordFailedAuth(attempt.key, attempt.record);
      throw new HttpError(401, 'That password did not match.');
    }
    let salt;
    let storedHash;
    try {
      salt = Buffer.from(adminConfig.salt, 'hex');
      storedHash = Buffer.from(adminConfig.passwordHash, 'hex');
    } catch {
      throw new HttpError(500, 'The admin credential file could not be read.');
    }
    const suppliedHash = Buffer.from(await scrypt(body.password, salt, storedHash.length, { N: 16384, r: 8, p: 1 }));
    if (storedHash.length !== suppliedHash.length || !timingSafeEqual(storedHash, suppliedHash)) {
      recordFailedAuth(attempt.key, attempt.record);
      throw new HttpError(401, 'That password did not match.');
    }
    authAttempts.delete(attempt.key);
    createSession(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    ensureSameOrigin(req);
    const token = getCookie(req, sessionCookie);
    if (token) sessions.delete(token);
    clearSessionCookie(req, res);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/data' && req.method === 'GET') {
    ensureAuthenticated(req);
    return sendJson(res, 200, { data: await getDashboard() });
  }

  if (pathname === '/api/admin/data' && req.method === 'PUT') {
    ensureSameOrigin(req);
    ensureAuthenticated(req);
    const input = await readBody(req);
    const validated = validateDashboard(input);
    await saveDashboard(validated);
    return sendJson(res, 200, { ok: true, data: validated });
  }

  throw new HttpError(404, 'API route not found.');
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

async function handleStatic(req, res, url) {
  const file = staticFiles.get(url.pathname);
  if (!file) throw new HttpError(404, 'Page not found.');
  const [filename, contentType] = file;
  const body = await readFile(path.join(publicDir, filename));
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': filename === 'index.html' ? 'no-cache' : 'public, max-age=300',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function handleRequest(req, res) {
  setSecurityHeaders(res);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      await handleStatic(req, res, url);
      return;
    }
    throw new HttpError(405, 'Method not allowed.');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error('[server error]', error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, status, { error: status >= 500 ? 'Something went wrong on the server.' : error.message });
  }
}

await initializeStorage();
if (generatedSetupSecret && setupSecret) {
  console.log('\nFirst-run setup key (use it once in the Admin panel):');
  console.log(`  ${setupSecret}\n`);
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});
server.listen(port, '0.0.0.0', () => {
  console.log(`Fieldnote dashboard listening on http://0.0.0.0:${port}`);
  console.log(`Persistent data directory: ${dataDir}`);
  if (process.env.SETUP_KEY && !adminConfig) {
    console.log('A SETUP_KEY environment variable is active for first-run owner setup.');
  }
});
