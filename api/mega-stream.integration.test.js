import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const SIZE = 250 * 1024 * 1024;
const calls = [];

vi.mock('megajs', () => ({
  File: {
    fromURL: () => ({
      name: 'kniga.m4b',
      size: SIZE,
      loadAttributes: async () => {},
      download: ({ start, end } = {}) => {
        calls.push({ start, end });
        if (start === undefined) return Readable.from([Buffer.alloc(1024, 7)]);
        return Readable.from([Buffer.alloc(end - start + 1, 7)]);
      },
    }),
  },
}));

const { GET, HEAD } = await import('./mega-stream.js');
const req = (url, headers = {}) => new Request(url, { headers });
const OK = 'https://mega.nz/folder/A3QgXZTI#key/file/xyz';
const target = (u) => `https://app.test/api/mega-stream?url=${encodeURIComponent(u)}`;

beforeEach(() => { calls.length = 0; });

describe('/api/mega-stream', () => {
  it('отхвърля чужди адреси (защита от SSRF)', async () => {
    const res = await GET(req(target('https://evil.com/file')));
    expect(res.status).toBe(400);
  });

  it('без Range връща 200 с пълната дължина (Safari отхвърля 206 тук)', async () => {
    const res = await GET(req(target(OK)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(res.headers.get('content-range')).toBeNull();
  });

  it('с Range връща 206 с правилни заглавия за превъртане', async () => {
    const res = await GET(req(target(OK), { range: 'bytes=0-' }));
    expect(res.status).toBe(206);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-range')).toBe(`bytes 0-${8 * 1024 * 1024 - 1}/${SIZE}`);
  });

  it('тегли само поискания прозорец, а не целия файл', async () => {
    await GET(req(target(OK), { range: 'bytes=0-' }));
    expect(calls[0].start).toBe(0);
    expect(calls[0].end - calls[0].start + 1).toBe(8 * 1024 * 1024);
  });

  it('превъртането в средата дърпа точния диапазон', async () => {
    const mid = 100 * 1024 * 1024;
    const res = await GET(req(target(OK), { range: `bytes=${mid}-` }));
    expect(res.status).toBe(206);
    expect(calls[0].start).toBe(mid);
    expect(res.headers.get('content-range')).toBe(`bytes ${mid}-${mid + 8 * 1024 * 1024 - 1}/${SIZE}`);
  });

  it('тялото съдържа точно толкова байта, колкото обещава Content-Length', async () => {
    const res = await GET(req(target(OK), { range: 'bytes=0-999' }));
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(1000);
    expect(res.headers.get('content-length')).toBe('1000');
  });

  it('невалиден диапазон връща 416', async () => {
    const res = await GET(req(target(OK), { range: `bytes=${SIZE + 10}-` }));
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${SIZE}`);
  });

  it('HEAD дава размера, без да сваля нищо', async () => {
    const res = await HEAD(req(target(OK)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    expect(calls).toHaveLength(0);
  });
});
