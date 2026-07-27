import { describe, it, expect } from 'vitest';
import { cleanPdfText, cleanMarkdown, cleanRtf, cleanHtml } from './textCleanup';

describe('cleanPdfText', () => {
  it('обединява пренесени с тире думи', () => {
    expect(cleanPdfText('при-\nмер')).toBe('пример');
  });

  it('маха самостоятелни номера на страници', () => {
    const out = cleanPdfText('Текст на страницата.\n42\nОще текст.');
    expect(out).not.toMatch(/^42$/m);
    expect(out).toContain('Още текст');
  });
});

describe('cleanMarkdown', () => {
  it('маха заглавия, удебеляване и линкове, пази думите', () => {
    const out = cleanMarkdown('# Заглавие\n**удебелен** и [линк](http://x)');
    expect(out).toContain('Заглавие');
    expect(out).toContain('удебелен');
    expect(out).toContain('линк');
    expect(out).not.toContain('#');
    expect(out).not.toContain('http');
  });
});

describe('cleanRtf', () => {
  it('маха control words', () => {
    expect(cleanRtf('{\\rtf1 Здравей\\par свят}')).toContain('Здравей');
  });
});

describe('cleanHtml', () => {
  it('извлича текста и маха скриптове', () => {
    const out = cleanHtml('<html><body><script>bad()</script><p>Здравей свят</p></body></html>');
    expect(out).toContain('Здравей свят');
    expect(out).not.toContain('bad');
  });
});
