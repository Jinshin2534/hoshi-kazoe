// 写真(輝度)から星を数え、空の暗さを推定するまでを一本にまとめる。
import { downscale } from './image.js';
import { detectStars, classifySky, starsInSky, countStars, trailInSky } from './detect.js';
import { fieldDeg2, estimateSky } from './astro.js';
import { formatExposure } from './exif.js';

// 4032px(12MP の長辺)を半分で解析できる大きさ。縮めすぎると細い星が背景に埋もれて浅くなる
export const WORK_MAX_SIDE = 2100;
export const DEFAULT_F35 = 26; // 近年のスマホのメインカメラ(広角)はおおむね 24〜26mm 相当
export const MIN_STARS = 3;
export const MIN_SKY_FRACTION = 0.1;

/**
 * @param {object} p
 * @param {Float32Array} p.luma  @param {number} p.w @param {number} p.h  元の解像度の輝度
 * @param {number} [p.f35]       35mm 換算焦点距離(なければ DEFAULT_F35 を仮定)
 * @param {number} [p.exposureTime] 秒(EXIF から。分からなければ undefined)
 * @param {'photo'|'live'|'demo'} [p.mode]
 */
export function analyze(p) {
  const mode = p.mode ?? 'photo';
  const f35Assumed = !(p.f35 > 0);
  const f35 = f35Assumed ? DEFAULT_F35 : p.f35;
  const work = downscale(p.luma, p.w, p.h, WORK_MAX_SIDE);
  const det = detectStars(work.luma, work.w, work.h);
  const sky = classifySky(det);
  const stars = starsInSky(det, sky);
  const count = countStars(stars);
  const fieldTotal = fieldDeg2(p.w, p.h, f35);
  const skyDeg2 = fieldTotal * sky.validFraction;

  const warnings = [];
  if (f35Assumed) warnings.push(`写真から焦点距離が読めなかったので、${DEFAULT_F35}mm 相当(スマホのメインカメラ)と仮定しました。超広角(13mm 前後)で撮ったなら直してください。`);
  if (mode === 'photo' && p.exposureTime > 0 && p.exposureTime < 0.25) {
    warnings.push(`露光が ${formatExposure(p.exposureTime)} と短いので、星が写りきらず「都会寄り」に出ます。ナイトモードで撮った写真でも、記録上の露光が短く出る機種があります。`);
  }
  if (sky.crushed) warnings.push('空が真っ黒につぶれていて、山や木のシルエットと空の区別がつきません。画面全体を空として数えています。');
  if (sky.refLevel > 180) warnings.push('空が明るく写りすぎています(露出オーバー)。暗い星が背景に埋もれています。');
  const big = det.blobs.filter((b) => b.kind === 'big').length;
  // 地平線の縁も細長い塊になるので、空の中にあるものだけを「線」と呼ぶ
  const trails = det.blobs.filter((b) => b.kind === 'trail' && trailInSky(det, sky, b)).length;
  if (big) warnings.push(`月や街灯のような明るい塊が ${big} 個あり、その周りは数えていません。`);
  if (trails) warnings.push(`線のように伸びたもの(飛行機・人工衛星・ぶれた星)${trails} 本は数えていません。`);
  if (sky.validFraction >= MIN_SKY_FRACTION && sky.validFraction < 0.5) {
    warnings.push(`空として数えたのは画面の ${Math.round(sky.validFraction * 100)}% だけです。`);
  }
  warnings.push('雲やもやがあると星が減り、実際より明るい空と出ます。');

  const base = {
    mode, f35, f35Assumed, exposureTime: p.exposureTime,
    det, sky, stars, count, scale: work.factor, work: { luma: work.luma, w: work.w, h: work.h },
    fieldTotal, skyDeg2, warnings,
  };

  if (sky.validFraction < MIN_SKY_FRACTION) {
    return { ...base, status: 'no-sky', reason: '空として使える部分が画面の 1 割に届きません(建物・木・月・明るすぎる空)。空を大きく入れて撮り直してください。' };
  }
  if (count < MIN_STARS) {
    return {
      ...base, status: 'too-few',
      reason: `星が ${count} 個しか見つかりませんでした。都会の明るい空なのか、雲なのか、露光が足りないのか、写真からは区別できないので、暗さは言えません。`,
    };
  }
  const est = estimateSky(count, skyDeg2);
  return { ...base, status: 'ok', lowConfidence: count < 10, est };
}
