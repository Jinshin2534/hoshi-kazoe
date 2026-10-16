// 解析した画像に「数えた星」と「数えなかった場所」を重ねて描く
import { lumaToRgba } from '../lib/synth.js';
import { trailInSky } from '../lib/detect.js';

const REASON_COLOR = {
  bright: 'rgba(255,170,60,0.32)',
  rough: 'rgba(255,90,90,0.28)',
  dark: 'rgba(120,120,140,0.45)',
  object: 'rgba(255,220,80,0.35)',
};

/** 暗い星が見えるよう、空の明るさ基準で引き伸ばす */
function stretch(luma, refLevel, refSigma) {
  const lo = Math.max(0, refLevel - 2 * refSigma);
  const hi = refLevel + 40 * Math.max(refSigma, 0.5);
  const out = new Float32Array(luma.length);
  for (let i = 0; i < luma.length; i++) {
    const t = Math.min(1, Math.max(0, (luma[i] - lo) / (hi - lo)));
    out[i] = 255 * Math.sqrt(t);
  }
  return out;
}

export function drawResult(canvas, work, result, { enhance = true, marks = true } = {}) {
  const { w, h, luma } = work;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const shown = enhance ? stretch(luma, result.sky.refLevel, result.det.tiles.length ? result.sky.refSigma : 1) : luma;
  ctx.putImageData(new ImageData(lumaToRgba(shown, w, h), w, h), 0, 0);
  if (!marks) return;

  const { gx, T } = result.det;
  result.sky.reason.forEach((r, k) => {
    if (!r) return;
    ctx.fillStyle = REASON_COLOR[r];
    ctx.fillRect((k % gx) * T, Math.floor(k / gx) * T, T, T);
  });

  const lw = Math.max(1, Math.round(Math.max(w, h) / 900));
  ctx.lineWidth = lw;
  ctx.strokeStyle = 'rgba(110,240,170,0.9)';
  for (const st of result.stars) {
    ctx.beginPath();
    ctx.arc(st.x + 0.5, st.y + 0.5, 3 * lw + Math.sqrt(st.area) * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,120,120,0.9)';
  for (const b of result.det.blobs) {
    if (b.kind !== 'trail' || !trailInSky(result.det, result.sky, b)) continue;
    ctx.strokeRect(b.x0 - 2, b.y0 - 2, b.x1 - b.x0 + 4, b.y1 - b.y0 + 4);
  }
}

export const LEGEND = [
  ['star', '数えた星'],
  ['dark', '手前の物(山・木)'],
  ['rough', '輪郭・ざらつき'],
  ['object', '月・街灯の周り'],
  ['bright', '白飛び'],
];
export const LEGEND_COLOR = { star: 'rgba(110,240,170,0.9)', ...REASON_COLOR };
