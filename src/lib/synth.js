// 合成の夜空。実機・実際の夜空がなくても検証できるように、
// 「ボートル n の空をスマホの天体モードで撮った写真」を、推定側と同じ仮定で作る。
import { fieldDeg2, starsBrighterThan, magnitudeForCount, typicalNelm, CAMERA_OFFSET, SKY_DEG2 } from './astro.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * @param {object} o
 * @param {number} [o.bortle=4]
 * @param {number} [o.w=1200] @param {number} [o.h=900]
 * @param {number} [o.f35=26] 35mm 換算焦点距離
 * @param {number} [o.seed=1]
 * @param {boolean} [o.horizon=false] 下 25% に山並みのシルエット
 * @param {boolean} [o.moon=false] 明るい月
 * @param {number} [o.depthShift=0] カメラが仮定より何等深く写るか(負なら浅い)
 * @returns {{ luma: Float32Array, w, h, truth }}
 */
export function makeSky(o = {}) {
  const { bortle = 4, w = 1200, h = 900, f35 = 26, seed = 1, horizon = false, moon = false, depthShift = 0 } = o;
  const rng = mulberry32(seed);
  const nelm = typicalNelm(bortle);
  const mPhoto = nelm + CAMERA_OFFSET + depthShift;

  // 空の明るさとノイズ: 明るい空ほど背景が持ち上がり、ノイズも増える
  const level = 8 + 7 * (bortle - 1);
  const sigma = 1.2 + 0.18 * Math.sqrt(level);

  // 地平線(ゆるやかな山並み)
  const ridge = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    ridge[x] = horizon
      ? h * 0.75 + 25 * Math.sin(x / 90 + seed) + 12 * Math.sin(x / 23 + 2 * seed)
      : h + 1;
  }

  const luma = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    // 地平線に向かって少し明るくなる光害のグラデーション
    const grad = level * (1 + 0.25 * (y / h));
    for (let x = 0; x < w; x++) luma[y * w + x] = y >= ridge[x] ? 3 : grad;
  }

  // 星: 推定側と同じ星数表から等級を引き、仮定した深さで写る明るさにする
  const area = fieldDeg2(w, h, f35);
  const mMax = mPhoto + 1.5;
  const nAll = starsBrighterThan(mMax);
  const n = Math.round(nAll * area / SKY_DEG2);
  // ならし後のピークがノイズの 5 倍 ≒ 限界等級、になる明るさ
  const psf = 1.0;
  const fluxLim = 5 * 0.375 * sigma * 2 * Math.PI * (psf * psf + 0.5);
  let drawn = 0, brighterThanLimit = 0;
  for (let k = 0; k < n; k++) {
    const m = magnitudeForCount(rng() * nAll);
    const x = rng() * w, y = rng() * h;
    if (y >= ridge[Math.min(w - 1, Math.floor(x))]) continue;
    drawn++;
    if (m <= mPhoto) brighterThanLimit++;
    const flux = fluxLim * 10 ** (-0.4 * (m - mPhoto));
    const amp = flux / (2 * Math.PI * psf * psf);
    const r = Math.ceil(psf * 3 + Math.max(0, Math.log10(amp)));
    for (let yy = Math.max(0, Math.floor(y) - r); yy <= Math.min(h - 1, Math.floor(y) + r); yy++) {
      for (let xx = Math.max(0, Math.floor(x) - r); xx <= Math.min(w - 1, Math.floor(x) + r); xx++) {
        const d2 = (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2;
        luma[yy * w + xx] += amp * Math.exp(-d2 / (2 * psf * psf));
      }
    }
  }

  if (moon) {
    const mx = w * 0.7, my = h * 0.25, R = Math.min(w, h) * 0.04;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - mx, y - my);
      if (d < R) luma[y * w + x] = 255;
      else if (d < R * 4) luma[y * w + x] += 120 * Math.exp(-(d - R) / (R * 0.6));
    }
  }

  for (let i = 0; i < luma.length; i++) {
    luma[i] = Math.min(255, Math.max(0, Math.round(luma[i] + gauss(rng) * sigma)));
  }
  return { luma, w, h, truth: { bortle, nelm, mPhoto, stars: drawn, brighterThanLimit, f35 } };
}

/** 輝度を表示用の RGBA に(少し青みを足す) */
export function lumaToRgba(luma, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < luma.length; i++, j += 4) {
    const v = luma[i];
    out[j] = v * 0.92; out[j + 1] = v * 0.96; out[j + 2] = Math.min(255, v * 1.08 + 4); out[j + 3] = 255;
  }
  return out;
}
