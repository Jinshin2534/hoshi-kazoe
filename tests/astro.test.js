import { describe, test, expect } from 'vitest';
import {
  starsBrighterThan, magnitudeForCount, fieldDeg2, diagonalFovDeg, bortleFromNelm,
  typicalNelm, nelmFromSqm, sqmFromNelm, estimateSky, countSigmaMag, SKY_DEG2, BORTLE,
} from '../src/lib/astro.js';

describe('星の数の表', () => {
  test('表の点はそのまま返す', () => {
    expect(starsBrighterThan(6)).toBeCloseTo(4800, 6);
    expect(starsBrighterThan(3)).toBeCloseTo(171, 6);
  });
  test('暗くなるほど増える(単調)', () => {
    let prev = 0;
    for (let m = -2; m <= 11; m += 0.25) {
      const n = starsBrighterThan(m);
      expect(n).toBeGreaterThan(prev);
      prev = n;
    }
  });
  test('逆関数で元に戻る', () => {
    for (const m of [-1.5, 0.3, 2.2, 4.7, 6.5, 8.9, 10.5]) {
      expect(magnitudeForCount(starsBrighterThan(m))).toBeCloseTo(m, 6);
    }
  });
  test('0 個なら -∞', () => {
    expect(magnitudeForCount(0)).toBe(-Infinity);
  });
});

describe('写っている空の広さ', () => {
  test('26mm 相当の対角画角は約 80°', () => {
    expect(diagonalFovDeg(26)).toBeGreaterThan(78);
    expect(diagonalFovDeg(26)).toBeLessThan(81);
  });
  test('焦点距離が倍になると、狭い画角では面積がほぼ 1/4', () => {
    const a = fieldDeg2(4000, 3000, 200), b = fieldDeg2(4000, 3000, 400);
    expect(a / b).toBeCloseTo(4, 1);
  });
  test('望遠では 長辺角×短辺角 にほぼ一致する', () => {
    const f = 500, w = 4000, h = 3000;
    const fpx = Math.hypot(w, h) * f / 43.27;
    const approx = (w / fpx * 180 / Math.PI) * (h / fpx * 180 / Math.PI);
    expect(fieldDeg2(w, h, f) / approx).toBeCloseTo(1, 2);
  });
  test('解像度ではなく縦横比と焦点距離で決まる', () => {
    expect(fieldDeg2(4032, 3024, 26)).toBeCloseTo(fieldDeg2(1344, 1008, 26), 6);
  });
  test('超広角でも全天(41253 平方度)の半分は超えない', () => {
    expect(fieldDeg2(4000, 3000, 13)).toBeLessThan(SKY_DEG2 / 2);
  });
  test('焦点距離が不正なら投げる', () => {
    expect(() => fieldDeg2(100, 100, 0)).toThrow();
  });
});

describe('ボートルスケール', () => {
  test('境目', () => {
    expect(bortleFromNelm(7.6)).toBe(1);
    expect(bortleFromNelm(7.59)).toBe(2);
    expect(bortleFromNelm(6.0)).toBe(5);
    expect(bortleFromNelm(4.1)).toBe(8);
    expect(bortleFromNelm(4.09)).toBe(9);
    expect(bortleFromNelm(-3)).toBe(9);
  });
  test('代表値はそのクラスに入る', () => {
    for (const b of BORTLE) expect(bortleFromNelm(typicalNelm(b.cls))).toBe(b.cls);
  });
});

describe('SQM ↔ NELM', () => {
  test('往復で戻る', () => {
    for (const n of [3, 4.5, 6, 7, 7.5]) expect(nelmFromSqm(sqmFromNelm(n))).toBeCloseTo(n, 6);
  });
  test('暗い空(SQM 21.5)で NELM はおよそ 6.2〜7', () => {
    expect(nelmFromSqm(21.5)).toBeGreaterThan(6.2);
    expect(nelmFromSqm(21.5)).toBeLessThan(7.1);
  });
  test('NELM が上限に近くても有限', () => {
    expect(Number.isFinite(sqmFromNelm(8.5))).toBe(true);
  });
});

describe('estimateSky', () => {
  test('全天換算でちょうど 4800 個 → 写真の限界 6 等', () => {
    const area = 1000;
    const e = estimateSky(4800 * area / SKY_DEG2, area, { offset: 0.5 });
    expect(e.mPhoto).toBeCloseTo(6, 6);
    expect(e.nelm).toBeCloseTo(5.5, 6);
    expect(e.bortle).toBe(6);
  });
  test('星が多いほど暗い空(クラスが小さい)', () => {
    const a = estimateSky(50, 2000), b = estimateSky(2000, 2000);
    expect(b.bortle).toBeLessThan(a.bortle);
    expect(b.sqm).toBeGreaterThan(a.sqm);
  });
  test('幅: 少ない星ほど誤差が大きく、範囲は推定値を含む', () => {
    const few = estimateSky(5, 2000), many = estimateSky(1000, 2000);
    expect(few.sigma).toBeGreaterThan(many.sigma);
    for (const e of [few, many]) {
      expect(e.bortleRange[0]).toBeLessThanOrEqual(e.bortle);
      expect(e.bortleRange[1]).toBeGreaterThanOrEqual(e.bortle);
      expect(e.sqmRange[0]).toBeLessThanOrEqual(e.sqm);
      expect(e.sqmRange[1]).toBeGreaterThanOrEqual(e.sqm);
    }
  });
  test('数え誤差は √N で縮む', () => {
    expect(countSigmaMag(100) / countSigmaMag(400)).toBeCloseTo(2, 6);
  });
});
