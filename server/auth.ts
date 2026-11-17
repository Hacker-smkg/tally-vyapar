import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { all, business, get, getSetting, must, run, seedBasics, setSetting, tx, DEFAULT_BUSINESS, DEMO } from './db.ts';
import { HttpError, bad, id, oneOf, optId, str } from './util.ts';
import type { User } from './util.ts';

const MAX_USERS = 10;
const SESSION_DAYS = 30;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const want = Buffer.from(hash, 'hex');
  const got = scryptSync(pw, salt, 64);
  return want.length === got.length && timingSafeEqual(want, got);
}
const password = (v: unknown) => {
  const pw = String(v ?? '');
  if (pw.length < 8 || pw.length > 100) bad('Password must be at least 8 characters');
  return pw;
};

function startSession(res: Response, userId: number) {
  const token = randomBytes(32).toString('hex');
  // Only a hash of the token is stored, so a copied backup file cannot be used to log in.
  run('INSERT INTO sessions(token, user_id, expires_at) VALUES(?, ?, ?)', sha(token), userId, Date.now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}
const sidOf = (req: Request) => /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];

export function withUser(req: Request, _res: Response, next: NextFunction) {
  const sid = sidOf(req);
  if (sid) {
    const u = get(
      `SELECT u.id, u.name, u.username, u.role, u.location_id FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
      sha(sid), Date.now(),
    );
    if (u) req.user = u as User;
  }
  next();
}
export const requireUser = (req: Request, _res: Response, next: NextFunction) => next(req.user ? undefined : new HttpError(401, 'Please log in'));
export const requireOwner = (req: Request, _res: Response, next: NextFunction) =>
  next(req.user?.role === 'owner' ? undefined : new HttpError(403, 'Only the owner can do this'));

// Slow down password guessing: 8 wrong tries per username+address in 10 minutes.
const fails = new Map<string, { n: number; until: number }>();
function guard(key: string) {
  const f = fails.get(key);
  if (f && f.until > Date.now() && f.n >= 8) throw new HttpError(429, 'Too many wrong tries. Wait 10 minutes and try again.');
  if (f && f.until <= Date.now()) fails.delete(key);
}
function failed(key: string) {
  const f = fails.get(key) ?? { n: 0, until: 0 };
  fails.set(key, { n: f.n + 1, until: Date.now() + 10 * 60_000 });
}

const userCount = () => Number(get('SELECT COUNT(*) n FROM users')!.n);

export const authRoutes = Router();

authRoutes.get('/auth/me', (req, res) => {
  const b = business();
  res.json({
    user: req.user ?? null, needsSetup: userCount() === 0, brand: { name: b.name, logo: b.logo, brandColor: b.brandColor, tagline: b.tagline },
    // Only the demo copy shows its login on screen. The real app never does.
    demo: DEMO ? getSetting<any>('demo_login', null) : null,
  });
});

// First visit only: create the owner. There is no default password anywhere.
authRoutes.post('/auth/setup', (req, res) => {
  if (userCount() > 0) throw new HttpError(403, 'Setup is already done');
  const name = str(req.body.name, 'Your name', { req: true });
  const username = str(req.body.username, 'Username', { req: true, max: 40 });
  const pw = password(req.body.password);
  const shop = str(req.body.business, 'Business name', { req: true });
  const uid = tx(() => {
    setSetting('business', { ...DEFAULT_BUSINESS, name: shop });
    seedBasics();
    return run('INSERT INTO users(name, username, pass_hash, role) VALUES(?, ?, ?, ?)', name, username, hashPassword(pw), 'owner').id;
  });
  startSession(res, uid);
  res.json({ ok: true });
});

authRoutes.post('/auth/login', (req, res) => {
  const username = str(req.body.username, 'Username', { req: true, max: 40 });
  const key = `${username.toLowerCase()}|${req.ip}`;
  guard(key);
  const u = get('SELECT id, pass_hash FROM users WHERE username = ? AND active = 1', username);
  if (!u || !checkPassword(String(req.body.password ?? ''), u.pass_hash)) {
    failed(key);
    throw new HttpError(401, 'Wrong username or password');
  }
  fails.delete(key);
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  startSession(res, u.id);
  res.json({ ok: true });
});

authRoutes.post('/auth/logout', (req, res) => {
  const sid = sidOf(req);
  if (sid) run('DELETE FROM sessions WHERE token = ?', sha(sid));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ---------- users (owner only) ----------
authRoutes.get('/users', requireUser, requireOwner, (_req, res) => {
  res.json(all(`SELECT u.id, u.name, u.username, u.role, u.location_id, u.active, l.name AS location
                FROM users u LEFT JOIN locations l ON l.id = u.location_id ORDER BY u.active DESC, u.id`));
});

function userFields(b: any) {
  return {
    name: str(b.name, 'Name', { req: true }),
    role: oneOf(b.role, ['owner', 'staff'] as const, 'Role'),
    location_id: optId(b.location_id, 'Store'),
    active: b.active === false || b.active === 0 ? 0 : 1,
  };
}
const activeOwners = (exceptId = 0) => Number(get(`SELECT COUNT(*) n FROM users WHERE role = 'owner' AND active = 1 AND id <> ?`, exceptId)!.n);

authRoutes.post('/users', requireUser, requireOwner, (req, res) => {
  const f = userFields(req.body);
  const username = str(req.body.username, 'Username', { req: true, max: 40 });
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) bad('Username: 3 to 40 letters or digits, no spaces');
  const pw = password(req.body.password);
  if (Number(get('SELECT COUNT(*) n FROM users WHERE active = 1')!.n) >= MAX_USERS) bad(`This app is set up for ${MAX_USERS} users. Switch one off first.`);
  if (get('SELECT 1 FROM users WHERE username = ?', username)) bad('That username is taken');
  res.json(run('INSERT INTO users(name, username, pass_hash, role, location_id) VALUES(?, ?, ?, ?, ?)', f.name, username, hashPassword(pw), f.role, f.location_id));
});

authRoutes.put('/users/:id', requireUser, requireOwner, (req, res) => {
  const uid = id(req.params.id, 'User');
  must('users', uid, 'User');
  const f = userFields(req.body);
  if ((f.role !== 'owner' || !f.active) && activeOwners(uid) === 0) bad('At least one active owner is needed');
  if (f.active && Number(get('SELECT COUNT(*) n FROM users WHERE active = 1 AND id <> ?', uid)!.n) >= MAX_USERS) bad(`This app is set up for ${MAX_USERS} users.`);
  tx(() => {
    run('UPDATE users SET name = ?, role = ?, location_id = ?, active = ? WHERE id = ?', f.name, f.role, f.location_id, f.active, uid);
    if (req.body.password) run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(password(req.body.password)), uid);
    // A password reset or switch-off signs that user out everywhere.
    if (req.body.password || !f.active) run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', uid, sha(sidOf(req) ?? ''));
  });
  res.json({ ok: true });
});
