// 星の検出。背景(タイルごとの中央値)を引き、3×3 で軽くならした画像で
// 「周りのノイズの k 倍より明るい極大」を種にして領域を広げる。
import { median, robustStats } from './image.js';

export const DETECT_DEFAULTS = {
  tile: 32,        // 背景・ノイズを測るタイルの一辺(px)
  kSeed: 5,        // 種にする明るさ(ならし後のノイズの何倍)
  kGrow: 2.5,      // 領域を広げる明るさ
  minSigma: 0.35,  // JPEG で空が真っ黒だとノイズが 0 になるので下限を置く
  maxStarArea: 0,  // これより大きい塊は星ではない(0 なら画素数から決める)
  maxElongation: 3.5,
  minTrailLength: 20, // これより短い細長い塊は線(飛行機・衛星)とみなさない
};

function tileGrid(w, h, T) {
  return { tx: Math.ceil(w / T), ty: Math.ceil(h / T) };
}

function tileValues(img, w, h, T, tx, ty) {
  const x0 = tx * T, y0 = ty * T;
  const x1 = Math.min(w, x0 + T), y1 = Math.min(h, y0 + T);
  const vals = new Float32Array((x1 - x0) * (y1 - y0));
  let k = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vals[k++] = img[y * w + x];
  return vals;
}

/** タイル中心の値を双一次補間して画素ごとの背景にする */
export function interpolateTiles(values, gx, gy, w, h, T) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let fy = (y + 0.5) / T - 0.5;
    fy = Math.min(Math.max(fy, 0), gy - 1);
    const y0 = Math.floor(fy), y1 = Math.min(gy - 1, y0 + 1), ay = fy - y0;
    for (let x = 0; x < w; x++) {
      let fx = (x + 0.5) / T - 0.5;
      fx = Math.min(Math.max(fx, 0), gx - 1);
      const x0 = Math.floor(fx), x1 = Math.min(gx - 1, x0 + 1), ax = fx - x0;
      const a = values[y0 * gx + x0], b = values[y0 * gx + x1];
      const c = values[y1 * gx + x0], d = values[y1 * gx + x1];
      out[y * w + x] = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
    }
  }
  return out;
}

/** [1,2,1]⊗[1,2,1]/16 でならす(端は鏡映) */
export function smooth3(img, w, h) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const l = img[r + (x > 0 ? x - 1 : 1 % w)];
      const rr = img[r + (x < w - 1 ? x + 1 : Math.max(0, w - 2))];
      tmp[r + x] = (l + 2 * img[r + x] + rr) / 4;
    }
  }
  for (let y = 0; y < h; y++) {
    const u = (y > 0 ? y - 1 : Math.min(1, h - 1)) * w;
    const d = (y < h - 1 ? y + 1 : Math.max(0, h - 2)) * w;
    const r = y * w;
    for (let x = 0; x < w; x++) out[r + x] = (tmp[u + x] + 2 * tmp[r + x] + tmp[d + x]) / 4;
  }
  return out;
}

/**
 * 星を検出する。
 * @returns {{ stars, blobs, tiles, gx, gy, T, w, h }}
 *   stars: 星らしい点 {x,y,flux,peak,peaks,area,elong}(peaks=重なっていた星の数)
 *   blobs: 星ではない塊 {x,y,area,kind:'big'|'extended'|'trail', x0,y0,x1,y1}
 *   tiles: タイルごとの {level, sigmaRaw, sigma}(level=背景の中央値、sigma=ならし後のノイズ)
 */
export function detectStars(luma, w, h, opts = {}) {
  const o = { ...DETECT_DEFAULTS, ...opts };
  const T = o.tile;
  const { tx: gx, ty: gy } = tileGrid(w, h, T);
  const levels = new Float32Array(gx * gy);
  const sigmaRaw = new Float32Array(gx * gy);
  for (let ty = 0; ty < gy; ty++) for (let tx = 0; tx < gx; tx++) {
    const st = robustStats(tileValues(luma, w, h, T, tx, ty));
    levels[ty * gx + tx] = st.median;
    sigmaRaw[ty * gx + tx] = st.sigma;
  }
  const bg = interpolateTiles(levels, gx, gy, w, h, T);
  const resid = new Float32Array(w * h);
  for (let i = 0; i < resid.length; i++) resid[i] = luma[i] - bg[i];
  const s = smooth3(resid, w, h);

  // ならした後のノイズはタイルごとに実測する(JPEG のノイズは白色ではないので理論値に頼らない)
  const sig = new Float32Array(gx * gy);
  for (let ty = 0; ty < gy; ty++) for (let tx = 0; tx < gx; tx++) {
    sig[ty * gx + tx] = Math.max(o.minSigma, robustStats(tileValues(s, w, h, T, tx, ty)).sigma);
  }
  const sigAt = (x, y) => sig[Math.floor(y / T) * gx + Math.floor(x / T)];

  const maxStarArea = o.maxStarArea || Math.max(400, Math.round(w * h * 2e-4));
  const visited = new Uint8Array(w * h);
  const stars = [];
  const blobs = [];
  const stack = new Int32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (visited[i]) continue;
      const v = s[i];
      const sg = sigAt(x, y);
      if (v < o.kSeed * sg) continue;
      // 3×3 の極大だけを種にする
      if (v < s[i - 1] || v < s[i + 1] || v < s[i - w] || v < s[i + w] ||
          v < s[i - w - 1] || v < s[i - w + 1] || v < s[i + w - 1] || v < s[i + w + 1]) continue;

      const grow = o.kGrow * sg;
      let sp = 0;
      stack[sp++] = i;
      visited[i] = 1;
      let area = 0, sw = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, peak = 0, peaks = 0, rawMax = 0;
      const seedLevel = o.kSeed * sg;
      let bx0 = x, by0 = y, bx1 = x, by1 = y;
      while (sp) {
        const p = stack[--sp];
        const px = p % w, py = (p - px) / w;
        const val = s[p];
        const wt = Math.max(val, 0);
        area++;
        sw += wt; sx += wt * px; sy += wt * py;
        sxx += wt * px * px; syy += wt * py * py; sxy += wt * px * py;
        if (val > peak) peak = val;
        if (luma[p] > rawMax) rawMax = luma[p];
        // 重なった星を分ける: 領域の中の「種の明るさを超える極大」を 1 個ずつ数える
        if (val >= seedLevel && px > 0 && px < w - 1 && py > 0 && py < h - 1 &&
            val >= s[p - 1] && val >= s[p + 1] && val >= s[p - w] && val >= s[p + w] &&
            val >= s[p - w - 1] && val >= s[p - w + 1] && val >= s[p + w - 1] && val >= s[p + w + 1]) peaks++;
        if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
        if (py < by0) by0 = py; if (py > by1) by1 = py;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            if (nx < 0 || nx >= w) continue;
            const q = ny * w + nx;
            if (visited[q] || s[q] < grow) continue;
            visited[q] = 1;
            stack[sp++] = q;
          }
        }
      }
      const cx = sx / sw, cy = sy / sw;
      const vxx = sxx / sw - cx * cx, vyy = syy / sw - cy * cy, vxy = sxy / sw - cx * cy;
      const tr = vxx + vyy, det = vxx * vyy - vxy * vxy;
      const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const l1 = tr / 2 + disc, l2 = Math.max(tr / 2 - disc, 0.05);
      const elong = Math.sqrt(l1 / l2);
      const rec = { x: cx, y: cy, area, peaks: Math.max(1, peaks), flux: sw, peak, rawMax, elong, x0: bx0, y0: by0, x1: bx1, y1: by1 };
      // 線 = 細長くて幅が細い(短径の広がり 3px 未満)。地平線の縁の残りは太いので線にしない
      // 短い細長い塊は、暗い星が数珠つなぎになったもの。星として(極大の数だけ)数える
      if (area >= 8 && elong > o.maxElongation && 3.4 * Math.sqrt(l1) >= o.minTrailLength) {
        const th = 0.5 * Math.atan2(2 * vxy, vxx - vyy), half = 1.7 * Math.sqrt(l1);
        const ends = [[cx + half * Math.cos(th), cy + half * Math.sin(th)], [cx - half * Math.cos(th), cy - half * Math.sin(th)]]
          .map(([ex, ey]) => ({ x: Math.min(w - 1, Math.max(0, ex)), y: Math.min(h - 1, Math.max(0, ey)) }));
        blobs.push({ ...rec, ends, kind: Math.sqrt(l2) < 3 ? 'trail' : 'extended' });
      }
      // 大きくて白飛びしている塊 = 月・街灯。白飛びしていない大きな塊は、地平線の縁などで背景を引き切れなかった残り
      else if (area > maxStarArea) blobs.push({ ...rec, kind: rawMax >= 200 ? 'big' : 'extended' });
      else stars.push(rec);
    }
  }

  const tiles = [];
  for (let k = 0; k < gx * gy; k++) tiles.push({ level: levels[k], sigmaRaw: sigmaRaw[k], sigma: sig[k] });
  return { stars, blobs, tiles, gx, gy, T, w, h };
}

/**
 * どのタイルを「空」として数えるか決める。
 * 基準は画面の上 30% のタイル(空はふつう上にある)。
 * - 白飛び・明るい塊(月や街灯)のあるタイル → 除外
 * - ざらつきが基準の 3 倍超(建物・木の輪郭、雲の縁) → 除外
 * - 基準よりはっきり暗い(手前の山や木のシルエット) → 除外
 */
export function classifySky(det) {
  const { tiles, gx, gy, T } = det;
  const top = [];
  const topSig = [];
  const topSigRaw = [];
  const rows = Math.max(1, Math.round(gy * 0.3));
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < gx; tx++) {
    const t = tiles[ty * gx + tx];
    top.push(t.level); topSig.push(t.sigma); topSigRaw.push(t.sigmaRaw);
  }
  const refLevel = median(top);
  const refSigma = median(topSig);
  const refSigmaRaw = median(topSigRaw);
  const crushed = refLevel < 4; // 空が真っ黒につぶれていて、シルエットと見分けられない
  // 周辺減光(スマホは隅が 3 割ほど暗い)までは空として許す
  const lowCut = refLevel - Math.max(2.5 * refSigmaRaw, 0.35 * refLevel, 1.5);

  const reason = new Array(gx * gy).fill(null);
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k];
    if (t.level > 230) reason[k] = 'bright';
    else if (t.sigma > 3 * refSigma) reason[k] = 'rough';
    else if (!crushed && t.level < lowCut) reason[k] = 'dark';
  }
  // 明るい塊の外接矩形 + 1 タイルを除外
  for (const b of det.blobs) {
    if (b.kind !== 'big') continue;
    const tx0 = Math.max(0, Math.floor(b.x0 / T) - 1), tx1 = Math.min(gx - 1, Math.floor(b.x1 / T) + 1);
    const ty0 = Math.max(0, Math.floor(b.y0 / T) - 1), ty1 = Math.min(gy - 1, Math.floor(b.y1 / T) + 1);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) reason[ty * gx + tx] = 'object';
  }
  const valid = reason.map((r) => r === null);
  // 画素数ベースの有効割合(端のタイルは小さい)
  let validPx = 0;
  for (let ty = 0; ty < gy; ty++) for (let tx = 0; tx < gx; tx++) {
    if (!valid[ty * gx + tx]) continue;
    const tw = Math.min(T, det.w - tx * T), th = Math.min(T, det.h - ty * T);
    validPx += tw * th;
  }
  return { valid, reason, refLevel, refSigma, crushed, validFraction: validPx / (det.w * det.h) };
}

export function inSky(det, sky, p) {
  return sky.valid[Math.floor(p.y / det.T) * det.gx + Math.floor(p.x / det.T)];
}

/** 周りのタイルまで含めて空の中か */
function deepInSky(det, sky, p) {
  const tx = Math.floor(p.x / det.T), ty = Math.floor(p.y / det.T);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = tx + dx, y = ty + dy;
    if (x < 0 || y < 0 || x >= det.gx || y >= det.gy) continue;
    if (!sky.valid[y * det.gx + x]) return false;
  }
  return true;
}

/** 線が両端まで空の奥にあるか(地平線の縁に残る細い筋を「線」と呼ばないため) */
export function trailInSky(det, sky, b) {
  return [b, ...b.ends].every((p) => deepInSky(det, sky, p));
}

export function starsInSky(det, sky) {
  return det.stars.filter((st) => inSky(det, sky, st));
}

/** 重なりを分けた星の数 */
export function countStars(stars) {
  let n = 0;
  for (const st of stars) n += st.peaks;
  return n;
}
