'use strict';
// 증권사 앱 디자인: game.js 뒤에 읽혀서 그리기 함수만 바꿔 끼운다 (게임 규칙은 그대로)

const M = {
  bg: '#f2f4f6', card: '#ffffff', text: '#191f28', sub: '#6b7684', faint: '#b0b8c1', line: '#e5e8eb', soft: '#f2f4f6',
  red: '#f04452', blue: '#3182f6', redBg: '#fff0f1', blueBg: '#eef4ff', gold: '#e6a100', goldBg: '#fff7e0',
  green: '#1fa855', purple: '#8b5cf6', orange: '#ff7a00',
};
const RANK_C = ['#8b95a1', '#00a3bf', '#1fa855', '#e6a100', '#ff6b00', '#8b5cf6', '#f04452'];
// game.js가 넘기는 네온 색을 앱 색으로
function mc(c) {
  return { [UP]: M.red, [DOWN]: M.blue, [GOLD]: M.gold, [ALERT]: M.red, [CYAN]: M.blue, [RUMOR]: M.purple }[c] || c;
}

function T(text, x, y, size, weight, color, align = 'left') {
  g.font = font(size, weight); g.fillStyle = color; g.textAlign = align; g.fillText(text, x, y);
}
function card(x, y, w, h, r = 16, fill = M.card) {
  g.save();
  g.shadowColor = 'rgba(0,20,60,0.07)'; g.shadowBlur = 14; g.shadowOffsetY = 3;
  g.fillStyle = fill; roundRect(x, y, w, h, r); g.fill();
  g.restore();
}
function chip(text, x, y, color, bg, align = 'left', size = 12) {
  g.font = font(size, 800);
  const w = g.measureText(text).width + 16, h = size + 10;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  g.fillStyle = bg; roundRect(x0, y - h + 5, w, h, h / 2); g.fill();
  g.fillStyle = color; g.textAlign = 'left'; g.fillText(text, x0 + 8, y);
  return w;
}

// 쓰지 않는 네온 요소
function buildBg() {}
const mtsWord = t => t.replace(/롱/g, '매수').replace(/숏/g, '매도');
function ctlRects() {
  const R = ox + W - 16;
  return [{ act: 'flat', label: '일괄청산', x: R - 124, y: 14, w: 58, h: 26 }, { act: 'stop', label: '투자중지', x: R - 60, y: 14, w: 58, h: 26 }];
}
function drawCtl() {
  if (state !== 'play') return;
  G.ctl = ctlRects();
  for (const c of G.ctl) {
    const on = ctlEnabled(c.act);
    g.save();
    g.globalAlpha = on ? 1 : 0.35;
    g.strokeStyle = M.line; g.lineWidth = 1;
    roundRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1, 7); g.stroke();
    T(c.label, c.x + c.w / 2, c.y + 17, 11, 700, M.sub, 'center');
    g.restore();
  }
}
// 금리 바: 얇은 흰 띠
function drawRateBar() {
  const y = rateBarY(), x = ox + 12, w = W - 24, h = 24, L = rateLabels();
  card(x, y, w, h, 12);
  g.font = font(12, 700);
  T(L.rate, x + 14, y + 16, 12, 700, M.text);
  const rw = g.measureText(L.rate).width;
  T(L.trend, x + 24 + rw, y + 16, 12, 800, L.tr ? '#d97a00' : '#c9a36a');
  T(L.flow, x + w - 14, y + 16, 12, 800, L.tr > 0 ? M.blue : L.tr < 0 ? M.red : M.faint, 'right');
}
function celebBox() { return { y: 112, h: 104 }; } // 잔고 카드 자리 위에 (차트·뉴스·버튼은 안 가림)
function drawTicker() {}
function drawParts() {}
function drawCrack() {}
function drawConfetti() {
  for (const c of G.confetti) {
    g.save(); g.translate(c.x, c.y); g.rotate(c.r);
    g.fillStyle = mc(c.c) === '#fff' ? M.blue : mc(c.c);
    g.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2);
    g.restore();
  }
}

// ---------- 배치 ----------
const CT = 292; // 차트 카드 위쪽 (그 위 224~284는 뉴스 칸)
function chartBox() {
  const bot = Math.max(360, H * 0.68);
  return { x0: ox + 24, x1: ox + W - 86, y0: CT + 30, y1: bot - 34 };
}
// 체결·손익 알림은 차트 아래 '보유 포지션' 줄 위에
function zoneTop() { return chartBox().y1 + 126; }
function rateBarY() { return chartBox().y1 + 42; } // 차트 카드 바로 아래
function msgPoint() { return { x: ox + W / 2, y: chartBox().y1 + 94 + 7 }; }

function draw() {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = M.bg;
  g.fillRect(0, 0, innerWidth, innerHeight);
  g.translate((Math.random() - 0.5) * G.shake * 0.5 + bossShakeOffset(), (Math.random() - 0.5) * G.shake * 0.5 + bossShakeOffset());
  if (state === 'play' || state === 'over' || state === 'margin') {
    drawTop(); drawPanels(); drawChart(); drawZones(); drawNews(); drawCtl(); drawRateBar();
  }
  if (state === 'play' && halted()) drawHalt();
  drawDanger();
  drawBossFx();
  drawFloats();
  drawToasts();
  drawCelebrate();
  if (G.flash) {
    g.globalAlpha = Math.min(0.12, G.flash.life * 0.4);
    g.fillStyle = mc(G.flash.color);
    g.fillRect(-30, -30, innerWidth + 60, innerHeight + 60);
    g.globalAlpha = 1;
  }
  if (state === 'menu') drawMenu();
  if (state === 'ach') drawAch();
  if (state === 'analysis') drawAnalysis();
  if (state === 'over') { drawOver(); drawRankUp(); }
  if (state === 'margin') drawMarginCall();
}

// ---------- 상단: 종목 헤더 + 잔고 카드 ----------
function drawTop() {
  const L = ox + 20, R = ox + W - 20;
  const chg = G.price / OPEN - 1, cc = chg >= 0 ? M.red : M.blue;
  T(`${INDEX} 선물`, L, 34, 18, 800, M.text);
  T(`가상 지수 · 레버리지 ${G.lev}배`, L, 54, 12, 600, M.sub);
  // 현재가 · 등락 · 남은 시간 (한 줄)
  g.font = font(32, 800);
  const pw = g.measureText(pt(G.price)).width;
  T(pt(G.price), L, 96, 32, 800, cc);
  T(`${chg >= 0 ? '▲' : '▼'} ${Math.abs(G.price - OPEN).toFixed(2)}  ${pctText(chg)}`, L + pw + 10, 94, 14, 700, cc);
  const sec = Math.max(0, Math.ceil(ROUND - G.t)), urgent = sec <= 10;
  chip(`⏱ 0:${String(sec).padStart(2, '0')}`, R, 95, urgent ? '#fff' : M.text, urgent ? M.red : '#e3e7ec', 'right', 15);

  // 잔고 카드: 평가금액 바로 옆에 손익 %
  const y = 112, h = 104, u = unreal(), eq = G.money + u;
  card(ox + 12, y, W - 24, h);
  const rk = rankIdx(eq);
  T('평가금액', L, y + 26, 13, 600, M.sub);
  chip(RANKS[rk].name, L + 58, y + 26, RANK_C[rk], RANK_C[rk] + '1f', 'left', 11);
  const rate = G.pos ? u / posMargin() : (G.money - G.startMoney) / G.startMoney;
  const rc = rate >= 0 ? M.red : M.blue;
  const s = 1 + G.pulse * 0.08;
  g.font = font(24, 800);
  const ew = g.measureText(`${won(eq)}원`).width;
  g.save(); g.translate(L, y + 60); g.scale(s, s);
  T(`${won(eq)}원`, 0, 0, 24, 800, M.text);
  g.restore();
  chip(pctText(rate), L + ew + 8, y + 59, '#fff', rc, 'left', 14);
  if (G.pos) {
    T('평가손익', R, y + 26, 13, 600, M.sub, 'right');
    T(sign(u), R, y + 86, 14, 800, rc, 'right');
    T(`확정 잔액 ${won(G.money)}`, L, y + 86, 12, 600, M.sub);
  } else {
    T('이번 판 수익률', R, y + 26, 13, 600, M.sub, 'right');
    T('보유 포지션 없음', L, y + 86, 12, 600, M.sub);
    if (G.combo >= 2) T(`연속 수익 ${G.combo}회`, R, y + 86, 13, 800, M.gold, 'right');
  }
  // 시간 막대
  const left = Math.max(0, 1 - G.t / ROUND);
  g.fillStyle = M.soft; roundRect(ox + 24, y + h - 8, W - 48, 3, 1.5); g.fill();
  g.fillStyle = urgent ? M.red : M.blue; roundRect(ox + 24, y + h - 8, (W - 48) * left, 3, 1.5); g.fill();
}

// 차트 카드 + 보유 포지션 줄
function drawPanels() {
  const b = chartBox();
  card(ox + 12, CT, W - 24, b.y1 - CT + 34);
  T('최근 15초', ox + 24, CT + 20, 12, 700, M.sub);
  T(`시가 ${OPEN.toFixed(2)}`, ox + W - 24, CT + 20, 12, 600, M.sub, 'right');

  // 포지션 줄
  const py = b.y1 + 72, ph = 44;
  card(ox + 12, py, W - 24, ph, 14);
  if (G.floats.length) return; // 체결·손익 알림이 이 줄을 덮는 동안
  if (G.pos) {
    const long = G.pos.dir > 0, c = long ? M.red : M.blue;
    const w = chip(`${long ? '매수' : '매도'} x${posUnits()} / 최대 ${G.cap}단`, ox + 24, py + 27, c, long ? M.redBg : M.blueBg, 'left', 12);
    T(`평균 ${avgEntry().toFixed(2)}`, ox + 32 + w, py + 27, 13, 700, M.text);
    T(`청산가 ${liqPrice().toFixed(2)}`, ox + W - 24, py + 27, 13, 700, M.red, 'right');
  } else {
    T(`보유 포지션 없음 · 이번 판 최대 ${G.cap}단`, ox + W / 2, py + 27, 13, 600, M.sub, 'center');
  }
}

function drawGrid() {}

function drawChart() {
  if (state === 'menu' || state === 'ach' || state === 'analysis') return;
  const b = chartBox(), [lo, hi] = range(), n = G.hist.length;
  const X = i => b.x0 + i / (HIST - 1) * (b.x1 - b.x0);
  const col = '#2f3a4d'; // 차트선은 한 색 고정, 빨강·파랑은 손익에만
  drawAxes(b, lo, hi, X);
  if (OPEN > lo && OPEN < hi) {
    const y = yOf(OPEN, b, lo, hi);
    g.strokeStyle = M.faint; g.lineWidth = 1; g.setLineDash([2, 4]);
    g.beginPath(); g.moveTo(b.x0, y); g.lineTo(b.x1, y); g.stroke(); g.setLineDash([]);
  }
  const grad = g.createLinearGradient(0, b.y0, 0, b.y1);
  grad.addColorStop(0, 'rgba(47,58,77,0.12)'); grad.addColorStop(1, 'rgba(47,58,77,0)');
  g.beginPath();
  G.hist.forEach((v, i) => { const x = X(i + HIST - n), y = yOf(v, b, lo, hi); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.lineTo(b.x1, b.y1); g.lineTo(X(HIST - n), b.y1); g.closePath();
  g.fillStyle = grad; g.fill();
  g.strokeStyle = col; g.lineWidth = 2.2; g.lineJoin = 'round';
  g.beginPath();
  G.hist.forEach((v, i) => { const x = X(i + HIST - n), y = yOf(v, b, lo, hi); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();

  const tags = tagLayout(b, lo, hi);
  if (G.pos) {
    const c = G.pos.dir > 0 ? M.red : M.blue, y = yOf(avgEntry(), b, lo, hi);
    g.strokeStyle = c; g.lineWidth = 1.2; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(b.x0, y); g.lineTo(b.x1, y); g.stroke(); g.setLineDash([]);
    const lq = liqPrice();
    if (lq > lo && lq < hi) {
      const ly = yOf(lq, b, lo, hi);
      g.strokeStyle = M.red; g.lineWidth = 1; g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(b.x0, ly); g.lineTo(b.x1, ly); g.stroke(); g.setLineDash([]);
    }
    liqDistance(b, lo, hi, M.red, M.redBg);
  }
  for (const t of tags) {
    if (t.k === 'open') axisTag(b, t.ty, `시가 ${OPEN.toFixed(1)}`, M.faint, t.y);
    if (t.k === 'entry') axisTag(b, t.ty, `${G.pos.dir > 0 ? '매수' : '매도'}${posUnits() > 1 ? 'x' + posUnits() : ''} ${avgEntry().toFixed(1)}`, G.pos.dir > 0 ? M.red : M.blue, t.y);
    if (t.k === 'liq') axisTag(b, t.ty, `${t.edge ? (t.edge > 0 ? '▲' : '▼') : ''}청산 ${liqPrice().toFixed(1)}`, M.red, t.edge ? null : t.y);
  }
  const p0 = tags.find(t => t.k === 'price'), py = p0.y, pty = p0.ty;
  g.fillStyle = col;
  g.beginPath(); g.arc(b.x1, py, 4 + Math.sin(performance.now() / 150) * 1, 0, Math.PI * 2); g.fill();
  if (Math.abs(pty - py) > 1) { g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(b.x1, py); g.lineTo(b.x1 + 6, pty); g.stroke(); }
  roundRect(b.x1 + 6, pty - 12, 74, 24, 6); g.fill();
  T(pt(G.price), b.x1 + 43, pty + 5, 13, 800, '#fff', 'center');
}

function axisTag(b, y, text, c, trueY = null) {
  if (trueY !== null && Math.abs(trueY - y) > 1) { g.strokeStyle = c; g.lineWidth = 1; g.beginPath(); g.moveTo(b.x1, trueY); g.lineTo(b.x1 + 6, y); g.stroke(); }
  g.fillStyle = '#fff'; roundRect(b.x1 + 6, y - 10, 74, 20, 5); g.fill();
  g.strokeStyle = c; g.lineWidth = 1.2; roundRect(b.x1 + 6, y - 10, 74, 20, 5); g.stroke();
  T(text, b.x1 + 43, y + 4, 11, 700, c, 'center');
}

function drawAxes(b, lo, hi, X) {
  const step = niceStep((hi - lo) / 7), busy = tagYs(b, lo, hi);
  g.strokeStyle = M.soft; g.lineWidth = 1;
  for (let v = Math.ceil(lo / step) * step; v < hi; v += step) {
    const y = yOf(v, b, lo, hi);
    g.beginPath(); g.moveTo(b.x0, y); g.lineTo(b.x1, y); g.stroke();
    if (busy.some(t => Math.abs(t - y) < 15)) continue;
    T(v.toFixed(step < 1 ? 1 : 0), b.x1 + 12, y + 4, 11, 500, M.faint);
  }
  [['-15초', 0], ['-10초', 50], ['-5초', 100], ['지금', HIST - 1]].forEach(([label, i]) => {
    T(label, Math.min(X(i), b.x1 - 10), b.y1 + 18, 11, 500, M.faint, 'center');
  });
}

// 주문 버튼: 매수(빨강) / 매도(파랑)
function drawZones() {
  const y0 = zoneTop(), h = Math.max(70, H - y0 - 20), w = (W - 36) / 2, off = halted();
  const zones = [{ x: ox + 12, c: M.red, side: 1, p: G.press.l }, { x: ox + 24 + w, c: M.blue, side: -1, p: G.press.r }].map(z => {
    const t = zoneText(z.side);
    return Object.assign(z, { label: mtsWord(t.label), sub: G.pos ? mtsWord(t.sub) : (z.side > 0 ? '오른다 · 롱' : '내린다 · 숏'), badge: t.badge });
  });
  for (const z of zones) {
    const sq = z.p * 3;
    g.save();
    g.globalAlpha = off ? 0.35 : 1;
    g.shadowColor = z.c + '55'; g.shadowBlur = 16; g.shadowOffsetY = 4;
    g.fillStyle = z.c;
    roundRect(z.x + sq, y0 + sq, w - sq * 2, h - sq * 2, 18); g.fill();
    g.restore();
    g.globalAlpha = off ? 0.6 : 1;
    T(z.label, z.x + w / 2, y0 + h / 2 + 4, z.label.length > 2 ? 24 : 26, 800, '#fff', 'center');
    T(off ? '매매 정지' : z.sub, z.x + w / 2, y0 + h / 2 + 28, 13, 600, 'rgba(255,255,255,0.85)', 'center');
    if (z.badge && !off) { // 보유 단위 배지
      g.fillStyle = '#fff'; roundRect(z.x + w - 54, y0 + 10, 44, 24, 12); g.fill();
      T(z.badge, z.x + w - 32, y0 + 27, 14, 900, z.c, 'center');
    }
    g.globalAlpha = 1;
  }
}

// 뉴스: 앱 푸시 알림처럼 차트 카드 위에
function drawNews() {
  const x = ox + 12, w = W - 24, h = 60, y0 = 224;
  if (G.news && G.news.kind === 'boss') { drawBossBanner(ox + W / 2, y0 + h / 2, W - 16); return; }
  if (!G.news) {
    if (state !== 'play') return;
    g.save();
    g.fillStyle = '#f7f8fa'; roundRect(x, y0, w, h, 16); g.fill();
    g.strokeStyle = '#d1d6db'; g.lineWidth = 1.5; g.setLineDash([5, 6]);
    roundRect(x, y0, w, h, 16); g.stroke(); g.setLineDash([]);
    T('뉴스 대기 중…', ox + W / 2, y0 + h / 2 + 5, 15, 700, M.faint, 'center');
    g.restore();
    return;
  }
  const n = G.news, { tag, body } = newsParts(n), a = newsAnim(n);
  const tc = { 긴급: M.red, 소문: M.purple, 공식: M.sub, 속보: '#f5b800' }[tag] || '#f5b800';
  const blink = tag === '긴급' && Math.floor(n.age * 4) % 2;
  const cy = y0 + h / 2;
  g.save();
  g.translate(ox + W / 2, cy - (1 - a.e) * 14);
  g.scale(a.pop, a.pop);
  g.globalAlpha = Math.min(1, n.life / 0.3, 0.3 + a.e);
  g.shadowColor = tc + '88'; g.shadowBlur = 10 + a.pulse * 24; g.shadowOffsetY = 2;
  g.fillStyle = blink ? '#fff0f1' : '#fff';
  roundRect(-w / 2, -h / 2, w, h, 16); g.fill();
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.strokeStyle = tc; g.lineWidth = tag === '긴급' ? (blink ? 3 : 1.5) : 1.5 + a.pulse * 2;
  roundRect(-w / 2, -h / 2, w, h, 16); g.stroke();
  if (a.pulse > 0) {
    const e = (1 - a.pulse) * 10;
    g.globalAlpha = a.pulse * 0.7;
    g.strokeStyle = tc; g.lineWidth = 2;
    roundRect(-w / 2 - e, -h / 2 - e, w + e * 2, h + e * 2, 16 + e); g.stroke();
    g.globalAlpha = 1;
  }
  const tw = newsTag(-w / 2 + 12, 0, tag, tc, tag === '속보' ? '#3d2e00' : '#fff');
  const fs = fitFont(body, w - tw - 36, 17, 13, 800);
  g.fillStyle = M.text; g.textAlign = 'left';
  g.fillText(body, -w / 2 + tw + 24, fs * 0.36);
  g.restore();
}

function drawHalt() {
  const cx = ox + W / 2, cy = H * 0.42, left = Math.ceil(G.haltUntil - G.t);
  g.fillStyle = 'rgba(0,10,30,0.35)'; g.fillRect(0, 0, innerWidth, innerHeight);
  g.save();
  g.translate((G.haltNudge || 0) * Math.sin(performance.now() / 18) * 8, 0);
  card(ox + 36, cy - 76, W - 72, 152, 20);
  T('⚠ 서킷브레이커 발동', cx, cy - 32, 20, 800, M.red, 'center');
  T(`지수 ${Math.round(-CB_DROP * 100)}% 급락으로 매매가 정지됐어요`, cx, cy - 6, 13, 600, M.sub, 'center');
  T(`${left}초 후 재개`, cx, cy + 40, 26, 800, M.text, 'center');
  g.restore();
}

function drawDanger() {
  if (state !== 'play' || halted()) return;
  const d = danger();
  if (d < WARN) return;
  const crit = d >= CRIT, beat = 0.5 + 0.5 * Math.sin(performance.now() / (crit ? 120 : 400));
  if (crit) { // 화면 테두리 빨갛게
    g.save();
    g.strokeStyle = `rgba(240,68,82,${0.35 + 0.45 * beat})`; g.lineWidth = 10;
    g.strokeRect(0, 0, innerWidth, innerHeight);
    g.restore();
  }
  const left = Math.abs(G.price / liqPrice() - 1) * 100;
  const text = crit ? `⚠ 청산 임박 · 청산가까지 ${left.toFixed(1)}%` : `청산 주의 · 청산가까지 ${left.toFixed(1)}%`;
  const b = chartBox();
  chip(text, (b.x0 + b.x1) / 2, b.y0 + 22, crit ? '#fff' : '#b34700', crit ? M.red : '#ffe2cc', 'center', 13);
}

// 체결·손익 알림: 어두운 토스트
function drawFloats() {
  for (const f of G.floats) {
    const rise = 0;
    const text = f.text === '롱 진입!' ? '매수 체결' : f.text === '숏 진입!' ? '매도 체결' : mtsWord(f.text);
    g.save();
    g.globalAlpha = Math.min(1, f.life / 0.4);
    g.translate(f.x, f.y - rise);
    const pop = 1 + Math.max(0, f.life - 1.0) * 1.5;
    g.scale(pop, pop);
    const size = Math.min(f.size, f.text === '강제청산!' ? 30 : 17);
    g.font = font(size, 800);
    const w = g.measureText(text).width + 32, h = size + 18;
    g.fillStyle = 'rgba(25,31,40,0.92)'; roundRect(-w / 2, -size * 0.85 - 9, w, h, 12); g.fill();
    const c = mc(f.color);
    T(text, 0, 0, size, 800, c === M.blue ? '#7fb3ff' : c === M.red ? '#ff7a85' : c === M.gold ? '#ffd34d' : '#fff', 'center');
    g.restore();
  }
}

function drawToasts() {
  if (state !== 'play') return;
  const b = chartBox();
  G.toasts.slice(0, 2).forEach((t, i) => {
    g.save();
    g.globalAlpha = Math.min(1, t.life / 0.4, (2.6 - t.life) / 0.2);
    chip(t.text.replace('🏆 업적: ', '🏆 업적 달성 · '), (b.x0 + b.x1) / 2, b.y1 - 12 - i * 30, '#7a5400', M.goldBg, 'center', 13);
    g.restore();
  });
}

// ---------- 자산 곡선 / 등급 카드 ----------
function drawCurve(x, y, w, h, data) {
  const pts = data.length > 1 ? data : [data[0], data[0]];
  let lo = Math.min(...pts, START_MONEY), hi = Math.max(...pts);
  hi = Math.max(hi, lo * 3);
  const L0 = Math.log(lo) - 0.15, L1 = Math.log(hi) + 0.15;
  const top = y + 6, bot = y + h - 16, left = x, right = x + w - 62;
  const Y = v => bot - (Math.log(Math.max(1, v)) - L0) / (L1 - L0) * (bot - top);
  const X = i => left + i / (pts.length - 1) * (right - left);
  RANKS.forEach((k, i) => {
    if (k.min <= 0) return;
    const ly = Y(k.min);
    if (ly < top || ly > bot) return;
    g.strokeStyle = M.line; g.lineWidth = 1; g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(left, ly); g.lineTo(right, ly); g.stroke(); g.setLineDash([]);
    T(k.name, right + 6, ly + 4, 10, 700, RANK_C[i]);
  });
  const up = pts[pts.length - 1] >= START_MONEY, col = up ? M.red : M.blue;
  const grad = g.createLinearGradient(0, top, 0, bot);
  grad.addColorStop(0, col + '2a'); grad.addColorStop(1, col + '00');
  g.beginPath();
  pts.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
  g.lineTo(right, bot); g.lineTo(left, bot); g.closePath();
  g.fillStyle = grad; g.fill();
  g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = 'round';
  g.beginPath();
  pts.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
  g.stroke();
  g.fillStyle = col; g.beginPath(); g.arc(right, Y(pts[pts.length - 1]), 3.5, 0, Math.PI * 2); g.fill();
  T('처음', left, y + h - 2, 10, 600, M.faint);
  T(`${data.length - 1}판째`, right, y + h - 2, 10, 600, M.faint, 'right');
}

function drawRankCard(x, y, w, money, showMoney = true) {
  const r = rankIdx(money), k = RANKS[r], nx = RANKS[r + 1];
  chip(k.name, x, y + 18, RANK_C[r], RANK_C[r] + '1f', 'left', 13);
  if (showMoney) T((money >= 1e9 ? kor(money) : won(money)) + '원', x + w, y + 20, 18, 800, M.text, 'right');
  const by = y + 32;
  g.fillStyle = M.soft; roundRect(x, by, w, 6, 3); g.fill();
  let f = 1, txt = '최고 등급 달성';
  if (nx) {
    const a = Math.log(Math.max(k.min, START_MONEY * 0.1)), z = Math.log(nx.min);
    f = Math.max(0, Math.min(1, (Math.log(Math.max(1, money)) - a) / (z - a)));
    txt = `다음 등급 ${nx.name} · ${kor(nx.min)}원` + (nx.lev > k.lev ? ` · ${nx.lev}배 해금` : '');
  }
  g.fillStyle = nx ? RANK_C[r + 1] : RANK_C[r]; roundRect(x, by, Math.max(6, w * f), 6, 3); g.fill();
  T(txt, x, by + 22, 12, 600, M.sub);
}

function button(x, y, w, h, bg, fg, label, act, quiet = false) {
  if (quiet) { // 테두리만
    g.strokeStyle = M.line; g.lineWidth = 1.2; roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 14); g.stroke();
    T(label, x + w / 2, y + h / 2 + 5, 14, 700, M.sub, 'center');
    G.buttons.push({ x, y, w, h, act });
    return;
  }
  const map = { [GOLD]: [M.goldBg, '#7a5400'], [CYAN]: [M.blue, '#fff'], [ALERT]: [M.red, '#fff'], '#2a3350': ['#e8ebef', M.text] };
  const [b2, f2] = map[bg] || [bg, fg];
  g.fillStyle = b2; roundRect(x, y, w, h, 14); g.fill();
  T(label, x + w / 2, y + h / 2 + 6, 16, 800, f2, 'center');
  G.buttons.push({ x, y, w, h, act });
}

// ---------- 홈 (메뉴) ----------
function drawMenu() {
  const x = ox + 16, w = W - 32, L = x + 16, IW = w - 32;
  const tight = H < 720;
  G.buttons = [];
  // 앱 헤더: 아이콘 + 이름 / 업적
  const iy = 18;
  const ig = g.createLinearGradient(L, iy, L + 34, iy + 34);
  ig.addColorStop(0, '#4c9bff'); ig.addColorStop(1, '#1b64da');
  g.fillStyle = ig; roundRect(L, iy, 34, 34, 10); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 2.6; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); [[7, 25], [14, 18], [19, 22], [27, 11]].forEach(([a, b], i) => i ? g.lineTo(L + a, iy + b) : g.moveTo(L + a, iy + b)); g.stroke();
  T('선물 러시', L + 44, iy + 24, 20, 800, M.text);
  const got = ACHS.filter(a => C.ach[a.id]).length;
  const aw = chip(`🏆 업적 ${got}/${ACHS.length}`, x + w - 4, iy + 23, M.text, '#e3e7ec', 'right', 13);
  G.buttons.push({ x: x + w - 4 - aw, y: iy, w: aw, h: 30, act: 'ach' });

  // 내 자산 카드
  let y = 66;
  const showAna = P.rounds >= 3;
  const ch = tight || showAna ? 76 : 104, ah = 150 + ch;
  card(x, y, w, ah);
  T('내 자산', L, y + 28, 14, 700, M.sub);
  const prof = C.money - START_MONEY, pc = prof >= 0 ? M.red : M.blue;
  T(`${won(C.money)}원`, L, y + 62, 28, 800, M.text);
  T(`시작 대비 ${sign(prof)}원 (${pctText(prof / START_MONEY)})`, L, y + 86, 13, 700, pc);
  drawRankCard(L, y + 98, IW, C.money, false);
  drawCurve(L, y + 150, IW, ch - 6, C.curve);
  y += ah + 12;

  // 레버리지 선택
  const lh = 196;
  card(x, y, w, lh);
  drawDiffSeg(L, y + 12, IW);
  y += 44;
  T('레버리지', L, y + 28, 15, 800, M.text);
  T(`스택 최대 ${stackCap(C.money)}단 · ${nextCapText(C.money)}`, x + w - 16, y + 28, 11, 600, M.sub, 'right');
  const mx = maxLev(C.money), bw = (IW - 16) / 3, bh = 46;
  const subs = { 1: '안전', 5: '보통', 10: '화끈', 20: '위험', 50: '광기', 100: '전설' };
  LEVS.forEach((lv, i) => {
    const bx = L + (i % 3) * (bw + 8), byy = y + 44 + Math.floor(i / 3) * (bh + 8);
    const open = lv <= mx, sel = lv === fitLev(lastLev);
    g.fillStyle = sel ? M.blue : open ? M.soft : '#f7f8fa';
    roundRect(bx, byy, bw, bh, 12); g.fill();
    if (!open) { g.strokeStyle = M.line; g.lineWidth = 1; roundRect(bx, byy, bw, bh, 12); g.stroke(); }
    T(open ? `${lv}배` : `🔒 ${lv}배`, bx + bw / 2, byy + 21, 16, 800, sel ? '#fff' : open ? M.text : M.faint, 'center');
    T(open ? subs[lv] : unlockRank(lv).name, bx + bw / 2, byy + 37, 11, 600, sel ? 'rgba(255,255,255,0.85)' : M.faint, 'center');
    G.buttons.push({ x: bx, y: byy, w: bw, h: bh, act: 'sel', lev: lv });
  });
  y += lh - 44 + 12;

  if (!tight && !showAna) {
    card(x, y, w, 62);
    T('[속보]·[긴급]은 따라가고, [소문]은 거꾸로', L, y + 26, 13, 700, M.text);
    T('왼쪽 탭 매수(롱) · 오른쪽 탭 매도(숏)', L, y + 46, 12, 600, M.sub);
    y += 74;
  }

  // 시작 버튼
  const lv = fitLev(lastLev);
  g.fillStyle = M.blue; roundRect(x, y, w, 56, 16); g.fill();
  T(`${lv}배로 60초 거래 시작`, x + w / 2, y + 35, 17, 800, '#fff', 'center');
  G.buttons.push({ x, y, w, h: 56, act: 'lev', lev: lv });
  y += 66;
  if (showAna) y += drawAnaCard(x, y, w) + 24; else y += 10;
  T(`최고 자산 ${kor(C.best)}원 · 한 판 최고 ${pctText(C.bestDay)}`, x + w / 2, y, 12, 600, M.sub, 'center');
  T('디자인 바꾸기 (네온)', x + w / 2, y + 26, 12, 700, M.blue, 'center');
  G.buttons.push({ x: x + w / 2 - 70, y: y + 10, w: 140, h: 24, act: 'theme' });
  T(resetLabel(), x + w / 2, y + 52, 12, 700, resetArmed() ? M.red : M.faint, 'center');
  G.buttons.push({ x: x + w / 2 - 90, y: y + 36, w: 180, h: 24, act: 'resetAsk' });
  drawNudge();
}


// 로비 요약 카드 (증권사 앱)
function drawAnaCard(x, y, w) {
  const h = 92, a = analyze();
  card(x, y, w, h);
  T('트레이더 분석 ›', x + 16, y + 24, 13, 800, M.sub);
  const at = archText();
  g.font = font(13, 800);
  chip(at, x + w - 14, y + 25, '#7a5400', M.goldBg, 'right', 13);
  T(allTimeLine(), x + 16, y + 46, 12, 600, M.sub);
  g.font = font(13, 700);
  wrapLines(diagnose(a), w - 32).slice(0, 2).forEach((t, i) => T(t, x + 16, y + 68 + i * 17, 13, 700, M.text));
  G.buttons.push({ x, y, w, h, act: 'ana' });
  return h;
}
// 상세 분석 화면 (증권사 앱)
function drawAnalysis() {
  const x = ox + 16, w = W - 32, a = analyze(), rh = H < 720 ? 24 : 29;
  g.fillStyle = M.bg; g.fillRect(0, 0, innerWidth, innerHeight);
  T('트레이더 분석', x + 4, 40, 22, 800, M.text);
  T(a ? `성향: 최근 ${a.n}판 · 전적: 누적` : '전적: 누적', x + w - 4, 40, 12, 600, M.sub, 'right');
  let y = 54;
  card(x, y, w, 76);
  T(archText(), ox + W / 2, y + 36, 24, 800, M.gold, 'center');
  T(P.arch ? ARCH[P.arch].s : '3판부터 성향이 나와요', ox + W / 2, y + 58, 12, 600, M.sub, 'center');
  y += 86;
  g.font = font(13, 700);
  const dl = wrapLines(diagnose(a), w - 32).slice(0, 2);
  card(x, y, w, 22 + dl.length * 18, 14, '#fff7e8');
  dl.forEach((t, i) => T(t, x + 16, y + 26 + i * 18, 13, 700, '#7a4a00'));
  y += 32 + dl.length * 18;
  T('성향', x + 4, y + 4, 12, 800, M.sub);
  y += 10;
  const axes = a ? a.axes : [];
  card(x, y, w, Math.max(1, axes.length) * rh + 8);
  if (!axes.length) T('아직 데이터가 부족해요', x + 16, y + 22, 12, 600, M.faint);
  axes.forEach((ax, i) => {
    const yy = y + 4 + i * rh;
    T(ax.name, x + 16, yy + 18, 13, 700, M.text);
    for (let k = 0; k < 3; k++) {
      g.fillStyle = k <= ax.lv ? [M.blue, '#f5b800', M.red][ax.lv] : M.soft;
      roundRect(x + 88 + k * 24, yy + 9, 20, 9, 4); g.fill();
    }
    T(LV_NAME[ax.lv], x + 166, yy + 18, 11, 700, M.sub);
    T(ax.val, x + w - 14, yy + 18, 11, 600, M.sub, 'right');
  });
  y += Math.max(1, axes.length) * rh + 18;
  T('전적', x + 4, y + 4, 12, 800, M.sub);
  y += 10;
  const items = statItems(), cw = (w - 10) / 2;
  items.forEach(([k, v], i) => {
    const bx = x + (i % 2) * (cw + 10), by = y + Math.floor(i / 2) * rh;
    g.fillStyle = M.card; roundRect(bx, by + 2, cw, rh - 4, 8); g.fill();
    T(k, bx + 10, by + rh / 2 + 4, 11, 600, M.sub);
    T(v, bx + cw - 10, by + rh / 2 + 5, 13, 800, M.text, 'right');
  });
  y += Math.ceil(items.length / 2) * rh + 8;
  G.buttons = [];
  button(x, Math.min(y, H - 56), w, 44, CYAN, '#fff', '돌아가기', 'back');
}

// 난이도 세그먼트 (증권사 앱)
function drawDiffSeg(x, y, w) {
  const h = 36, half = (w - 6) / 2;
  g.fillStyle = M.soft; roundRect(x, y, w, h, 12); g.fill();
  ['easy', 'normal'].forEach((k, i) => {
    const bx = x + 3 + i * half, on = P.diff === k;
    if (on) card(bx, y + 3, half, h - 6, 10);
    g.font = font(14, 800); const lw = g.measureText(DIFF_LABEL[k][0]).width;
    g.font = font(11, 600); const sw = g.measureText(DIFF_LABEL[k][1]).width;
    const sx = bx + half / 2 - (lw + 6 + sw) / 2; // 이름과 설명을 나란히 가운데 정렬
    T(DIFF_LABEL[k][0], sx, y + 23, 14, 800, on ? M.text : M.faint);
    T(DIFF_LABEL[k][1], sx + lw + 6, y + 22, 11, 600, on ? (k === 'easy' ? M.blue : '#d97a00') : M.faint);
    G.buttons.push({ x: bx, y: y + 3, w: half, h: h - 6, act: 'diff', val: k });
  });
  return h + 10;
}
// 보통 도전 안내 (증권사 앱): 헤더 자리 위
function drawNudge() {
  if (!P.nudgePending) return;
  const x = ox + 12, w = W - 24, y = 8, h = 74;
  g.save(); g.shadowColor = 'rgba(0,20,60,0.18)'; g.shadowBlur = 18; g.fillStyle = '#fff7e8'; roundRect(x, y, w, h, 16); g.fill(); g.restore();
  T('쉬움 정복! 자본금 2배 달성', x + 16, y + 24, 14, 800, '#7a4a00');
  T('보통(실전 난이도)에 도전해 보세요.', x + 16, y + 44, 12, 600, M.sub);
  const bw = 78, by = y + h - 32;
  g.fillStyle = M.blue; roundRect(x + w - bw * 2 - 18, by, bw, 24, 8); g.fill();
  T('보통으로', x + w - bw * 1.5 - 18, by + 16, 12, 800, '#fff', 'center');
  g.strokeStyle = M.line; g.lineWidth = 1; roundRect(x + w - bw - 10, by, bw, 24, 8); g.stroke();
  T('닫기', x + w - bw / 2 - 10, by + 16, 12, 700, M.sub, 'center');
  G.buttons.unshift({ x: x + w - bw * 2 - 18, y: by, w: bw, h: 24, act: 'nudgeGo' }, { x: x + w - bw - 10, y: by, w: bw, h: 24, act: 'nudgeX' });
}

function drawAch() {
  const x = ox + 16, w = W - 32;
  g.fillStyle = M.bg; g.fillRect(0, 0, innerWidth, innerHeight);
  const got = ACHS.filter(a => C.ach[a.id]).length;
  T('업적', x + 4, 42, 22, 800, M.text);
  T(`${got}/${ACHS.length} 달성`, x + w - 4, 42, 14, 700, M.blue, 'right');
  const rh = Math.min(46, (H - 150) / ACHS.length);
  card(x, 60, w, ACHS.length * rh + 8);
  ACHS.forEach((a, i) => {
    const y = 64 + i * rh, ok = !!C.ach[a.id];
    if (i) { g.fillStyle = M.soft; g.fillRect(x + 16, y, w - 32, 1); }
    T(ok ? '🏆' : '🔒', x + 18, y + rh / 2 + 5, 15, 700, M.text);
    T(a.name, x + 44, y + rh / 2 + 5, 14, 800, ok ? M.text : M.faint);
    T(a.desc, x + w - 16, y + rh / 2 + 4, 11, 600, ok ? M.sub : M.faint, 'right');
  });
  G.buttons = [];
  button(x, 60 + ACHS.length * rh + 22, w, 50, CYAN, '#fff', '돌아가기', 'back');
}

// ---------- 거래 결과 (하단 시트) ----------
function drawOver() {
  const x = ox + 12, w = W - 24, L = x + 18, IW = w - 36;
  const profit = G.money - G.startMoney, rate = profit / G.startMoney, pc = profit >= 0 ? M.red : M.blue;
  const showDouble = profit > 0 && !G.doubled && !G.broke;
  const ch = H < 720 ? 70 : 100;
  const sh = 300 + ch + (G.newAch.length ? 30 : 0) + (G.broke ? 92 : (showDouble ? 56 : 0) + 112);
  const y0 = Math.max(10, H - sh - 8);
  g.fillStyle = 'rgba(0,10,30,0.45)'; g.fillRect(0, 0, innerWidth, innerHeight);
  card(x, y0, w, sh, 22);
  g.fillStyle = M.line; roundRect(x + w / 2 - 20, y0 + 8, 40, 4, 2); g.fill();
  let y = y0 + 40;
  T(G.broke ? '계좌가 깡통이 됐어요' : `${C.rounds}번째 거래 결과`, L, y, 17, 800, G.broke ? M.red : M.text);
  T(`최고 자본금 ${C.runPeak.toFixed(1)}배`, x + w - 18, y, 13, 800, M.gold, 'right');
  if (G.broke) T(`자산이 최소 증거금 ${kor(MIN_MONEY)}원 아래로 내려갔어요`, L, y + 20, 12, 600, M.sub);
  y += G.broke ? 58 : 44;
  T(`${sign(profit)}원`, L, y, 28, 800, pc);
  T(pctText(rate), x + w - 18, y, 18, 800, pc, 'right');
  if (G.recordDay) chip('한 판 최고 수익 경신', L, y + 24, '#7a5400', M.goldBg, 'left', 11);
  y += G.recordDay ? 36 : 16;
  // 거래 내역 요약 (3 x 2)
  const cells = [['레버리지', `${G.lev}배`], ['매매', `${G.trades}회`], ['수익', `${G.wins}회`],
    ['최고 콤보', `x${G.bestCombo}`], ['강제청산', `${G.liqs}회`], ['연속 이익 판', `${C.streak}판`]];
  const cw = IW / 3;
  g.fillStyle = M.soft; roundRect(L, y, IW, 76, 12); g.fill();
  cells.forEach(([a, b], i) => {
    const cx = L + cw * (i % 3) + cw / 2, cy = y + 24 + Math.floor(i / 3) * 34;
    T(a, cx, cy - 6, 10, 600, M.sub, 'center');
    T(b, cx, cy + 9, 13, 800, M.text, 'center');
  });
  y += 88;
  T(`이번 판 수수료 ${won(G.fees)}원 · 슬리피지 ${won(G.slip)}원${G.bossSlain ? ' · ☠ 보스 처치' : ''}`, L, y - 2, 12, 700, '#d97a00');
  y += 14;
  g.font = font(11, 600);
  { const t = statLine(); let fs = 12; while (fs > 9 && (g.font = font(fs, 600), g.measureText(t).width > IW)) fs--; T(t, L, y + 2, fs, 600, M.sub); }
  y += 18;
  drawRankCard(L, y, IW, G.money);
  y += 64;
  drawCurve(L, y, IW, ch, C.curve);
  y += ch + 8;
  if (G.newAch.length) {
    chip('🏆 ' + G.newAch.map(a => a.name).join(' · '), L, y + 18, '#7a5400', M.goldBg, 'left', 12);
    y += 30;
  }
  y += 6;
  G.buttons = [];
  if (G.broke) {
    button(L, y, IW, 52, ALERT, '#fff', '100만 원으로 다시 시작', 'reset');
    T(`이번 도전 최고 ${kor(C.runBest)}원 · 업적과 최고 기록은 남아요`, x + w / 2, y + 74, 12, 600, M.sub, 'center');
    return;
  }
  button(L, y, IW, 54, CYAN, '#fff', `다음 거래 (${fitLev(G.lev)}배 · 최대 ${stackCap(C.money)}단)`, 'again');
  y += 62;
  if (showDouble) { button(L, y, IW, 42, GOLD, '#000', '광고 보고 이번 판 수익 2배', 'double', true); y += 50; }
  button(L, y, IW, 44, '#2a3350', M.text, '홈으로', 'menu');
}

function drawRankUp() {
  const ru = G.rankUp;
  if (!ru || ru.done) { drawConfetti(); return; }
  const k = RANKS[ru.r], cx = ox + W / 2, cy = H * 0.42;
  const e = Math.min(1, ru.age / 0.3), s = 0.7 + 0.3 * (1 - Math.pow(1 - e, 3));
  g.fillStyle = `rgba(0,10,30,${0.5 * e})`; g.fillRect(0, 0, innerWidth, innerHeight);
  drawConfetti();
  g.save();
  g.globalAlpha = e;
  g.translate(cx, cy); g.scale(s, s);
  card(-(W - 64) / 2, -110, W - 64, 230, 24);
  T('🎉', 0, -58, 40, 400, M.text, 'center');
  T('등급이 올랐어요', 0, -16, 16, 700, M.sub, 'center');
  T(k.name, 0, 26, 34, 800, RANK_C[ru.r], 'center');
  T(`자산 ${kor(k.min)}원 돌파`, 0, 54, 14, 600, M.sub, 'center');
  if (ru.lev) chip(`🔓 ${ru.lev}배 레버리지 해금`, 0, 92, M.red, M.redBg, 'center', 14);
  else if (ru.age > 0.8) T('탭해서 계속', 0, 90, 13, 600, M.faint, 'center');
  g.restore();
}

// 홈에서 레버리지 칸을 누르면 선택만 (시작은 아래 파란 버튼)
cv.addEventListener('pointerdown', e => {
  if (state !== 'menu') return;
  const b = hit(e.clientX, e.clientY);
  if (!b || b.act !== 'sel') return;
  if (b.lev > maxLev(C.money)) { tone(120, 0.12, 'square', 0.05); return; }
  lastLev = b.lev;
  tone(880, 0.05, 'sine', 0.04);
});
