import crypto from 'node:crypto';

const key = secret => crypto.scryptSync(secret, 'varadise-control-plane', 32);
export const hashPassword = password => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
};
export const verifyPassword = (password, stored) => {
  if (typeof password !== 'string' || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, value] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(value, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
};
export const normalizeEmail = email => String(email || '').trim().toLowerCase();
export const isValidEmail = email => {
  const normalized = normalizeEmail(email);
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized);
};
export const passwordIssue = password => {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return 'Include an uppercase letter, a lowercase letter and a number.';
  return '';
};
export const encrypt = (value, secret) => {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), value: encrypted.toString('base64') };
};
export const decrypt = (payload, secret) => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(secret), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.value, 'base64')), decipher.final()]).toString());
};
export const sessionToken = () => crypto.randomBytes(32).toString('base64url');
