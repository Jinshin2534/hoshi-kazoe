import { describe, test, expect } from 'vitest';
import { analyze, DEFAULT_F35 } from '../src/lib/analyze.js';
import { makeSky } from '../src/lib/synth.js';

const run = (o, extra = {}) => {
  const s = makeSky(o);
  return { s, r: analyze({ luma: s.luma, w: s.w, h: s.h, f35: o.f35 ?? 26, mode: 'demo', ...extra }) };
};

describe('合成の夜空で往復する(撮った空のクラス → 推定)', () => {
  for (let b = 1; b <= 9; b++) {
    test(`ボートル ${b} は ±1 以内、範囲に真値を含む`, () => {
      const { r } = run({ bortle: b, seed: 11 + b });
      expect(r.status).toBe('ok');
      expect(Math.abs(r.est.bortle - b)).toBeLessThanOrEqual(1);
      expect(r.est.bortleRange[0]).toBeLessThanOrEqual(b);
      expect(r.est.bortleRange[1]).toBeGreaterThanOrEqual(b);
    }, 20000);
  }
  test('3〜8 は真ん中の値がぴったり合う', () => {
    for (const b of [3, 5, 8]) expect(run({ bortle: b, seed: 2 }).r.est.bortle).toBe(b);
  }, 20000);
  test('明るい空ほど星が少ない', () => {
    const counts = [2, 5, 8].map((b) => run({ bortle: b, seed: 4 }).r.count);
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
  }, 20000);
});

describe('邪魔なものがあっても', () => {
  test('山並みは除外して、空の部分だけで同じ答え', () => {
    const { r } = run({ bortle: 5, seed: 3, horizon: true });
    expect(r.sky.validFraction).toBeLessThan(0.8);
    expect(r.est.bortle).toBe(5);
    expect(r.warnings.some((w) => w.includes('線のように'))).toBe(false); // 山の縁を線と呼ばない
  }, 20000);
  test('月があっても同じ答え、注意書きが出る', () => {
    const { r } = run({ bortle: 4, seed: 3, moon: true });
    expect(r.est.bortle).toBe(4);
    expect(r.warnings.some((w) => w.includes('月'))).toBe(true);
  }, 20000);
  test('別の焦点距離で撮っても、その焦点距離を渡せば同じ答え', () => {
    const { r } = run({ bortle: 6, seed: 5, f35: 40 });
    expect(r.est.bortle).toBe(6);
  }, 20000);
});

describe('正直さ', () => {
  test('焦点距離が分からなければ 26mm を仮定し、そう書く', () => {
    const s = makeSky({ bortle: 4, seed: 1 });
    const r = analyze({ luma: s.luma, w: s.w, h: s.h });
    expect(r.f35).toBe(DEFAULT_F35);
    expect(r.f35Assumed).toBe(true);
    expect(r.warnings[0]).toContain('仮定');
  }, 20000);
  test('焦点距離を取り違えると結果が動く(=入力が効いている)', () => {
    const s = makeSky({ bortle: 5, seed: 6, f35: 26 });
    const wide = analyze({ luma: s.luma, w: s.w, h: s.h, f35: 13 });
    const tele = analyze({ luma: s.luma, w: s.w, h: s.h, f35: 52 });
    expect(wide.est.bortle).toBeGreaterThan(tele.est.bortle);
  }, 20000);
  test('星のない空は「測れない」と言う', () => {
    const w = 600, h = 400;
    const luma = new Float32Array(w * h).fill(40);
    for (let i = 0; i < luma.length; i++) luma[i] += (i * 7919 % 13) / 6 - 1;
    const r = analyze({ luma, w, h, f35: 26 });
    expect(r.status).toBe('too-few');
    expect(r.est).toBeUndefined();
    expect(r.reason).toContain('区別できない');
  });
  test('空がほとんど写っていなければ「測れない」', () => {
    const s = makeSky({ bortle: 4, seed: 1 });
    for (let i = 0; i < s.luma.length * 0.95; i++) s.luma[i] = 3; // 上 95% が真っ暗な何か
    for (let i = Math.floor(s.luma.length * 0.95); i < s.luma.length; i++) s.luma[i] = 255;
    const r = analyze({ luma: s.luma, w: s.w, h: s.h, f35: 26 });
    expect(r.status).not.toBe('ok');
  });
  test('露光が短い写真には「都会寄りに出る」と注意する', () => {
    const s = makeSky({ bortle: 4, seed: 1 });
    const r = analyze({ luma: s.luma, w: s.w, h: s.h, f35: 26, exposureTime: 1 / 30 });
    expect(r.warnings.some((w) => w.includes('都会寄り'))).toBe(true);
  }, 20000);
  test('カメラが浅いと明るい空と出る(推定の向き)', () => {
    const deep = run({ bortle: 4, seed: 8 }).r;
    const shallow = run({ bortle: 4, seed: 8, depthShift: -2 }).r;
    expect(shallow.est.bortle).toBeGreaterThan(deep.est.bortle);
  }, 20000);
  test('大きな写真は縮めて解析するが、空の広さは元の大きさで同じ', () => {
    const s = makeSky({ bortle: 6, seed: 2, w: 2400, h: 1800 });
    const r = analyze({ luma: s.luma, w: s.w, h: s.h, f35: 26 });
    expect(r.scale).toBe(2);
    expect(r.status).toBe('ok');
  }, 30000);
});
