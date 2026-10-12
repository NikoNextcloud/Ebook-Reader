import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createAdminToken,
  passwordConfigured,
  passwordMatches,
  verifyAdminToken,
} from '../server/adminAuth.js';
import {
  ACTIVE_WINDOW_MS,
  isSameActivity,
  mergeDevice,
  parseHashResult,
  sanitizeHeartbeat,
  validDeviceId,
} from '../server/listenerStore.js';

const DEVICE_ID = 'device_1234567890abcdefghijk';

describe('admin authentication', () => {
  beforeEach(() => {
    process.env.VOXORA_ADMIN_PASSWORD = 'very-strong-password';
    process.env.VOXORA_ADMIN_SECRET = 'a-different-long-signing-secret';
  });

  afterEach(() => {
    delete process.env.VOXORA_ADMIN_PASSWORD;
    delete process.env.VOXORA_ADMIN_SECRET;
  });

  it('keeps password validation and signed sessions on the server', () => {
    expect(passwordConfigured()).toBe(true);
    expect(passwordMatches('very-strong-password')).toBe(true);
    expect(passwordMatches('wrong-password')).toBe(false);

    const token = createAdminToken();
    const request = new Request('https://voxora.test/api/admin-listeners', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(verifyAdminToken(request)).toBe(true);
  });

  it('rejects a modified session token', () => {
    const token = createAdminToken();
    const request = new Request('https://voxora.test/api/admin-listeners', {
      headers: { Authorization: `Bearer ${token.slice(0, -2)}xx` },
    });
    expect(verifyAdminToken(request)).toBe(false);
  });
});

describe('listener records', () => {
  const request = new Request('https://voxora.test/api/listener-heartbeat', {
    headers: {
      'x-forwarded-for': '203.0.113.5',
      'x-vercel-ip-city': 'Sofia',
      'x-vercel-ip-country': 'BG',
    },
  });

  beforeEach(() => {
    process.env.VOXORA_ADMIN_SECRET = 'listener-test-secret';
  });

  afterEach(() => {
    delete process.env.VOXORA_ADMIN_SECRET;
    vi.restoreAllMocks();
  });

  it('validates anonymous device ids and sanitizes heartbeat data', () => {
    expect(validDeviceId(DEVICE_ID)).toBe(true);
    expect(validDeviceId('short')).toBe(false);

    const record = sanitizeHeartbeat({
      deviceId: DEVICE_ID,
      sessionId: 'session_1234567890abcdefghijk',
      state: 'playing',
      device: { label: 'Android · Chrome', os: 'Android', browser: 'Chrome' },
      book: { id: 'book-1', title: 'Тома Неверни', type: 'audio' },
      position: 320,
      duration: 4000,
    }, request, 1000);

    expect(record.state).toBe('playing');
    expect(record.location).toBe('Sofia, BG');
    expect(record.networkId).toHaveLength(12);
    expect(record.book.type).toBe('audio');
    expect(record.lastSeen).toBe(1000);
  });

  it('preserves first seen and last active time between heartbeats', () => {
    const previous = {
      id: DEVICE_ID,
      firstSeen: 100,
      lastSeen: 500,
      lastActiveAt: 500,
      state: 'playing',
    };
    const next = {
      id: DEVICE_ID,
      firstSeen: 900,
      lastSeen: 900,
      lastActiveAt: 0,
      state: 'paused',
    };
    expect(mergeDevice(previous, next)).toMatchObject({
      firstSeen: 100,
      lastSeen: 900,
      lastActiveAt: 500,
    });
  });

  it('does not create history entries for repeated heartbeats', () => {
    const activity = { state: 'playing', book: { id: 'book-1' } };
    expect(isSameActivity(activity, { ...activity })).toBe(true);
    expect(isSameActivity(activity, { state: 'paused', book: activity.book })).toBe(false);
  });

  it('parses Redis HGETALL output and exposes the active window', () => {
    const rows = parseHashResult([
      DEVICE_ID,
      JSON.stringify({ id: DEVICE_ID, state: 'playing' }),
      'broken',
      '{',
    ]);
    expect(rows).toHaveLength(1);
    expect(ACTIVE_WINDOW_MS).toBe(45000);
  });
});
