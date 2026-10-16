import './style.css';
import { h } from './ui/dom.js';
import { analyze, DEFAULT_F35 } from './lib/analyze.js';
import { toLuma } from './lib/image.js';
import { makeSky } from './lib/synth.js';
import { parseExif, formatExposure } from './lib/exif.js';
import { BORTLE, diagonalFovDeg, estimateSky, typicalNelm } from './lib/astro.js';
import { detectStars } from './lib/detect.js';
import { drawResult, LEGEND, LEGEND_COLOR } from './ui/overlay.js';
import { openCamera, closeCamera, stackFromVideo, LIVE_FRAMES } from './ui/live.js';

const root = document.getElementById('app');
const LOAD_MAX_SIDE = 4200; // iOS のキャンバス上限(約 16.7M 画素)に収める
const view = { enhance: true, marks: true };
let current = null; // { mode, luma, w, h, f35, exposureTime, exif, label }
let liveStream = null;

const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const num = (x) => Math.round(x).toLocaleString('ja-JP');
const nextFrame = () => new Promise((r) => setTimeout(r, 30));

function show(...els) {
  root.replaceChildren(header(), ...els, footer());
  window.scrollTo(0, 0);
}

function header() {
  return h('header', { class: 'top' },
    h('h1', { onClick: home }, '星かぞえ'),
    h('p', { class: 'tag' }, '夜空の写真に写った星を数えて、空の暗さ(ボートルスケール)を言います。'));
}

function footer() {
  return h('footer', {},
    h('p', {}, '写真はこの端末の中だけで解析します。どこにも送りません。'),
    h('p', {}, h('a', { href: 'https://github.com/Jinshin2534/hoshi-kazoe', target: '_blank', rel: 'noopener' }, 'GitHub')));
}

// ---------------- はじめの画面 ----------------

function home() {
  if (liveStream) { closeCamera(liveStream); liveStream = null; }
  const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden', onChange: (e) => e.target.files[0] && loadFile(e.target.files[0]) });
  const sel = h('select', { 'aria-label': 'サンプルの空' },
    BORTLE.map((b) => h('option', { value: b.cls, selected: b.cls === 4 }, `ボートル ${b.cls}`)));
  show(h('main', { class: 'screen' },
    h('section', { class: 'card actions' },
      h('label', { class: 'btn primary' }, file, '夜空の写真を読み込む'),
      h('p', { class: 'hint' }, 'スマホの「ナイトモード」「天体写真モード」で、空を大きく入れて撮った写真を選んでください。'),
      h('div', { class: 'row' },
        sel,
        h('button', { class: 'btn', type: 'button', onClick: () => runDemo(+sel.value) }, 'サンプルで試す')),
      h('button', { class: 'btn ghost', type: 'button', onClick: liveScreen }, 'カメラで試す(実験・下限しか言えません)')),
    honesty(),
    tips()));
}

function honesty() {
  return h('section', { class: 'card note' },
    h('h2', {}, 'カメラで直接撮らずに、写真を読み込むわけ'),
    h('p', {}, 'ブラウザがカメラから受け取れるのは「動画」です。1コマの露光は長くても 1/10 秒前後で、iPhone の Safari には露光を変える手段がそもそもありません。肉眼で見える暗い星(6等星)を写すには、数秒の露光がいります。'),
    h('p', {}, 'コマを何十枚重ねてもノイズが減るだけで、動画のノイズ除去で消えた星は戻りません。暗い空でも、写るのは明るい星が少しだけだと見込んでいます(本物の夜空での確認はまだです)。'),
    h('p', {}, 'そこで、スマホのカメラアプリの夜景・天体モード(数秒〜数十秒の露光)で撮った写真を読み込む方式にしました。カメラで試すこともできますが、その結果は「少なくともこのくらいは暗い」という下限です。'));
}

function tips() {
  return h('section', { class: 'card' },
    h('h2', {}, '撮り方'),
    h('ul', { class: 'list' },
      h('li', {}, 'ナイトモード/天体モードで、スマホを地面や三脚に置いて 3 秒以上'),
      h('li', {}, 'ズームしない(1倍)。超広角で撮ったら、あとで焦点距離を直す'),
      h('li', {}, '空を画面の半分以上。月と街灯は入れない'),
      h('li', {}, '雲がない夜に。雲があると星が減って「都会」と出ます')));
}

// ---------------- 入力 ----------------

async function loadFile(file) {
  show(busy('写真を読んでいます…'));
  await nextFrame();
  try {
    const exif = parseExif(await file.arrayBuffer());
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error('この画像形式はこのブラウザで開けませんでした(HEIC など)。JPEG で保存し直すか、別のブラウザで試してください。');
    }
    const f = Math.max(1, Math.max(bmp.width, bmp.height) / LOAD_MAX_SIDE);
    const w = Math.round(bmp.width / f), hh = Math.round(bmp.height / f);
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, hh);
    const luma = toLuma(ctx.getImageData(0, 0, w, hh).data, w, hh);
    current = { mode: 'photo', luma, w, h: hh, f35: exif.focal35 || null, exposureTime: exif.exposureTime, exif, label: file.name };
    await runCurrent();
  } catch (e) {
    console.error(e);
    show(errorCard(e.message || '写真を読めませんでした。'));
  }
}

async function runDemo(bortle) {
  show(busy('合成の夜空を作っています…'));
  await nextFrame();
  const s = makeSky({ bortle, seed: 7 + bortle, horizon: true });
  current = { mode: 'demo', luma: s.luma, w: s.w, h: s.h, f35: 26, exposureTime: undefined, exif: {}, label: `合成サンプル: ボートル ${bortle} の空`, truth: s.truth };
  await runCurrent();
}

async function runCurrent() {
  show(busy('星を数えています…'));
  await nextFrame();
  const r = analyze({ luma: current.luma, w: current.w, h: current.h, f35: current.f35, exposureTime: current.exposureTime, mode: current.mode });
  window.__app.lastResult = r;
  show(resultScreen(r));
}

// ---------------- ライブ(実験) ----------------

async function liveScreen() {
  const video = h('video', { playsinline: true, muted: true, class: 'live' });
  const status = h('p', { class: 'hint' }, 'カメラを起動しています…');
  const bar = h('div', { class: 'bar' }, h('span'));
  const go = h('button', { class: 'btn primary', type: 'button', disabled: true }, `${LIVE_FRAMES} コマ重ねて数える`);
  show(h('main', { class: 'screen' },
    h('section', { class: 'card' },
      h('h2', {}, 'カメラで試す(実験)'),
      h('p', { class: 'hint' }, 'スマホを空に向けて動かないように置き、ボタンを押してください。露光を伸ばせないので、ここで出る結果は「少なくともこのくらい暗い」という下限です。'),
      video, bar, status, go,
      h('button', { class: 'btn ghost', type: 'button', onClick: home }, 'やめる'))));
  let notes = [];
  try {
    const cam = await openCamera(video);
    liveStream = cam.stream;
    notes = cam.notes;
    status.textContent = notes.join(' / ');
    go.disabled = false;
  } catch (e) {
    status.textContent = `カメラを開けませんでした(${e.name || e.message})。写真の読み込みを使ってください。`;
    return;
  }
  go.addEventListener('click', async () => {
    go.disabled = true;
    const st = await stackFromVideo(video, LIVE_FRAMES, (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; });
    closeCamera(liveStream); liveStream = null;
    current = { mode: 'live', luma: st.luma, w: st.w, h: st.h, f35: null, exposureTime: undefined, exif: {}, label: `カメラ ${st.frames} コマを重ねたもの`, notes };
    await runCurrent();
  });
}

// ---------------- 結果 ----------------

function busy(text) {
  return h('main', { class: 'screen' }, h('section', { class: 'card busy' }, h('div', { class: 'spinner' }), h('p', {}, text)));
}

function errorCard(msg) {
  return h('main', { class: 'screen' }, h('section', { class: 'card' },
    h('p', { class: 'error' }, msg),
    h('button', { class: 'btn', type: 'button', onClick: home }, 'もどる')));
}

function resultScreen(r) {
  const canvas = h('canvas', { class: 'shot', 'aria-label': '解析した写真。緑の丸が数えた星' });
  const redraw = () => drawResult(canvas, r.work, r, view);
  redraw();
  const toggles = h('div', { class: 'row small' },
    h('label', {}, h('input', { type: 'checkbox', checked: view.enhance, onChange: (e) => { view.enhance = e.target.checked; redraw(); } }), ' 暗い星を見やすく'),
    h('label', {}, h('input', { type: 'checkbox', checked: view.marks, onChange: (e) => { view.marks = e.target.checked; redraw(); } }), ' 印を表示'));
  const legend = h('ul', { class: 'legend' }, LEGEND.map(([k, t]) => h('li', {}, h('i', { style: `background:${LEGEND_COLOR[k]}` }), t)));

  return h('main', { class: 'screen' },
    h('p', { class: 'source' }, current.label),
    summary(r),
    h('section', { class: 'card' }, canvas, toggles, legend),
    focalCard(r),
    r.status === 'ok' ? numbersCard(r) : null,
    warningsCard(r),
    r.status === 'ok' ? ladder(r) : null,
    methodCard(),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onClick: home }, '別の写真で')));
}

function summary(r) {
  if (r.status !== 'ok') {
    return h('section', { class: 'card verdict none' },
      h('p', { class: 'big' }, '測れません'),
      h('p', {}, r.reason),
      h('p', { class: 'hint' }, `見つけた星 ${r.count} 個 / 空として使えたのは画面の ${Math.round(r.sky.validFraction * 100)}%`));
  }
  const e = r.est;
  const b = BORTLE[e.bortle - 1];
  const live = r.mode === 'live';
  const [lo, hi] = e.bortleRange;
  return h('section', { class: `card verdict b${e.bortle}` },
    h('p', { class: 'label' }, live ? 'この空は少なくとも' : 'この空は'),
    h('p', { class: 'big' }, `ボートル ${e.bortle}`, live ? h('small', {}, ' より暗い') : null),
    h('p', { class: 'name' }, b.name),
    h('p', { class: 'range' }, live
      ? '露光を伸ばせないカメラなので、本当の空はこれより暗い可能性が高いです。'
      : (lo === hi ? `誤差を入れてもボートル ${lo}` : `誤差を入れると ボートル ${lo}〜${hi} のどこか`)),
    r.lowConfidence ? h('p', { class: 'warn' }, `星が ${r.count} 個しかないので、かなり粗い推定です。`) : null,
    current.truth ? h('p', { class: 'hint' }, `(この合成サンプルの正解はボートル ${current.truth.bortle})`) : null);
}

function numbersCard(r) {
  const e = r.est;
  const rows = [
    ['数えた星', `${num(r.count)} 個`],
    ['写っている空の広さ', `${num(r.skyDeg2)} 平方度(画面の ${Math.round(r.sky.validFraction * 100)}%)`],
    ['全天に直すと', `約 ${num(e.allSky)} 個`],
    ['写真に写る限界', `${fmt(e.mPhoto)} 等星`],
    ['肉眼で見える限界(推定)', `${fmt(e.nelm)} 等星(${fmt(e.nelmRange[0])}〜${fmt(e.nelmRange[1])})`],
    ['空の明るさ(推定)', `${fmt(e.sqm)} 等/平方秒角(${fmt(e.sqmRange[0])}〜${fmt(e.sqmRange[1])})`],
  ];
  return h('section', { class: 'card' },
    h('h2', {}, '根拠'),
    h('dl', { class: 'nums' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('p', { class: 'hint' }, `誤差 ±${fmt(e.sigma, 2)} 等の内訳: 数えた個数のゆらぎ・カメラの写る深さの違い(±0.7 等)・天の川の近くかどうか(±0.35 等)。`));
}

function focalCard(r) {
  const input = h('input', { type: 'number', min: 10, max: 300, step: 1, value: r.f35, inputmode: 'numeric' });
  const apply = (v) => {
    const f = +v;
    if (!(f >= 10 && f <= 300)) return;
    current.f35 = f;
    runCurrent();
  };
  input.addEventListener('change', () => apply(input.value));
  const ex = current.exif || {};
  const src = r.f35Assumed ? `仮定(写真に記録がない)` : current.mode === 'photo' && ex.focal35 === r.f35 ? '写真の記録から' : '指定';
  return h('section', { class: 'card' },
    h('h2', {}, '写した範囲'),
    h('div', { class: 'row' },
      h('label', { class: 'focal' }, '35mm 換算 ', input, ' mm'),
      [13, 26, 77].map((f) => h('button', { class: `chip${r.f35 === f ? ' on' : ''}`, type: 'button', onClick: () => apply(f) },
        { 13: '超広角 13', 26: 'メイン 26', 77: '望遠 77' }[f]))),
    h('p', { class: 'hint' }, `${src}。対角 ${fmt(diagonalFovDeg(r.f35), 0)}° の範囲。空の広さで星の数を割るので、ここがずれると結果がずれます。`),
    current.mode === 'photo' ? h('p', { class: 'hint' },
      [ex.make, ex.model].filter(Boolean).join(' ') || '機種不明',
      ` / 露光 ${formatExposure(ex.exposureTime)}`,
      ex.iso ? ` / ISO ${ex.iso}` : '') : null,
    current.mode === 'live' && current.notes?.length ? h('p', { class: 'hint' }, current.notes.join(' / ')) : null);
}

function warningsCard(r) {
  return h('section', { class: 'card' },
    h('h2', {}, '注意'),
    h('ul', { class: 'list warnlist' }, r.warnings.map((w) => h('li', {}, w))));
}

function ladder(r) {
  const [lo, hi] = r.est.bortleRange;
  return h('section', { class: 'card' },
    h('h2', {}, 'ボートルスケール'),
    h('ol', { class: 'ladder' }, BORTLE.map((b) => h('li', {
      class: [b.cls === r.est.bortle ? 'hit' : '', b.cls >= lo && b.cls <= hi ? 'inrange' : ''].join(' '),
    }, h('b', {}, b.cls), h('span', {}, b.name), h('small', {}, b.note)))));
}

function methodCard() {
  return h('details', { class: 'card method' },
    h('summary', {}, 'どう計算しているか'),
    h('ol', { class: 'list' },
      h('li', {}, '写真を白黒にし、32px ごとに背景の明るさとノイズを測って背景を引く'),
      h('li', {}, '周りのノイズの 5 倍より明るい点を星として数える(線状のものと、白飛びした大きな塊は除く)'),
      h('li', {}, '画面の上側を空の基準にして、手前の山・木、輪郭、月の周りのマスは数えない'),
      h('li', {}, '焦点距離から写っている空の広さ(平方度)を出し、全天なら何個かに直す'),
      h('li', {}, '全天の星の数の表(1 等暗くなるごとに約 3 倍)から、写真に写る限界の等級を出す'),
      h('li', {}, '「スマホの夜景モードは肉眼より 0.5 等深く写る」と仮定して肉眼の限界等級にし、ボートルの表に当てる')),
    h('p', { class: 'hint' }, 'いちばん大きな仮定は 6 番目です。カメラや露光時間でこの差は ±1 等くらい変わるので、結果に幅をつけています。空の明るさを直接測っているわけではありません。'));
}

// ヘッドレス検証用
window.__app = {
  analyze, makeSky, detectStars, estimateSky, parseExif, typicalNelm, DEFAULT_F35,
  runDemo, loadFile, home, get current() { return current; }, lastResult: null,
};

home();
