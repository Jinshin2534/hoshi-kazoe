import { describe, test, expect } from 'vitest';
import { detectStars, classifySky, starsInSky, countStars, smooth3, interpolateTiles } from '../src/lib/detect.js';
import { toLuma, downscale, stackFrames, createStacker, robustStats } from '../src/lib/image.js';
import { mulberry32 } from '../src/lib/synth.js';

function noise(w, h, level, sigma, seed = 1) {
  const r = mulberry32(seed);
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) {
    const u = Math.max(r(), 1e-12), v = r();
    a[i] = level + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  return a;
}
function addStar(a, w, x, y, amp, s = 1) {
  for (let yy = Math.floor(y) - 5; yy <= Math.floor(y) + 5; yy++) for (let xx = Math.floor(x) - 5; xx <= Math.floor(x) + 5; xx++) {
    a[yy * w + xx] += amp * Math.exp(-((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2) / (2 * s * s));
  }
}

describe('画像の下ごしらえ', () => {
  test('toLuma は白=255 黒=0', () => {
    const l = toLuma(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
    expect(l[0]).toBeCloseTo(255, 3);
    expect(l[1]).toBe(0);
  });
  test('downscale は平均を保つ', () => {
    const a = noise(400, 300, 50, 5);
    const d = downscale(a, 400, 300, 100);
    expect(d.factor).toBe(4);
    expect(d.w).toBe(100);
    expect(robustStats(d.luma).median).toBeCloseTo(50, 0);
  });
  test('小さい画像は縮めない', () => {
    expect(downscale(new Float32Array(4), 2, 2, 100).factor).toBe(1);
  });
  test('重ねるとノイズが √N 分の1', () => {
    const frames = Array.from({ length: 16 }, (_, k) => noise(64, 64, 20, 4, k + 1));
    const one = robustStats(frames[0]).sigma;
    const st = robustStats(stackFrames(frames)).sigma;
    expect(one / st).toBeGreaterThan(3.3);
    expect(one / st).toBeLessThan(4.7);
  });
  test('createStacker は stackFrames と同じ', () => {
    const frames = [noise(8, 8, 3, 1, 1), noise(8, 8, 3, 1, 2), noise(8, 8, 3, 1, 3)];
    const s = createStacker(64);
    frames.forEach((f) => s.add(f));
    expect(s.count).toBe(3);
    expect(Array.from(s.result())).toEqual(Array.from(stackFrames(frames)));
  });
  test('大きさが違うフレームは重ねない', () => {
    expect(() => stackFrames([new Float32Array(4), new Float32Array(5)])).toThrow();
    expect(() => stackFrames([])).toThrow();
  });
  test('smooth3 は一様な画像を変えない', () => {
    const a = new Float32Array(25).fill(7);
    expect(Array.from(smooth3(a, 5, 5)).every((v) => Math.abs(v - 7) < 1e-6)).toBe(true);
  });
  test('interpolateTiles はタイル中心で元の値', () => {
    const out = interpolateTiles(new Float32Array([0, 10, 20, 30]), 2, 2, 8, 8, 4);
    expect(out[1 * 8 + 1]).toBeCloseTo(0, 6); // (1.5,1.5) は最初のタイル中心
    expect(out[7 * 8 + 7]).toBeCloseTo(30, 6); // 端は外挿せず端のタイルの値
  });
});

describe('detectStars', () => {
  test('ノイズだけなら星はほぼゼロ', () => {
    const w = 400, h = 300;
    const det = detectStars(noise(w, h, 20, 2), w, h);
    expect(det.stars.length).toBeLessThanOrEqual(1);
  });
  test('明るい星はすべて見つかり、位置も合う', () => {
    const w = 320, h = 240;
    const a = noise(w, h, 20, 2, 5);
    const truth = [[40.3, 50.7], [100, 100], [250.5, 30.2], [200, 200], [300, 120]];
    for (const [x, y] of truth) addStar(a, w, x, y, 40);
    const det = detectStars(a, w, h);
    expect(det.stars.length).toBe(5);
    for (const [x, y] of truth) {
      const near = det.stars.find((s) => Math.hypot(s.x + 0.5 - x, s.y + 0.5 - y) < 0.8);
      expect(near).toBeTruthy();
    }
  });
  test('ノイズに埋もれる暗さの星は拾わない', () => {
    const w = 200, h = 200;
    const a = noise(w, h, 20, 2, 9);
    addStar(a, w, 100, 100, 1.5);
    expect(detectStars(a, w, h).stars.length).toBeLessThanOrEqual(1);
  });
  test('くっついた 2 つの星は 2 個と数える', () => {
    const w = 200, h = 200;
    const a = noise(w, h, 20, 1, 4);
    addStar(a, w, 100, 100, 60);
    addStar(a, w, 103.5, 100, 60);
    const det = detectStars(a, w, h);
    expect(countStars(det.stars)).toBe(2);
  });
  test('細長い線(飛行機・衛星)は星にしない', () => {
    const w = 300, h = 200;
    const a = noise(w, h, 20, 2, 2);
    for (let x = 50; x < 250; x++) {
      const y = 50 + x * 0.4;
      for (let dy = -2; dy <= 2; dy++) a[Math.round(y + dy) * w + x] += 50 * Math.exp(-(dy * dy) / 2);
    }
    const det = detectStars(a, w, h);
    expect(det.blobs.some((b) => b.kind === 'trail')).toBe(true);
    expect(det.stars.length).toBeLessThanOrEqual(1);
  });
  test('真っ黒につぶれた空(ノイズ 0)でも星は拾え、誤検出しない', () => {
    const w = 200, h = 200;
    const a = new Float32Array(w * h);
    addStar(a, w, 60, 60, 80);
    addStar(a, w, 140, 120, 80);
    const det = detectStars(a, w, h);
    expect(det.stars.length).toBe(2);
  });
});

describe('classifySky', () => {
  test('一様な空はすべて有効', () => {
    const w = 256, h = 192;
    const sky = classifySky(detectStars(noise(w, h, 30, 2), w, h));
    expect(sky.validFraction).toBe(1);
    expect(sky.crushed).toBe(false);
  });
  test('下半分の暗いシルエットは除外する', () => {
    const w = 256, h = 256;
    const a = noise(w, h, 30, 2);
    for (let i = (h / 2) * w; i < w * h; i++) a[i] = 3 + (a[i] - 30) * 0.2;
    const sky = classifySky(detectStars(a, w, h));
    // 境目のタイル 1 列は背景を引き切れないので空側も捨てる(数え損ねるより安全)
    expect(sky.validFraction).toBeGreaterThan(0.3);
    expect(sky.validFraction).toBeLessThan(0.55);
    expect(sky.reason.slice(-8 * 3).every((r) => r !== null)).toBe(true);
  });
  test('周辺減光(隅が 3 割暗い)は空のまま', () => {
    const w = 256, h = 192;
    const a = noise(w, h, 30, 1.5);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) / Math.SQRT2;
      a[y * w + x] *= 1 - 0.3 * r * r;
    }
    expect(classifySky(detectStars(a, w, h)).validFraction).toBe(1);
  });
  test('ざらついた部分(建物・木の輪郭)は除外', () => {
    const w = 256, h = 256;
    const a = noise(w, h, 30, 2);
    const r = mulberry32(7);
    for (let y = 192; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = 30 + (r() - 0.5) * 80;
    const sky = classifySky(detectStars(a, w, h));
    expect(sky.validFraction).toBeLessThan(0.8);
    expect(sky.reason.filter((x) => x === 'rough').length).toBeGreaterThan(0);
  });
  test('月のような明るい塊の周りは除外し、そこは数えない', () => {
    const w = 320, h = 320;
    const a = noise(w, h, 20, 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 160, y - 160) < 20) a[y * w + x] = 255;
    addStar(a, w, 40, 40, 40);
    const det = detectStars(a, w, h);
    const sky = classifySky(det);
    expect(det.blobs.some((b) => b.kind === 'big')).toBe(true);
    expect(sky.reason.includes('object')).toBe(true);
    expect(starsInSky(det, sky).length).toBe(1);
  });
  test('空が真っ黒なら crushed', () => {
    const w = 128, h = 128;
    expect(classifySky(detectStars(new Float32Array(w * h), w, h)).crushed).toBe(true);
  });
});
