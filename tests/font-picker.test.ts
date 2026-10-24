import { describe, it, expect } from 'vitest';
import { fontScripts, fontType, previewText, sections, textScripts } from '../src/ui/font-picker';
import { webFont } from '../src/render/fonts';

describe('font list', () => {
  it('knows each font’s type and scripts', () => {
    expect(fontType(webFont('Lora'))).toBe('serif');
    expect(fontType(webFont('Pacifico'))).toBe('script');
    expect(fontScripts(webFont('Rubik'))).toEqual(['cyrillic', 'hebrew', 'latin']);
    expect(fontScripts(webFont('Noto Sans Symbols 2'))).toEqual(['symbols']);
    expect(fontScripts(webFont('Cairo'))).toEqual(['arabic', 'latin']);
  });
  it('previews the layer text when the font has its letters, else a sample in the script', () => {
    expect(previewText('Hello', webFont('Lora'), 'latin')).toBe('Hello');
    expect(previewText('Hello', webFont('Lora'), 'cyrillic')).toBe('Пример');
    expect(previewText('שלום', webFont('Lora'))).toBe('Sample');
    expect(previewText('שלום', webFont('Heebo'), 'hebrew')).toBe('שלום');
    expect(previewText('', webFont('Heebo'), 'hebrew')).toBe('דוגמה');
    expect(textScripts('Hi שלום')).toEqual(['hebrew', 'latin']);
  });
  it('groups the Google Fonts by script, a font in each of its scripts', () => {
    const s = sections('Hi', 'Lora'),
      names = s.map(x => x[0]);
    expect(names.slice(-1)[0]).toBe('On this computer');
    expect(names).toContain('Hebrew');
    expect(names.indexOf('Hebrew')).toBeLessThan(names.indexOf('Latin'));
    const hebrew = s.find(x => x[0] === 'Hebrew')[2].map(r => r.family);
    expect(hebrew).toContain('Rubik');
    expect(hebrew).not.toContain('Lora');
    expect(s.find(x => x[0] === 'Latin')[2].some(r => r.family === 'Rubik')).toBe(true);
  });
});
