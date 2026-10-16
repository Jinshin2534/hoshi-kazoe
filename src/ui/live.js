// 実験: ブラウザのカメラで動画のコマを重ねる。露光は伸ばせないので結果は下限。
import { toLuma, createStacker } from '../lib/image.js';

export const LIVE_FRAMES = 60;
const MAX_SIDE = 1280;

/** 露光をできるだけ長くする(Android の Chrome の一部だけが応じる) */
async function tryLongExposure(track) {
  const notes = [];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if (caps.exposureMode?.includes?.('manual') && caps.exposureTime?.max) {
    try {
      await track.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: caps.exposureTime.max }] });
      notes.push(`露光を手動の最大値(${(caps.exposureTime.max / 10).toFixed(0)}ms)にしました`);
    } catch {
      notes.push('露光の手動設定を断られました');
    }
  } else {
    notes.push('このブラウザ・カメラは露光時間を変えられません(自動のまま)');
  }
  if (caps.iso?.max) {
    try {
      await track.applyConstraints({ advanced: [{ iso: caps.iso.max }] });
      notes.push(`ISO を ${caps.iso.max} にしました`);
    } catch { /* 応じなければそのまま */ }
  }
  const s = track.getSettings ? track.getSettings() : {};
  if (s.exposureTime) notes.push(`実際の露光: ${(s.exposureTime / 10).toFixed(0)}ms/コマ`);
  if (s.frameRate) notes.push(`${Math.round(s.frameRate)} コマ/秒`);
  return notes;
}

export async function openCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  const notes = await tryLongExposure(stream.getVideoTracks()[0]);
  return { stream, notes };
}

export function closeCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** video から n コマ重ねて輝度を返す */
export function stackFromVideo(video, n, onProgress) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const f = Math.max(1, Math.max(vw, vh) / MAX_SIDE);
  const w = Math.round(vw / f), h = Math.round(vh / f);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const stacker = createStacker(w * h);
  return new Promise((resolve) => {
    const step = () => {
      ctx.drawImage(video, 0, 0, w, h);
      stacker.add(toLuma(ctx.getImageData(0, 0, w, h).data, w, h));
      onProgress?.(stacker.count / n);
      if (stacker.count >= n) resolve({ luma: stacker.result(), w, h, frames: stacker.count });
      else if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
      else setTimeout(step, 33);
    };
    step();
  });
}
