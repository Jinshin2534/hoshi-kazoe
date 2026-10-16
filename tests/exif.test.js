import { describe, test, expect } from 'vitest';
import { parseExif, formatExposure } from '../src/lib/exif.js';

// 最小の JPEG + EXIF を組み立てる
function buildJpeg({ le = true, entries0 = [], entriesExif = [] } = {}) {
  const bytes = [];
  const u16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  // TIFF 部分
  const tiff = [];
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  const ifd0Size = 2 + (entries0.length + 1) * 12 + 4;
  const exifOff = 8 + ifd0Size;
  const exifSize = 2 + entriesExif.length * 12 + 4;
  let dataOff = exifOff + exifSize;
  const data = [];
  const entry = (tag, type, count, valueBytesOrOffset) => [...u16(tag), ...u16(type), ...u32(count), ...valueBytesOrOffset];
  const enc = (list) => {
    const out = [];
    for (const e of list) {
      if (e.type === 3) out.push(...entry(e.tag, 3, 1, [...u16(e.value), 0, 0]));
      else if (e.type === 5) {
        out.push(...entry(e.tag, 5, 1, u32(dataOff + data.length)));
        data.push(...u32(e.num), ...u32(e.den));
      } else if (e.type === 2) {
        const s = [...e.value].map((c) => c.charCodeAt(0)).concat(0);
        out.push(...entry(e.tag, 2, s.length, u32(dataOff + data.length)));
        data.push(...s);
      }
    }
    return out;
  };
  const ifd0 = [...u16(entries0.length + 1), ...enc(entries0), ...entry(0x8769, 4, 1, u32(exifOff)), ...u32(0)];
  const ifdE = [...u16(entriesExif.length), ...enc(entriesExif), ...u32(0)];
  tiff.push(...ifd0, ...ifdE, ...data);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  bytes.push(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9);
  return new Uint8Array(bytes).buffer;
}

const sample = {
  entries0: [{ tag: 0x010f, type: 2, value: 'Google' }, { tag: 0x0110, type: 2, value: 'Pixel 9' }],
  entriesExif: [
    { tag: 0x829a, type: 5, num: 4, den: 1 },
    { tag: 0x829d, type: 5, num: 168, den: 100 },
    { tag: 0x8827, type: 3, value: 3200 },
    { tag: 0x920a, type: 5, num: 690, den: 100 },
    { tag: 0xa405, type: 3, value: 25 },
  ],
};

describe('parseExif', () => {
  for (const le of [true, false]) {
    test(`${le ? 'リトル' : 'ビッグ'}エンディアン`, () => {
      const e = parseExif(buildJpeg({ le, ...sample }));
      expect(e.make).toBe('Google');
      expect(e.model).toBe('Pixel 9');
      expect(e.exposureTime).toBe(4);
      expect(e.fNumber).toBeCloseTo(1.68);
      expect(e.iso).toBe(3200);
      expect(e.focalLength).toBeCloseTo(6.9);
      expect(e.focal35).toBe(25);
    });
  }
  test('EXIF がない JPEG は空', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]).buffer;
    expect(parseExif(buf)).toEqual({});
  });
  test('JPEG でなければ空', () => {
    expect(parseExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({});
  });
  test('途中で切れていても投げない', () => {
    const full = new Uint8Array(buildJpeg(sample));
    for (const n of [5, 20, 40, 80]) expect(() => parseExif(full.slice(0, n).buffer)).not.toThrow();
  });
});

describe('formatExposure', () => {
  test('表記', () => {
    expect(formatExposure(1 / 30)).toBe('1/30 秒');
    expect(formatExposure(3)).toBe('3 秒');
    expect(formatExposure(undefined)).toBe('不明');
  });
});
