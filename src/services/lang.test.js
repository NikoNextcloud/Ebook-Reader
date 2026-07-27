import { describe, it, expect } from 'vitest';
import { detectLanguage, langLabel } from './lang';

describe('detectLanguage', () => {
  it('разпознава български по кирилица и специфични букви', () => {
    expect(detectLanguage('Това е български текст, който ще прочетем.')).toBe('bg');
  });

  it('разпознава английски', () => {
    expect(detectLanguage('This is a plain English sentence for testing.')).toBe('en');
  });

  it('разпознава руски (кирилица без български маркери)', () => {
    expect(detectLanguage('Это обычный русский текст для проверки.')).toBe('ru');
  });

  it('връща en по подразбиране за латиница', () => {
    expect(detectLanguage('12345 ??? !!!')).toBe('en');
  });
});

describe('langLabel', () => {
  it('дава етикет за известни езици', () => {
    expect(langLabel('bg')).toBe('Български');
    expect(langLabel('en')).toBe('English');
  });
});
