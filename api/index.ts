import app from '../server/index.ts';

export default function handler(req: any, res: any) {
  const url = req.url || '/';
  if (!url.startsWith('/api')) {
    req.url = `/api${url.startsWith('/') ? '' : '/'}${url}`;
  }
  return app(req, res);
}
