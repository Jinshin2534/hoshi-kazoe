// 画素配列まわりの純粋関数。輝度は 0〜255 の Float32Array で持つ。

/** RGBA(Uint8ClampedArray) → 輝度 */
export function toLuma(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return out;
}

/** 長辺が maxSide 以下になるよう、整数倍の箱平均で縮小する */
export function downscale(luma, w, h, maxSide) {
  const f = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
  if (f === 1) return { luma, w, h, factor: 1 };
  const nw = Math.floor(w / f);
  const nh = Math.floor(h / f);
  const out = new Float32Array(nw * nh);
  const inv = 1 / (f * f);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * w + x * f;
        for (let dx = 0; dx < f; dx++) s += luma[row + dx];
      }
      out[y * nw + x] = s * inv;
    }
  }
  return { luma: out, w: nw, h: nh, factor: f };
}

/** 同じ大きさのフレームを平均する(ノイズは √枚数 分の1 になる) */
export function stackFrames(frames) {
  if (!frames.length) throw new Error('フレームがありません');
  const n = frames[0].length;
  const out = new Float32Array(n);
  for (const f of frames) {
    if (f.length !== n) throw new Error('フレームの大きさがそろっていません');
    for (let i = 0; i < n; i++) out[i] += f[i];
  }
  const inv = 1 / frames.length;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

/** 少しずつ足していく版(ライブで全フレームを持たないため) */
export function createStacker(size) {
  const sum = new Float32Array(size);
  let count = 0;
  return {
    add(frame) {
      if (frame.length !== size) throw new Error('フレームの大きさがそろっていません');
      for (let i = 0; i < size; i++) sum[i] += frame[i];
      count++;
    },
    get count() { return count; },
    result() {
      const out = new Float32Array(size);
      if (count) for (let i = 0; i < size; i++) out[i] = sum[i] / count;
      return out;
    },
  };
}

export function median(arr) {
  if (!arr.length) return NaN;
  const a = Float32Array.from(arr).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 中央値と MAD から出した頑健な標準偏差 */
export function robustStats(arr) {
  const med = median(arr);
  const dev = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) dev[i] = Math.abs(arr[i] - med);
  return { median: med, sigma: 1.4826 * median(dev) };
}
