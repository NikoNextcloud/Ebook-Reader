import {
  createHmac,
  createHash,
  timingSafeEqual,
} from 'node:crypto';

const TOKEN_HOURS = 12;

const adminPassword = () => String(process.env.VOXORA_ADMIN_PASSWORD || '');
const signingSecret = () => String(
  process.env.VOXORA_ADMIN_SECRET
  || process.env.VOXORA_ADMIN_PASSWORD
  || '',
);

const digest = (value) => createHash('sha256').update(String(value)).digest();

export const passwordConfigured = () => adminPassword().length >= 8;

export const passwordMatches = (candidate) => {
  if (!passwordConfigured()) return false;
  return timingSafeEqual(digest(candidate), digest(adminPassword()));
};

const signatureFor = (payload) => (
  createHmac('sha256', signingSecret()).update(payload).digest('base64url')
);

export const createAdminToken = () => {
  const payload = Buffer.from(JSON.stringify({
    role: 'voxora-admin',
    exp: Date.now() + TOKEN_HOURS * 60 * 60 * 1000,
  })).toString('base64url');
  return `${payload}.${signatureFor(payload)}`;
};

export const verifyAdminToken = (request) => {
  if (!passwordConfigured()) return false;
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = signatureFor(payload);
  const supplied = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    supplied.length !== expectedBuffer.length
    || !timingSafeEqual(supplied, expectedBuffer)
  ) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'voxora-admin' && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
};
