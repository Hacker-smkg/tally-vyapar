// Small helpers shared by the server files: errors and input checks.

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const bad = (message: string): never => {
  throw new HttpError(400, message);
};

export interface User { id: number; name: string; username: string; role: 'owner' | 'staff'; location_id: number | null }

declare global {
  namespace Express {
    interface Request { user: User }
  }
}

export const str = (v: unknown, label: string, o: { max?: number; req?: boolean } = {}): string => {
  const s = v == null ? '' : String(v).trim();
  if (o.req && !s) bad(`${label} is required`);
  if (s.length > (o.max ?? 200)) bad(`${label} is too long`);
  return s;
};
export const num = (v: unknown, label: string, o: { min?: number; max?: number } = {}): number => {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  if (!Number.isFinite(n) || n < (o.min ?? -1e12) || n > (o.max ?? 1e12)) bad(`${label} is not a valid number`);
  return n;
};
export const int = (v: unknown, label: string, o: { min?: number; max?: number } = {}): number => {
  const n = num(v, label, o);
  if (!Number.isInteger(n)) bad(`${label} must be a whole number`);
  return n;
};
/** Money arrives from the browser as whole paise. */
export const paise = (v: unknown, label: string): number => int(v ?? 0, label, { min: 0 });
export const id = (v: unknown, label: string): number => int(v, label, { min: 1 });
export const optId = (v: unknown, label: string): number | null => (v == null || v === '' || v === 0 ? null : id(v, label));
export const oneOf = <T extends string>(v: unknown, list: readonly T[], label: string): T =>
  list.includes(v as T) ? (v as T) : bad(`${label} is not valid`);
export const date = (v: unknown, label = 'Date'): string => {
  const s = String(v ?? '');
  // The round trip rejects dates that do not exist (30 February), which Date.parse alone lets through.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) bad(`${label} is not valid`);
  return s;
};
/** Date of a bill, payment, expense or stock entry: a real date, not after today. */
export const entryDate = (v: unknown, label = 'Date'): string => {
  const s = date(v, label);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (s > todayStr) bad(`${label} cannot be in the future`);
  return s;
};
export const list = (v: unknown, label: string, o: { min?: number; max?: number } = {}): any[] => {
  if (!Array.isArray(v) || v.length < (o.min ?? 0) || v.length > (o.max ?? 500)) bad(`${label}: add at least ${o.min ?? 0} line(s)`);
  return v as any[];
};
