import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, unlink, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, DEFAULT_BUSINESS, DEMO, arg, backupTo, dailyBackup, get, run, seedBasics, setSetting, tx } from './db.ts';
import { authRoutes, hashPassword, requireOwner, requireUser, withUser } from './auth.ts';
import { masterRoutes } from './masters.ts';
import { voucherRoutes } from './vouchers.ts';
import { stockRoutes } from './stock.ts';
import { reportRoutes } from './reports.ts';
import { aiRoutes } from './ai.ts';
import { seedDemo } from './seed.ts';
import { today } from '../shared/calc.ts';
import { HttpError } from './util.ts';

const dev = process.argv.includes('--dev');
const port = Number(arg('port') || process.env.PORT) || (DEMO ? 4010 : 4000);
const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));

// Changes must arrive as JSON. Together with the SameSite cookie this blocks other websites
// from posting forms into the app on a logged-in user's behalf.
app.use('/api', (req, _res, next) => next(req.method === 'GET' || req.is('application/json') ? undefined : new HttpError(415, 'Send JSON')));

app.use('/api', withUser, authRoutes);

const api = express.Router();
api.use(requireUser);
api.use(masterRoutes, voucherRoutes, stockRoutes, reportRoutes, aiRoutes);

api.post('/demo', requireOwner, (req, res) => {
  if (get('SELECT 1 FROM vouchers LIMIT 1') || get('SELECT 1 FROM items LIMIT 1')) throw new HttpError(400, 'Demo data can only be loaded into an empty app');
  seedDemo(req.user);
  res.json({ ok: true });
});

// The owner downloads a consistent copy of the whole database.
api.get('/backup', requireOwner, (_req, res) => {
  const f = backupTo(join(DATA_DIR, 'backups', `download-${Date.now()}.db`));
  res.download(f, `vastra-books-backup-${today()}.db`, () => unlink(f, () => {}));
});

app.use('/api', api);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const known = err instanceof HttpError || (err?.status === 404 && !!err.message);
  const status = known ? err.status : err?.type === 'entity.too.large' ? 413 : err?.type === 'entity.parse.failed' ? 400 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: known ? err.message : status === 413 ? 'That is too large to save' : status === 400 ? 'Bad request' : 'Something went wrong on the server. Please try again.' });
});

if (dev) {
  // One process in development too: Vite serves the screens through this same server.
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  if (existsSync(join(dist, 'index.html'))) {
    // The built screens load only their own files: no outside scripts, no embedding in other sites.
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
      next();
    });
    app.use(express.static(dist, { setHeaders: (res, p) => res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(p) ? 'public, max-age=31536000, immutable' : 'no-cache') }));
    app.get(/.*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  } else if (!process.env.VERCEL) {
    console.error('The screens are not built yet. Run:  npm run build');
    process.exit(1);
  }
}

if (DEMO && !get('SELECT 1 FROM users LIMIT 1')) {
  // First start of the demo copy: a sample business, a demo owner and 40 days of activity.
  const login = { username: 'demo', password: `demo-${randomBytes(4).toString('hex')}` };
  tx(() => {
    setSetting('business', { ...DEFAULT_BUSINESS, name: 'Royal Fashion', tagline: 'Demo copy with sample data', address: '12 College Street, Kolkata', phone: '90000 00000', state: 'West Bengal', brandColor: '#0f766e' });
    seedBasics();
    run('INSERT INTO users(name, username, pass_hash, role) VALUES(?, ?, ?, ?)', 'Demo Owner', login.username, hashPassword(login.password), 'owner');
    setSetting('demo_login', login);
  });
  seedDemo({ id: 1, name: 'Demo Owner', username: login.username, role: 'owner', location_id: null });
  writeFileSync(join(DATA_DIR, 'LOGIN.txt'), `Demo copy of Vastra Books (sample data only)\nUsername: ${login.username}\nPassword: ${login.password}\n`);
}

if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  dailyBackup();
  setInterval(dailyBackup, 6 * 3600_000).unref();

  app.listen(port, '0.0.0.0', () => {
    const lan = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => `http://${n!.address}:${port}`);
    console.log(`\n  Vastra Books is running${DEMO ? ' (DEMO copy, sample data)' : ''}${dev ? ' (development)' : ''}\n`);
    console.log(`  On this computer:   http://localhost:${port}`);
    for (const url of lan) console.log(`  On the same Wi-Fi:  ${url}`);
    console.log(`\n  Data file: ${join(DATA_DIR, 'app.db')}\n  Daily backups: ${join(DATA_DIR, 'backups')}\n  Press Ctrl+C to stop.\n`);
  });
}

export default app;
