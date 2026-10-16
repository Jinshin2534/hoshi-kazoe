// 星の数 → 限界等級 → 肉眼の限界等級(NELM) → ボートルスケール / 空の明るさ(SQM)

export const SKY_DEG2 = 41253; // 全天の平方度

// 全天で「この等級より明るい星」のおおよその数(ヒッパルコス等の集計を丸めた値)。
// 1 等級暗くなるごとにおよそ 3 倍に増える。
export const CUMULATIVE_STARS = [
  [-1, 2], [0, 4], [1, 15], [2, 48], [3, 171], [4, 513], [5, 1602],
  [6, 4800], [7, 14000], [8, 41000], [9, 117000], [10, 324000],
];

/** 全天で等級 m より明るい星の数(対数で線形補間、範囲外は端の傾きで外挿) */
export function starsBrighterThan(m) {
  const t = CUMULATIVE_STARS;
  let i = 0;
  if (m <= t[0][0]) i = 0;
  else if (m >= t[t.length - 1][0]) i = t.length - 2;
  else while (t[i + 1][0] < m) i++;
  const [m0, n0] = t[i], [m1, n1] = t[i + 1];
  const a = (m - m0) / (m1 - m0);
  return 10 ** (Math.log10(n0) + a * (Math.log10(n1) - Math.log10(n0)));
}

/** starsBrighterThan の逆関数 */
export function magnitudeForCount(n) {
  if (!(n > 0)) return -Infinity;
  const t = CUMULATIVE_STARS;
  const ln = Math.log10(n);
  let i = 0;
  if (ln <= Math.log10(t[0][1])) i = 0;
  else if (ln >= Math.log10(t[t.length - 1][1])) i = t.length - 2;
  else while (Math.log10(t[i + 1][1]) < ln) i++;
  const [m0, n0] = t[i], [m1, n1] = t[i + 1];
  const a = (ln - Math.log10(n0)) / (Math.log10(n1) - Math.log10(n0));
  return m0 + a * (m1 - m0);
}

/**
 * 写真が写している空の広さ(平方度)。35mm 換算焦点距離は対角 43.27mm 基準。
 * 透視投影の長方形の立体角 Ω = 4·asin(sin a · sin b)。
 */
export function fieldDeg2(w, h, f35) {
  if (!(f35 > 0)) throw new Error('焦点距離が不正です');
  const fpx = Math.hypot(w, h) * f35 / 43.27;
  const a = Math.atan(w / 2 / fpx), b = Math.atan(h / 2 / fpx);
  const sr = 4 * Math.asin(Math.sin(a) * Math.sin(b));
  return sr * (180 / Math.PI) ** 2;
}

/** 対角画角(度) */
export function diagonalFovDeg(f35) {
  return 2 * Math.atan(43.27 / 2 / f35) * 180 / Math.PI;
}

// ボートルスケールと肉眼の限界等級(NELM)の対応(Bortle 2001 の表を 0.5 等刻みに丸めたもの)
export const BORTLE = [
  { cls: 1, minNelm: 7.6, name: '最上級の暗い空', note: '天の川が影を落とすほど。黄道光がはっきり' },
  { cls: 2, minNelm: 7.1, name: '真に暗い空', note: '天の川に細かな構造が見える' },
  { cls: 3, minNelm: 6.6, name: '田舎の空', note: '地平線近くに街明かりが少し' },
  { cls: 4, minNelm: 6.1, name: '田舎と郊外の境', note: '天の川は見えるが細部は消える' },
  { cls: 5, minNelm: 5.6, name: '郊外の空', note: '天の川は天頂付近でかすかに' },
  { cls: 6, minNelm: 5.1, name: '明るい郊外', note: '天の川はほぼ見えない' },
  { cls: 7, minNelm: 4.6, name: '郊外と都会の境', note: '空全体が灰色がかる' },
  { cls: 8, minNelm: 4.1, name: '都会の空', note: '有名な星座の形がやっと分かる' },
  { cls: 9, minNelm: -Infinity, name: '都心の空', note: '見える星は数えるほど' },
];

export function bortleFromNelm(nelm) {
  return BORTLE.find((b) => nelm >= b.minNelm).cls;
}

/** 各クラスの代表的な NELM(合成データ用) */
export function typicalNelm(cls) {
  if (cls <= 1) return 7.8;
  if (cls >= 9) return 3.6;
  return BORTLE[cls - 1].minNelm + 0.25;
}

/**
 * NELM ↔ 空の明るさ(SQM, 等級/平方秒角)。
 * NELM = 7.93 − 5·log10(10^(4.316 − SQM/5) + 1)(Schaefer の式をまとめた近似)
 */
export function nelmFromSqm(sqm) {
  return 7.93 - 5 * Math.log10(10 ** (4.316 - sqm / 5) + 1);
}
export function sqmFromNelm(nelm) {
  const n = Math.min(nelm, 7.85);
  return 5 * (4.316 - Math.log10(10 ** ((7.93 - n) / 5) - 1));
}

// 仮定: スマホの夜景/天体モード(数秒の露光)は、肉眼より約 0.5 等深くまで写る。
// 機種・露光で ±0.7 等くらいは平気でずれるので、それを誤差に入れる。
export const CAMERA_OFFSET = 0.5;
export const CAMERA_OFFSET_SIGMA = 0.7;
// 天の川の近くと銀河の極では星の密度が 3 倍ほど違う → 等級で ±0.35 程度
export const GALACTIC_SIGMA = 0.35;

/** 星の数のポアソン誤差を等級に直したもの(1 等で約 3 倍 → d log10N/dm ≈ 0.48) */
export function countSigmaMag(n) {
  return 0.905 / Math.sqrt(Math.max(n, 1));
}

/**
 * 数えた星から空の暗さを推定する。
 * @param {number} count 空の部分で見つけた星の数
 * @param {number} skyDeg2 その空の広さ(平方度)
 * @param {object} [o] { offset, offsetSigma }
 */
export function estimateSky(count, skyDeg2, o = {}) {
  const offset = o.offset ?? CAMERA_OFFSET;
  const offsetSigma = o.offsetSigma ?? CAMERA_OFFSET_SIGMA;
  const density = count / skyDeg2;
  const allSky = density * SKY_DEG2;
  const mPhoto = magnitudeForCount(allSky);
  const nelm = mPhoto - offset;
  const sigma = Math.hypot(countSigmaMag(count), offsetSigma, GALACTIC_SIGMA);
  const bortle = bortleFromNelm(nelm);
  return {
    count, skyDeg2, density, allSky, mPhoto, nelm, sigma,
    nelmRange: [nelm - sigma, nelm + sigma],
    bortle,
    // NELM が大きい(暗い空)ほどクラスは小さい
    bortleRange: [bortleFromNelm(nelm + sigma), bortleFromNelm(nelm - sigma)],
    sqm: sqmFromNelm(nelm),
    sqmRange: [sqmFromNelm(nelm - sigma), sqmFromNelm(nelm + sigma)],
  };
}
