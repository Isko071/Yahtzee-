// Строит таблицу оптимальной стратегии «Ятзи» (максимум среднего счёта) и пишет её в optimal.js.
// Запуск: node tools/build-optimal.js   (около минуты, нужен Node.js 18+)
//
// Состояние партии: (заполненные клетки, сумма верхней секции с потолком 63, стоит ли в «Ятзи» 50).
// V(состояние) — средний счёт, который игрок добавит до конца партии, играя идеально
// (бонусы 35 и 100 учтены). Для состояния считается один ход целиком: бросок, два добороса
// с лучшим выбором кубиков и запись в лучшую клетку (с жокером), затем V следующего состояния.
const fs = require('node:fs');
const path = require('node:path');

const FULL = (1 << 13) - 1;
const YAHTZEE_BIT = 1 << 11;
const NUM_CATS = 13;
const FIXED = { 8: 25, 9: 30, 10: 40 };

// ---- Кубики: 252 набора из пяти, 462 набора «что оставить» ----
const fact = [1, 1, 2, 6, 24, 120];
function multisets(size) {
  const out = [];
  (function walk(prefix, min) {
    if (prefix.length === size) { out.push(prefix.slice()); return; }
    for (let v = min; v <= 6; v++) { prefix.push(v); walk(prefix, v); prefix.pop(); }
  })([], 1);
  return out;
}
const diceList = multisets(5);
const diceIndex = new Map(diceList.map((d, i) => [d.join(''), i]));
const holdList = [];
for (let m = 0; m <= 5; m++) multisets(m).forEach((h) => holdList.push(h));
const holdIndex = new Map(holdList.map((h, i) => [h.join(''), i]));

// Переходы: оставили hold, добросили остальные -> какой набор из пяти и с какой вероятностью
const transStart = new Int32Array(holdList.length + 1);
const transDice = [];
const transP = [];
holdList.forEach((h, hi) => {
  transStart[hi] = transDice.length;
  const k = 5 - h.length;
  multisets(k).forEach((o) => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    o.forEach((v) => counts[v]++);
    let ways = fact[k];
    for (let f = 1; f <= 6; f++) ways /= fact[counts[f]];
    const d = h.concat(o).sort((a, b) => a - b);
    transDice.push(diceIndex.get(d.join('')));
    transP.push(ways / Math.pow(6, k));
  });
});
transStart[holdList.length] = transDice.length;
const TD = Int32Array.from(transDice);
const TP = Float64Array.from(transP);
const EMPTY_HOLD = holdIndex.get('');

// Для каждого набора кубиков: какие наборы можно оставить (без «оставить всё»)
const subStart = new Int32Array(diceList.length + 1);
const subList = [];
diceList.forEach((d, di) => {
  subStart[di] = subList.length;
  const seen = new Set();
  for (let mask = 0; mask < 31; mask++) {
    const h = d.filter((_, i) => mask & (1 << i)).join('');
    if (!seen.has(h)) { seen.add(h); subList.push(holdIndex.get(h)); }
  }
});
subStart[diceList.length] = subList.length;
const SUB = Int32Array.from(subList);

// Очки по кубикам
const raw = new Int16Array(diceList.length * NUM_CATS);
const diceSum = new Int16Array(diceList.length);
const diceFace = new Int8Array(diceList.length); // грань, если ятзи, иначе 0
diceList.forEach((d, di) => {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  d.forEach((v) => counts[v]++);
  const sum = d.reduce((a, b) => a + b, 0), max = Math.max(...counts);
  const run = (len) => { for (let s = 1; s + len - 1 <= 6; s++) { let ok = true; for (let f = s; f < s + len; f++) if (!counts[f]) ok = false; if (ok) return true; } return false; };
  for (let f = 1; f <= 6; f++) raw[di * NUM_CATS + f - 1] = counts[f] * f;
  raw[di * NUM_CATS + 6] = max >= 3 ? sum : 0;
  raw[di * NUM_CATS + 7] = max >= 4 ? sum : 0;
  raw[di * NUM_CATS + 8] = counts.includes(3) && counts.includes(2) ? 25 : 0;
  raw[di * NUM_CATS + 9] = run(4) ? 30 : 0;
  raw[di * NUM_CATS + 10] = run(5) ? 40 : 0;
  raw[di * NUM_CATS + 11] = max === 5 ? 50 : 0;
  raw[di * NUM_CATS + 12] = sum;
  diceSum[di] = sum;
  diceFace[di] = max === 5 ? d[0] : 0;
});

// ---- Достижимые состояния ----
const reach = new Array(FULL + 1);
for (let m = 0; m <= FULL; m++) reach[m] = new Uint8Array(128); // индекс u*2+yf
reach[0][0] = 1;
for (let m = 0; m < FULL; m++) {
  for (let s = 0; s < 128; s++) {
    if (!reach[m][s]) continue;
    const u = s >> 1, yf = s & 1;
    for (let c = 0; c < NUM_CATS; c++) {
      if (m & (1 << c)) continue;
      const nm = m | (1 << c);
      if (c < 6) {
        for (let k = 0; k <= 5; k++) reach[nm][(Math.min(63, u + (c + 1) * k)) * 2 + yf] = 1;
      } else if (c === 11) {
        reach[nm][u * 2] = 1; reach[nm][u * 2 + 1] = 1;
      } else reach[nm][s] = 1;
    }
  }
}
let reachable = 0;
for (let m = 0; m <= FULL; m++) for (let s = 0; s < 128; s++) if (reach[m][s]) reachable++;
console.log('достижимых состояний:', reachable);

// ---- Расчёт ----
const V = new Float64Array((FULL + 1) * 128); // индекс m*128 + u*2 + yf
const nd = diceList.length, nh = holdList.length;
const stop = new Float64Array(nd), A2 = new Float64Array(nd), A1 = new Float64Array(nd);
const E = new Float64Array(nh);
const t0 = Date.now();

function stopValues(m, u, yf) {
  const jokerOn = (m & YAHTZEE_BIT) !== 0;
  for (let di = 0; di < nd; di++) {
    const face = diceFace[di];
    const isY = face !== 0;
    const joker = isY && jokerOn;
    const bonus100 = isY && yf ? 100 : 0;
    let best = -1e9;
    const base = di * NUM_CATS;
    // разрешённые клетки по жокеру
    let lo = 0, hi = NUM_CATS - 1, only = -1;
    if (joker) {
      if (!(m & (1 << (face - 1)))) only = face - 1;
      else {
        let anyLower = false;
        for (let c = 6; c < NUM_CATS; c++) if (!(m & (1 << c))) anyLower = true;
        if (anyLower) lo = 6;
      }
    }
    if (only >= 0) { lo = only; hi = only; }
    for (let c = lo; c <= hi; c++) {
      if (m & (1 << c)) continue;
      let pts = raw[base + c];
      if (joker && c >= 8 && c <= 10) pts = FIXED[c];
      let nu = u, nyf = yf, extra = bonus100;
      if (c < 6) {
        nu = u + pts;
        if (u < 63 && nu >= 63) extra += 35;
        if (nu > 63) nu = 63;
      } else if (c === 11) nyf = pts === 50 ? 1 : 0;
      const nm = m | (1 << c);
      const v = pts + extra + (nm === FULL ? 0 : V[nm * 128 + nu * 2 + nyf]);
      if (v > best) best = v;
    }
    stop[di] = best;
  }
}

function rerollLayer(src, dst) { // dst[d] = max(stop[d], max E[h]) с E[h] = Σ p·src[d']
  for (let h = 0; h < nh; h++) {
    let s = 0;
    for (let i = transStart[h]; i < transStart[h + 1]; i++) s += TP[i] * src[TD[i]];
    E[h] = s;
  }
  for (let di = 0; di < nd; di++) {
    let best = stop[di];
    for (let i = subStart[di]; i < subStart[di + 1]; i++) { const e = E[SUB[i]]; if (e > best) best = e; }
    dst[di] = best;
  }
}

let done = 0;
for (let m = FULL - 1; m >= 0; m--) {
  for (let s = 0; s < 128; s++) {
    if (!reach[m][s]) continue;
    const u = s >> 1, yf = s & 1;
    stopValues(m, u, yf);
    rerollLayer(stop, A2);
    rerollLayer(A2, A1);
    let total = 0;
    for (let i = transStart[EMPTY_HOLD]; i < transStart[EMPTY_HOLD + 1]; i++) total += TP[i] * A1[TD[i]];
    V[m * 128 + s] = total;
    done++;
  }
  if (m % 512 === 0) console.log('маска', m, 'готово', done, 'из', reachable, ((Date.now() - t0) / 1000).toFixed(0) + ' c');
}
console.log('Средний счёт при идеальной игре:', V[0].toFixed(4));

// ---- Запись: Uint16 (сотые доли очка), порядок [маска][u*2+yf], в base64 ----
const q = new Uint16Array((FULL + 1) * 128);
for (let i = 0; i < q.length; i++) q[i] = Math.round(V[i] * 100);
const b64 = Buffer.from(q.buffer, q.byteOffset, q.byteLength).toString('base64');
const out = path.join(__dirname, '..', 'optimal.js');
fs.writeFileSync(out,
  '// Сгенерировано tools/build-optimal.js — не править вручную.\n' +
  '// Средний счёт идеальной игры: ' + V[0].toFixed(2) + '. Формат: Uint16 (сотые доли очка), индекс (маска*64+u)*2+yf, little-endian, base64.\n' +
  'var YAHTZEE_OPTIMAL = "' + b64 + '";\n');
console.log('записано', out, (fs.statSync(out).size / 1e6).toFixed(2), 'МБ');
