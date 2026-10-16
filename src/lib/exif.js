// JPEG の EXIF から、空の広さと露光の判断に要る項目だけを読む。
const TAGS = {
  0x010f: 'make', 0x0110: 'model', 0x8769: 'exifPointer',
  0x829a: 'exposureTime', 0x829d: 'fNumber', 0x8827: 'iso',
  0x920a: 'focalLength', 0xa405: 'focal35',
};

function readIfd(view, tiffStart, offset, le, out) {
  if (tiffStart + offset + 2 > view.byteLength) return;
  const n = view.getUint16(tiffStart + offset, le);
  for (let k = 0; k < n; k++) {
    const e = tiffStart + offset + 2 + k * 12;
    if (e + 12 > view.byteLength) return;
    const tag = view.getUint16(e, le);
    const name = TAGS[tag];
    if (!name) continue;
    const type = view.getUint16(e + 2, le);
    const count = view.getUint32(e + 4, le);
    const valOff = e + 8;
    try {
      if (type === 3) out[name] = view.getUint16(valOff, le);              // SHORT
      else if (type === 4) out[name] = view.getUint32(valOff, le);         // LONG
      else if (type === 5) {                                                // RATIONAL
        const p = tiffStart + view.getUint32(valOff, le);
        const den = view.getUint32(p + 4, le);
        out[name] = den ? view.getUint32(p, le) / den : null;
      } else if (type === 2) {                                              // ASCII
        const p = count <= 4 ? valOff : tiffStart + view.getUint32(valOff, le);
        let s = '';
        for (let i = 0; i < count; i++) {
          const c = view.getUint8(p + i);
          if (!c) break;
          s += String.fromCharCode(c);
        }
        out[name] = s.trim();
      }
    } catch {
      // 壊れたタグは読み飛ばす
    }
  }
}

/** @param {ArrayBuffer} buf  @returns {object} 見つからない項目は undefined */
export function parseExif(buf) {
  const out = {};
  try {
    readJpeg(new DataView(buf), out);
  } catch {
    // 途中で切れた・壊れたファイルは、読めたところまでを返す
  }
  return out;
}

function readJpeg(view, out) {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return;
  let p = 2;
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) break;
    const marker = view.getUint8(p + 1);
    if (marker === 0xda || marker === 0xd9) break; // 画像データ開始/終了
    const len = view.getUint16(p + 2);
    if (marker === 0xe1 && p + 10 <= view.byteLength &&
        view.getUint32(p + 4) === 0x45786966 && view.getUint16(p + 8) === 0) { // 'Exif\0\0'
      const tiff = p + 10;
      const le = view.getUint16(tiff) === 0x4949;
      const ifd0 = view.getUint32(tiff + 4, le);
      readIfd(view, tiff, ifd0, le, out);
      if (out.exifPointer) readIfd(view, tiff, out.exifPointer, le, out);
      delete out.exifPointer;
      return;
    }
    p += 2 + len;
  }
}

/** 1/250 秒 のような表記 */
export function formatExposure(t) {
  if (!(t > 0)) return '不明';
  if (t >= 1) return `${+t.toFixed(1)} 秒`;
  return `1/${Math.round(1 / t)} 秒`;
}
