'use strict';
// 선물 러시 — 60초 가상 지수 선물 롱숏 아케이드 데모.
// 지수·뉴스·기관은 모두 가상이며 실제 시장·인물과 관계없습니다.

const ROUND = 60;            // 한 판 60초 고정 (자산이 늘어도 길어지지 않음)
const TICK = 0.1;            // 시세는 0.1초마다 움직임
const HIST = 150;            // 화면에 보이는 15초
// 거래 비용 (플레이테스트 후 여기서만 조정)
const COST = {
  fee: 0.001,            // 수수료: 체결 금액(계약금액)의 0.1%, 진입·추가·해제·청산 매번
  slipTicks: [1, 2],     // 시장가 슬리피지: 1~2틱 불리하게 체결
  tickSize: 0.05,        // 지수 1틱 크기
};
const START_MONEY = 1000000; // 처음 자금 100만 원 (판이 끝나도 이어짐)
const MIN_MONEY = 100000;    // 최소 증거금: 이 아래로 떨어지면 깡통 = 게임 오버
const OPEN = 350;            // 시작 지수
const LIQ = 0.3;             // 증거금 30% 손실 시 강제청산 (10배면 지수 3% 역행)
const CB_DROP = -0.04;       // 시가 대비 -4%면 서킷브레이커
const CB_HALT = 5;           // 5초 매매 정지
const INDEX = '한빛200';
const LEVS = [1, 5, 10, 20, 50, 100];
// ---------- 금리 (느린 변수: 추세 방향이 가격에 배경 흐름을 만든다) ----------
const RATE = {
  start: 5.0,            // 런 시작 금리(%)
  min: 3, max: 7,        // 움직이는 범위(%)
  noise: 0.00015,        // 0.1초마다 금리 속도에 더해지는 흔들림(%p)
  damp: 0.985,           // 속도 감쇠 (클수록 추세가 오래 감)
  newsJump: [0.15, 0.3], // 금리 뉴스 한 번에 점프(%p) — 긴급은 1.5배
  newsPush: 0.002,       // 점프 뒤 같은 방향으로 이어지는 속도(%p/0.1초)
  trendSecs: 8,          // 추세 판정 구간: 최근 8초 변화
  flat: 0.03,            // 8초 변화가 이보다 작으면 횡보(%p)
  bias: 0.00004,         // 추세가 만드는 가격 흐름(0.1초당, 약 0.04%/초) — 뉴스보다 약함
};
// 금리 관련 뉴스인지, 어느 쪽인지 (+1 인상, -1 인하)
function rateNewsDir(text) {
  if (!/금리|긴축|완화|유동성|양적완화/.test(text)) return 0;
  if (/인상|긴축|회수/.test(text)) return 1;
  if (/인하|완화|공급|양적완화/.test(text)) return -1;
  return 0;
}
function rateTick() {
  const rg = state === 'play' && G.t > ROUND / 2 ? C.regimeNext : G.regime; // 후반 금리 흐름 = 다음 판 레짐 힌트
  const k = rg === 'range' ? { n: 0.5, d: 0.95 } : { n: 1.2, d: RATE.damp + 0.005 };
  G.rateVel = G.rateVel * k.d + randn() * RATE.noise * k.n;
  G.rate = Math.max(RATE.min, Math.min(RATE.max, G.rate + G.rateVel));
  if ((G.rate <= RATE.min && G.rateVel < 0) || (G.rate >= RATE.max && G.rateVel > 0)) G.rateVel *= -0.5;
  G.rateHist.push(G.rate);
  if (G.rateHist.length > RATE.trendSecs / TICK) G.rateHist.shift();
}
// 추세: +1 상승 중, -1 하락 중, 0 횡보 (금리 수준이 아니라 최근 변화 방향)
function rateTrend() {
  const d = G.rate - G.rateHist[0];
  return Math.abs(d) < RATE.flat ? 0 : Math.sign(d);
}
function rateJump(dir, big) {
  const j = rand(RATE.newsJump[0], RATE.newsJump[1]) * (big ? 1.5 : 1);
  G.rate = Math.max(RATE.min, Math.min(RATE.max, G.rate + dir * j));
  G.rateVel = dir * RATE.newsPush;
}

// ---------- 휩쏘 엔진: 습관을 노리되, 배울 수 있는 패턴으로만 ----------
// 공정성: 플레이어의 진입가·청산가는 읽지 않음. 시장 레벨(최근 고저점·반올림 숫자)과 행동 패턴만 이용.
// 모든 휩쏘는 뉴스 위에 '더해지는' 별도 움직임(G.ws)이라 차트에 윅·되돌림 흔적으로 남는다.
const WS = {
  // (1) 진입 직후 흔들기
  shakeChance: 0.45, shakeSize: [0.003, 0.005], shakeSecs: 0.6, shakeBackSecs: 0.9,
  // (2) 스파이크 후 되돌림 ([속보]/[긴급] 움직임의 30~50%)
  retrace: [0.3, 0.5], retraceDelay: 0.3, retraceSecs: 2.5,
  // (3) 레벨 사냥 윅 (최근 고저점·반올림 숫자까지 찍고 복귀)
  wickPerSec: 0.05, wickMin: 0.0015, wickMax: 0.008, wickOver: [0.0003, 0.0008], wickInSecs: 0.4, wickOutSecs: 0.7, wickBack: [0.8, 1.0],
  // (4) 탐욕 패널티
  greedPct: 0.15, greedSecs: 5, greedPerSec: 0.08, greedSize: [0.006, 0.01], greedRevSecs: 1.5,
  // (5) 연승 뒤 역풍
  streakBoost: 1.4,
  // (6) 횡보장
  rangeNews: 0.5, rangeRetrace: [0.85, 1.0], rangePull: 3,
  // 레짐 순환
  regimeSwitch: 0.15, regimeBack: 0.45, regimeStreak: 0.1, // 추세→횡보 15%, 횡보→추세 45% (횡보장은 짧게), 연승마다 +10%p
  // 승률 리듬: 최근 20스택 승률이 범위를 벗어나면 휩쏘 빈도 조정
  winLo: 0.45, winHi: 0.55, winUp: 1.3, winDown: 0.65, winWindow: 20,
  // 큰 손실 다음 판은 대체로 공정하게
  bigLoss: -0.15, afterLossEase: 0.7,
  // 니어미스: 정리 직후 반전 ('제때 나왔구나')
  exitReverse: 0.22, exitRevSize: [0.004, 0.007], exitRevSecs: 1.5,
  // 복수매매 함정
  sucker: 0.25, suckerUp: 0.006, suckerUpSecs: 4, suckerDown: 0.018, suckerDownSecs: 3,
};
// 난이도: 플레이어가 체감하는 변동성에만 곱하는 배율 (보스·블레싱·수수료·규칙은 같음)
//  ws    = 휩쏘 6종 + 적응 엔진 강도 (되돌림 비율·흔들기 깊이·윅/탐욕 빈도·연승 역풍·횡보장 빈도)
//  noise = 뉴스 없는 구간의 기본 가격 노이즈
//  boss  = 보스 위력(즉시 충격 폭·지속 드리프트) — 등장 확률·쿨다운은 같음
const DIFF = { easy: { ws: 0.3, noise: 0.7, boss: 0.6 }, normal: { ws: 1.0, noise: 1.0, boss: 1.0 } };
const DIFF_LABEL = { easy: ['쉬움', '실전보다 쉬워요'], normal: ['보통', '실전 난이도'] };
const DK = () => (G && G.diffK) || 1;          // 휩쏘 배율
const DN = () => (G && G.noiseK) || 1;         // 노이즈 배율
const DB = () => (G && G.bossK) || 1;          // 보스 위력 배율

// 습관 적응: 패턴이 쌓일수록 서서히 그 습관을 노리는 휩쏘가 강해짐
const ADAPT = { strength: 0.8, alpha: 0.12, flipAlpha: 0.25 };

const clamp01 = v => Math.max(0, Math.min(1, v));
function winRate() {
  const r = C.recent || [];
  return r.length >= 6 ? r.reduce((a, b) => a + b, 0) / r.length : null;
}
function wsMult(kind) {
  if (G.blessed) return 1; // 구제 라운드: 적응형 난이도 쉼
  let m = 1;
  if (C.streak >= 3) m *= 1 + (WS.streakBoost - 1) * DK();
  const wr = winRate();
  if (wr !== null) m *= wr > WS.winHi ? 1 + (WS.winUp - 1) * DK() : wr < WS.winLo ? WS.winDown : 1;
  if (G.afterBigLoss) m *= WS.afterLossEase;
  const h = C.hab, A = ADAPT.strength * DK();
  if (kind === 'retrace') m *= 1 + A * clamp01((h.chase - 0.3) / 0.4);
  if (kind === 'greed') m *= 1 + A * clamp01(h.hold / 10);
  if (kind === 'range') m *= 1 + A * clamp01((h.flip - 3) / 5); // 판당 3번 넘게 뒤집으면
  if (kind === 'shake' || kind === 'wick') m *= 1 + A * clamp01((h.max - 0.3) / 0.5);
  return m;
}
const ema = (old, v, a) => old + (v - old) * a;
// 휩쏘 움직임 하나 추가: total = 그 시간 동안 누적 변화율
function wsPush(from, secs, total) {
  G.ws.push({ from, until: from + secs, trend: Math.pow(1 + total, TICK / secs) - 1 });
}
function wsTrend() {
  G.ws = G.ws.filter(w => G.t < w.until);
  return G.ws.reduce((a, w) => a + (G.t >= w.from ? w.trend : 0), 0);
}

// 라운드 시작: 레짐 결정 (지난 판 후반 금리 흐름이 미리 힌트를 줌)
function planRegime() {
  G.regime = C.regimeNext || 'trend';
  let p = (G.regime === 'trend' ? WS.regimeSwitch : WS.regimeBack) + WS.regimeStreak * Math.min(C.streak, 3);
  if (G.regime === 'trend') p *= wsMult('range') * DK(); // 횡보장 빈도
  C.regimeNext = Math.random() < Math.min(0.8, p) ? (G.regime === 'trend' ? 'range' : 'trend') : G.regime;
}

// 매 틱: 되돌림·윅·탐욕 판정
function engineTick() {
  if (G.pos) G.pos.holdSecs = (G.pos.holdSecs || 0) + TICK;
  if (G.boss) return;
  // (2) 뉴스 스파이크 뒤 되돌림
  const tk = G.track;
  if (tk && !tk.done) {
    if (tk.p0 === null && G.t >= tk.seg.from) tk.p0 = G.price;
    if (tk.p0 !== null && G.t >= tk.seg.until) {
      tk.done = true;
      const move = G.price / tk.p0 - 1;
      const frac = G.blessed ? rand(BLESS.retrace[0], BLESS.retrace[1]) : DK() * (G.regime === 'range' ? rand(WS.rangeRetrace[0], WS.rangeRetrace[1])
        : Math.min(0.75, rand(WS.retrace[0], WS.retrace[1]) * wsMult('retrace')));
      wsPush(G.t + WS.retraceDelay, WS.retraceSecs, -move * frac);
    }
  }
  // (3) 레벨 사냥 윅
  if (!G.blessed && G.t > (G.wickUntil || 0) && Math.random() < WS.wickPerSec * DK() * TICK * wsMult('wick') * (G.regime === 'range' ? 1.5 : 1)) {
    const recent = G.hist.slice(-HIST), hi = Math.max(...recent), lo = Math.min(...recent);
    const lv = [hi, lo, Math.ceil(G.price), Math.floor(G.price), Math.ceil(G.price / 5) * 5, Math.floor(G.price / 5) * 5]
      .filter(v => { const d = Math.abs(v / G.price - 1); return d >= WS.wickMin && d <= WS.wickMax; });
    if (lv.length) {
      const target = pick(lv), dir = Math.sign(target - G.price);
      const depth = Math.abs(target / G.price - 1) + rand(WS.wickOver[0], WS.wickOver[1]);
      wsPush(G.t, WS.wickInSecs, dir * depth);
      wsPush(G.t + WS.wickInSecs, WS.wickOutSecs, -dir * depth * rand(WS.wickBack[0], WS.wickBack[1]));
      G.wickUntil = G.t + WS.wickInSecs + WS.wickOutSecs + 2;
    }
  }
  // (4) 탐욕 패널티: 큰 미실현 수익을 오래 들고 있으면 반전
  if (G.pos) {
    const r = unreal() / posMargin();
    if (r > 0) G.pos.profitSecs += TICK;
    G.pos.greedT = r > WS.greedPct ? G.pos.greedT + TICK : 0;
    if (!G.blessed && G.pos.greedT > WS.greedSecs && Math.random() < WS.greedPerSec * DK() * TICK * wsMult('greed')) {
      wsPush(G.t, WS.greedRevSecs, -G.pos.dir * rand(WS.greedSize[0], WS.greedSize[1]));
      G.pos.greedT = -6; // 같은 보유에 연달아 걸리지 않게
    }
  }
}

// 진입·추가 때: (1) 흔들기, 습관 기록, (7) 복수매매 함정
function engineOnAdd(side, isNew) {
  const n = G.news;
  if (isNew) {
    const age = n ? G.t - n.at : 0; // 게임 시계 기준 뉴스 경과 시간
    const late = n && (n.kind === 'news' || n.kind === 'bomb') && n.dir === side && age > 1.2 && age < 5 ? 1 : 0;
    C.hab.chase = ema(C.hab.chase, late, ADAPT.alpha);
    if (G.lastDir && G.lastDir !== side) G.flips += 1;
    G.lastDir = side;
    G.entries += 1;
    if (n && (n.kind === 'news' || n.kind === 'bomb') && n.dir === side && age > 2 && age < 6) G.late2 += 1; // 분석: 뉴스 2초 뒤 진입
    if (G.blessed && !G.blessDir) G.blessDir = side;
  }
  if (G.pos) G.pos.maxUnits = Math.max(G.pos.maxUnits || 0, posUnits());
  const maxed = G.lev >= maxLev(C.money) && posUnits() >= G.cap ? 1 : 0;
  C.hab.max = ema(C.hab.max, maxed || (G.lev >= maxLev(C.money) ? 0.5 : 0), ADAPT.alpha);
  // 분석: 큰 손실 직후 10초 안에 최대 스택까지 쌓거나, 직전 판보다 레버리지를 올려 재진입
  if (G.afterBigLoss && G.t < 10 && ((G.cap > 1 && posUnits() >= G.cap) || G.lev > (C.lastRoundLev || G.lev))) G.revenged = true;
  if (G.boss || G.blessed || state !== 'play') return;
  if (Math.random() < Math.min(0.85, WS.shakeChance * DK() * wsMult('shake'))) {
    const sz = rand(WS.shakeSize[0], WS.shakeSize[1]) * DK();
    wsPush(G.t, WS.shakeSecs, -side * sz);
    wsPush(G.t + WS.shakeSecs, WS.shakeBackSecs, side * sz);
  }
  const aggressive = G.lev >= maxLev(C.money) || posUnits() >= G.cap;
  if (G.afterBigLoss && !G.suckerRolled && G.t < 10 && aggressive) {
    G.suckerRolled = true;
    if (Math.random() < WS.sucker * DK()) {
      // 쉬워 보이는 판: 그 방향 뉴스 + 부드러운 추세, 그리고 강한 반전
      showNews(`[속보] ${freshPick(side > 0 ? NEWS_GOOD : NEWS_BAD)}`, 'news', side);
      wsPush(G.t + 0.3, WS.suckerUpSecs, side * WS.suckerUp);
      wsPush(G.t + 0.3 + WS.suckerUpSecs, WS.suckerDownSecs, -side * WS.suckerDown);
      G.nextNews = G.t + 9;
    }
  }
}

// 스택 정리 때: 통계, 보유 습관, 니어미스(정리 직후 반전)
function engineOnClose(pos, net, byPlayer) {
  C.recent = (C.recent || []).concat(net > 0 ? 1 : 0).slice(-WS.winWindow);
  if (net > 0) { G.stW += 1; G.sumW += net; C.stats.w += 1; C.stats.sw += net; } else { G.stL += 1; G.sumL += net; C.stats.l += 1; C.stats.sl += net; }
  if (net > 0) C.hab.hold = ema(C.hab.hold, pos.profitSecs || 0, ADAPT.alpha);
  if (net > 0) { G.holdW += pos.holdSecs || 0; G.nW += 1; } else { G.holdL += pos.holdSecs || 0; G.nL += 1; }
  G.stackSum += pos.maxUnits || 1; G.stackN += 1;
  if (byPlayer && !G.boss && !G.blessed && state === 'play' && !G.ending && G.t < ROUND - 3 && Math.random() < WS.exitReverse * DK()) {
    wsPush(G.t + 0.2, WS.exitRevSecs, -pos.dir * rand(WS.exitRevSize[0], WS.exitRevSize[1]));
  }
}


// ---------- 숨은 구제 라운드: 3~5판마다 한 번, 가격 경로만 유리하게 기울임 (화면 어디에도 표시 안 함) ----------
const BLESS = {
  gap: [3, 5],           // 다음 구제 라운드까지 간격 (매번 새로 뽑음)
  retrace: [0.10, 0.15], // 스파이크 되돌림 비율 (평소 30~50%)
  drift: 0.00011,        // 첫 진입 방향으로 흐르는 우세 드리프트 (0.1초당, 포지션 있을 때만)
  newsBoost: 1.4,        // [속보]/[긴급] 움직임 배율 (뉴스가 더 잘 먹힘, [소문]은 그대로)
};
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function planBless() {
  if (!(C.blessIn > 0)) C.blessIn = randInt(BLESS.gap[0], BLESS.gap[1]);
  C.blessIn -= 1;
  G.blessed = C.blessIn <= 0;
  if (!G.blessed) return;
  C.blessIn = randInt(BLESS.gap[0], BLESS.gap[1]);
  G.bossAt = null;       // 보스 없음
  G.regime = 'trend';    // 횡보장 없음 (다음 판 레짐 계획은 그대로)
}

// ---------- 트레이더 분석 (로컬 저장, 자본금 리셋과 별개로 유지) ----------
const PROF_KEY = 'futures-profile-v1';
const ANA_WINDOW = 20;   // 성향은 최근 20판 기준
let P = { rounds: 0, wins: 0, sumWinR: 0, sumLossR: 0, fees: 0, slip: 0, peak: 1, liqs: 0, mcs: 0, kills: 0,
  maxWS: 0, maxLS: 0, ws: 0, ls: 0, recent: [], arch: null, prevArch: null,
  diff: 'easy', playedNormal: false, nudgeSeen: false, nudgePending: false };
try { const s = JSON.parse(localStorage.getItem(PROF_KEY)); if (s && typeof s.rounds === 'number') P = Object.assign(P, s); } catch (e) { /* 저장 불가 */ }
function saveProfile() { try { localStorage.setItem(PROF_KEY, JSON.stringify(P)); } catch (e) { /* 무시 */ } }

// 판이 끝날 때 한 줄 기록 (휩쏘 엔진이 이미 세던 값들을 판 단위로 묶음)
function recordRound(mc) {
  const profit = G.money - G.startMoney, rate = profit / G.startMoney;
  P.rounds += 1;
  if (profit > 0) { P.wins += 1; P.sumWinR += rate; P.ws += 1; P.ls = 0; } else { P.sumLossR += rate; P.ls += 1; P.ws = 0; }
  P.maxWS = Math.max(P.maxWS, P.ws); P.maxLS = Math.max(P.maxLS, P.ls);
  P.fees += G.fees; P.slip += G.slip; P.liqs += G.liqs; if (mc) P.mcs += 1; if (G.bossSlain) P.kills += 1;
  P.peak = Math.max(P.peak, C.runPeak || 1);
  P.recent.push({ rate, lev: G.lev, units: G.stackN ? G.stackSum / G.stackN : 1, stacks: G.stackN, entries: G.entries, late: G.late2,
    holdW: G.holdW, nW: G.nW, holdL: G.holdL, nL: G.nL, flips: G.flips, revenge: G.afterBigLoss ? (G.revenged ? 1 : 0) : null,
    trades: G.trades, feeR: G.fees / G.startMoney });
  if (P.recent.length > ANA_WINDOW) P.recent.shift();
  const a = analyze();
  if (a && a.key !== P.arch) { P.prevArch = P.arch; P.arch = a.key; }
  saveProfile();
}
// 자본금 리셋: 전적은 남기고 '최근 20판'만 새로 쌓음
function resetRecent() { P.recent = []; saveProfile(); }

const ARCH = {
  revenge: { t: '복수의 화신', s: '잃은 건 바로 되찾아야 직성이 풀린다' },
  chase: { t: '추격자', s: '뉴스 꽁무니를 쫓는 사람' },
  hold: { t: '존버러', s: '손실은 언젠가 돌아온다고 믿는다' },
  flip: { t: '갈대', s: '바람 부는 대로 흔들린다' },
  aggr: { t: '돌격대장', s: '레버리지는 높을수록 좋다' },
  sniper: { t: '저격수', s: '한 발, 한 방' },
  all: { t: '올라운더', s: '어느 쪽으로도 치우치지 않는다' },
};
const LV_NAME = ['낮음', '중간', '높음'];
function analyze() {
  const R = P.recent;
  if (R.length < 3) return null;
  const n = R.length, sum = f => R.reduce((a, r) => a + f(r), 0);
  const lev = sum(r => r.lev) / n;
  const stacks = sum(r => r.stacks), units = stacks ? sum(r => r.units * r.stacks) / stacks : 1;
  const aggr = lev / 10 + (units - 1) / 2;
  const ent = sum(r => r.entries), chase = ent ? sum(r => r.late) / ent : 0;
  const nW = sum(r => r.nW), nL = sum(r => r.nL);
  const hw = nW ? sum(r => r.holdW) / nW : 0, hl = nL ? sum(r => r.holdL) / nL : 0;
  const holdR = hw > 0 && hl > 0 ? hl / hw : 1;
  const flips = sum(r => r.flips) / n;
  // 복수매매: 큰 손실 직후 판의 공격성이 평소 자기 공격성보다 얼마나 높은가
  const aggrOf = r => r.lev / 10 + ((r.units || 1) - 1) / 2, mean = xs => xs.reduce((x, y) => x + y, 0) / xs.length;
  const rv = R.filter(r => r.revenge !== null), base = R.filter(r => r.revenge === null);
  const revenge = rv.length >= 2 && base.length >= 2 ? mean(rv.map(aggrOf)) / Math.max(0.05, mean(base.map(aggrOf))) : 1;
  const W = R.filter(r => r.rate > 0), L = R.filter(r => r.rate <= 0);
  const wr = W.length / n, avgW = W.length ? W.reduce((a, r) => a + r.rate, 0) / W.length : 0, avgL = L.length ? L.reduce((a, r) => a + r.rate, 0) / L.length : 0;
  const trades = sum(r => r.trades) / n, net = R.reduce((a, r) => a * (1 + r.rate), 1) - 1;
  const feeSum = sum(r => r.feeR), feeShare = feeSum / Math.max(1e-9, W.reduce((a, r) => a + r.rate, 0) + feeSum);
  const lvl = (v, a, b) => v < a ? 0 : v < b ? 1 : 2;
  const axes = [
    { key: 'aggr', name: '공격성', lv: lvl(aggr, 0.6, 1.15), val: `평균 ${lev.toFixed(1)}배 · ${units.toFixed(1)}단`, score: aggr / 1.15 },
    { key: 'chase', name: '추격도', lv: lvl(chase, 0.2, 0.4), val: `늦은 진입 ${Math.round(chase * 100)}%`, score: chase / 0.4 },
    { key: 'hold', name: '보유 성향', lv: nW && nL ? lvl(holdR, 1.0, 1.6) : 0, val: nW && nL ? `손실 ${hl.toFixed(1)}초 / 수익 ${hw.toFixed(1)}초` : '데이터 부족', score: nW && nL ? holdR / 1.6 : 0 },
    { key: 'flip', name: '뒤집기', lv: lvl(flips, 1.5, 3), val: `판당 ${flips.toFixed(1)}회`, score: flips / 3 },
    { key: 'revenge', name: '복수매매', lv: lvl(revenge, 1.1, 1.3), val: rv.length ? `큰 손실 뒤 공격성 ${revenge.toFixed(1)}배 (${rv.length}판)` : '큰 손실 없음', score: revenge / 1.3 },
  ];
  const highs = axes.filter(a => a.lv === 2).sort((a, b) => b.score - a.score);
  const key = highs.length ? highs[0].key : lev <= 5 && trades <= 3 && wr >= 0.55 ? 'sniper' : 'all';
  return { n, axes, key, wr, avgW, avgL, net, lev, units, chase, hw, hl, holdR, flips, revenge, rvN: rv.length, feeShare, nW, nL };
}
// 한 줄 진단: 가장 심각한 문제 하나만
function diagnose(a) {
  if (!a) return '3판만 해 보세요. 그다음부터 매매 습관을 읽어 드려요.';
  const ax = k => a.axes.find(x => x.key === k).lv === 2;
  if (a.avgL < 0 && a.avgW > 0 && -a.avgL >= 2 * a.avgW) return `손실이 수익의 ${(-a.avgL / a.avgW).toFixed(1)}배예요. 손절은 빨리, 수익은 길게 가져가 보세요.`;
  if (a.wr >= 0.55 && a.net < 0) return `${Math.round(a.wr * 100)}% 이기는데 돈은 줄었어요. 한 번의 큰 손실이 문제예요. 레버리지를 낮춰 보세요.`;
  if (ax('revenge')) return '큰 손실 직후엔 한 판 쉬어 보세요. 복수매매가 돈을 빼먹고 있어요.';
  if (ax('chase')) return `진입의 ${Math.round(a.chase * 100)}%가 뉴스 2초 뒤예요. 2초 지나면 들어가지 마세요. 이미 늦었어요.`;
  if (ax('flip')) return `판당 ${a.flips.toFixed(1)}번 뒤집어요. 수수료가 쌓이는 중이에요. 확신이 설 때만 들어가 보세요.`;
  if (ax('hold')) return `손실은 ${a.hl.toFixed(1)}초, 수익은 ${a.hw.toFixed(1)}초 들고 있어요. 손절선부터 정하고 들어가세요.`;
  if (ax('aggr')) return `평균 ${a.lev.toFixed(0)}배에 ${a.units.toFixed(1)}단이에요. 휩쏘 한 번에 판이 흔들려요. 한 단계만 낮춰 보세요.`;
  if (a.feeShare >= 0.5) return `수수료가 벌어들인 돈의 ${Math.round(a.feeShare * 100)}%를 가져가요. 매매 횟수를 줄여 보세요.`;
  if (a.net > 0) return `최근 ${a.n}판 ${pctText(a.net)}. 지금 규칙이 통하고 있어요. 그대로 지키세요.`;
  return `최근 ${a.n}판 ${pctText(a.net)}. 큰 구멍은 없어요. 태그를 한 번 더 보고 들어가세요.`;
}
function archText() {
  const cur = P.arch ? ARCH[P.arch].t : '분석 중';
  return P.prevArch && P.arch && P.prevArch !== P.arch ? `${ARCH[P.prevArch].t} → ${cur}` : cur;
}
function allTimeLine() {
  const l = P.rounds - P.wins;
  const wr = P.rounds ? Math.round(P.wins / P.rounds * 100) : 0;
  const aw = P.wins ? pctText(P.sumWinR / P.wins) : '-', al = l ? pctText(P.sumLossR / l) : '-';
  return `${P.rounds}판 · 승률 ${wr}% · 평균 ${aw} / ${al}`;
}
function statItems() {
  const l = P.rounds - P.wins;
  return [['총 거래', `${P.rounds}판`], ['승률', `${P.rounds ? Math.round(P.wins / P.rounds * 100) : 0}%`],
    ['평균 수익', P.wins ? pctText(P.sumWinR / P.wins) : '-'], ['평균 손실', l ? pctText(P.sumLossR / l) : '-'],
    ['총 수수료', `${kor(P.fees)}원`], ['총 슬리피지', `${kor(P.slip)}원`],
    ['최고 자본금', `${P.peak.toFixed(1)}배`], ['현재 자본금', `${kor(C.money)}원`],
    ['최대 연속 이익', `${P.maxWS}판`], ['최대 연속 손실', `${P.maxLS}판`],
    ['강제청산', `${P.liqs}회`], ['마진콜', `${P.mcs}회`], ['보스 처치', `${P.kills}회`]];
}
// 줄바꿈 (현재 g.font 기준)
function wrapLines(text, maxW) {
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// 로비 요약 카드 (네온)
function drawAnaCard(x, y, w) {
  const h = 92, a = analyze();
  glass(x, y, w, h, 16, 0.55, GOLD);
  g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = font(12, 700);
  g.fillText('트레이더 분석 ›', x + 14, y + 22);
  g.textAlign = 'right'; g.fillStyle = GOLD; g.font = font(15, 900);
  g.fillText(archText(), x + w - 14, y + 23);
  g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = font(12, 600);
  g.fillText(allTimeLine(), x + 14, y + 44);
  g.fillStyle = '#fff'; g.font = font(13, 700);
  wrapLines('💬 ' + diagnose(a), w - 28).slice(0, 2).forEach((t, i) => g.fillText(t, x + 14, y + 66 + i * 18));
  G.buttons.push({ x, y, w, h, act: 'ana' });
  return h;
}
// 상세 분석 화면 (네온)
function drawAnalysis() {
  const x = ox + 16, w = W - 32, cx = ox + W / 2, a = analyze(), rh = H < 720 ? 24 : 29;
  g.fillStyle = 'rgba(5,6,24,0.94)'; g.fillRect(0, 0, innerWidth, innerHeight);
  g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = font(22, 900);
  g.fillText('트레이더 분석', x, 40);
  g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = font(12, 600);
  g.fillText(a ? `성향: 최근 ${a.n}판 · 전적: 누적` : '전적: 누적', x + w, 40);
  let y = 56;
  glass(x, y, w, 74, 16, 0.6, GOLD);
  g.textAlign = 'center'; g.fillStyle = GOLD; g.font = font(24, 900);
  g.fillText(archText(), cx, y + 34);
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = font(12, 600);
  g.fillText(P.arch ? ARCH[P.arch].s : '3판부터 성향이 나와요', cx, y + 56);
  y += 84;
  g.font = font(13, 700);
  const dl = wrapLines('💬 ' + diagnose(a), w - 28).slice(0, 2);
  glass(x, y, w, 22 + dl.length * 18, 14, 0.6, ORANGE);
  g.textAlign = 'left'; g.fillStyle = '#fff';
  dl.forEach((t, i) => g.fillText(t, x + 14, y + 25 + i * 18));
  y += 32 + dl.length * 18;
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = font(12, 800);
  g.fillText('성향', x + 4, y + 4);
  y += 12;
  const axes = a ? a.axes : [];
  if (!axes.length) { g.fillStyle = 'rgba(255,255,255,0.4)'; g.font = font(12, 600); g.fillText('아직 데이터가 부족해요', x + 4, y + 18); y += rh; }
  axes.forEach(ax => {
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = font(13, 700);
    g.fillText(ax.name, x + 4, y + 18);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i <= ax.lv ? [CYAN, GOLD, ALERT][ax.lv] : 'rgba(255,255,255,0.1)';
      roundRect(x + 80 + i * 26, y + 8, 22, 10, 4); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = font(11, 700);
    g.fillText(LV_NAME[ax.lv], x + 162, y + 18);
    g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = font(11, 600);
    g.fillText(ax.val, x + w - 4, y + 18);
    y += rh;
  });
  y += 10;
  g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = font(12, 800);
  g.fillText('전적', x + 4, y + 4);
  y += 10;
  const items = statItems(), cw = (w - 10) / 2;
  items.forEach(([k, v], i) => {
    const bx = x + (i % 2) * (cw + 10), by = y + Math.floor(i / 2) * rh;
    g.fillStyle = 'rgba(255,255,255,0.05)'; roundRect(bx, by + 2, cw, rh - 4, 8); g.fill();
    g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = font(11, 600);
    g.fillText(k, bx + 10, by + rh / 2 + 4);
    g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = font(13, 800);
    g.fillText(v, bx + cw - 10, by + rh / 2 + 5);
  });
  y += Math.ceil(items.length / 2) * rh + 8;
  G.buttons = [];
  button(x, Math.min(y, H - 56), w, 44, CYAN, '#00151a', '돌아가기', 'back');
}

// ---------- 보스 뉴스 (희귀·치명: 보유 포지션 반대로 '즉시 충격 + 지속 출혈') ----------
const BOSS = {
  chance: 0.13,          // 라운드당 기본 등장 확률
  cooldown: 4,           // 등장 후 최소 이만큼 라운드는 쉼
  grace: 2,              // 런 시작 후 처음 이만큼 라운드는 없음
  wMilestone: 1.8,       // 직전 라운드에 마일스톤 달성 시 확률 배수
  wStreak: 1.6,          // 3연속 이익 뒤 확률 배수
  window: [12, 42],      // 이 초 사이 어느 순간 노림 (포지션 없으면 생길 때까지 대기)
  lastCall: 8,           // 마감 이 초 전부터는 새로 발동하지 않음
  // 충격은 상처, 드리프트가 처형: 기준 레버리지의 강제청산 거리를 나눠 맡음
  refLev: 10,            // 기준 레버리지
  shockRatio: 0.6,       // 충격 = 기준 레버리지 청산 거리의 60% (충격만으론 청산 안 됨)
  shockSecs: 1.0,        // 충격이 걸리는 시간
  killSecs: 4,           // 버티면 나머지 40%를 이 초 안에 밀어 청산가 도달
  shakeSecs: 1.5,        // 발동 직후 흔들림 시간
  shakePx: 4,            // 흔들림 폭 (작게: 버튼을 누를 수 있게)
  tint: 0.22,            // 흔들릴 때 화면을 물들이는 붉은빛 농도
  vignette: 0.32,        // 이후 라운드 끝까지 남는 가장자리 붉은빛 농도
};
// 청산 거리 = LIQ × 증거금 / 계약금액 = LIQ / 레버리지 (unitLiq 식과 같음) → 10배면 3%
const BOSS_LIQ_DIST = LIQ / BOSS.refLev;
BOSS.shock = BOSS.shockRatio * BOSS_LIQ_DIST;                                      // 10배 기준 1.8%
BOSS.drift = Math.pow(1 + (1 - BOSS.shockRatio) * BOSS_LIQ_DIST, TICK / BOSS.killSecs) - 1; // 0.1초당 약 0.03%
const BOSS_CRASH = ['미국 금융위기 발생!', '세계대전 발발 위기!', '미국 초대형 은행 연쇄 파산!',
  '중국 경제 붕괴, 글로벌 패닉 확산!', '미국 정부 디폴트 선언!', '글로벌 대공황 공포, 전 세계 증시 폭락!'];
const BOSS_SURGE = ['연준 추가 금리인하 5회 예정!', '정부·한은, 지수 2배 이상 부양 선언!', '전쟁 종결 합의! 전 세계 축제!',
  '연준 10조 달러 양적완화 전격 단행!', '정부, 전 국민 주식 매수 자금 지원 발표!', '한은 기준금리 0% 전격 인하!'];

// 피라미딩 스택 상한: 라운드 시작 때 자산으로 정해지고 그 판 동안 고정 (100만 원 미만도 최소 2단)
const STACK_CAPS = [
  { min: 0, cap: 2 },
  { min: 5e6, cap: 3 },
  { min: 1e7, cap: 4 },
  { min: 5e7, cap: 5 },
];
function stackCap(m) { let c = STACK_CAPS[0].cap; for (const s of STACK_CAPS) if (m >= s.min) c = s.cap; return c; }
function nextCapText(m) {
  const n = STACK_CAPS.find(s => s.min > m);
  return n ? `${kor(n.min)}원 달성 시 ${n.cap}단 해금` : '최대 단수 해금 완료';
}
const UP = '#ff4d5e', DOWN = '#4d8dff', GOLD = '#ffd34d', CYAN = '#3ff0ff', RUMOR = '#c77dff', ALERT = '#ff2e2e';
const GREEN = '#5dff9a', ORANGE = '#ff9a3c';

// 칭호: 자산 규모로 정해지고, 오르면 더 센 레버리지가 풀린다
const RANKS = [
  { name: '개미', min: 0, c: '#aab4c8', lev: 10 },
  { name: '동학개미', min: 3e6, c: CYAN, lev: 10 },
  { name: '슈퍼개미', min: 1e7, c: GREEN, lev: 20 },
  { name: '큰손', min: 1e8, c: GOLD, lev: 20 },
  { name: '펀드매니저', min: 1e9, c: ORANGE, lev: 50 },
  { name: '헤지펀드 대표', min: 1e11, c: RUMOR, lev: 100 },
  { name: '전설의 트레이더', min: 1e13, c: UP, lev: 100 },
];
const ACHS = [
  { id: 'first', name: '첫 수익', desc: '수익을 내고 청산하기' },
  { id: 'streak3', name: '3연속 이익', desc: '3판 연속 이익으로 마감' },
  { id: 'streak5', name: '연승 행진', desc: '5판 연속 이익으로 마감' },
  { id: 'combo5', name: '콤보 x5', desc: '한 판에 5번 연속 수익 청산' },
  { id: 'survive', name: '구사일생', desc: '청산 직전(90%)까지 갔다가 살아남기' },
  { id: 'day50', name: '대박의 날', desc: '한 판에 +50% 이상' },
  { id: 'day100', name: '따블', desc: '한 판에 +100% 이상' },
  { id: 'cbshort', name: '폭락에 숏', desc: '서킷브레이커 때 숏을 들고 있기' },
  { id: 'contra', name: '역발상', desc: '[소문] 반대로 들어가서 수익' },
  { id: 'liq', name: '강제청산의 맛', desc: '처음으로 강제청산 당하기' },
  { id: 'broke', name: '깡통', desc: '계좌를 바닥내기' },
  { id: 'super', name: '슈퍼개미', desc: '자산 1,000만 원 달성' },
  { id: 'fund', name: '펀드매니저', desc: '자산 10억 원 달성' },
  { id: 'legend', name: '전설', desc: '자산 10조 원 달성' },
];

// 뉴스 풀: 상승·하락 같은 수, 분야별로 짝을 맞춤 (속보 48 + 긴급 16 + 소문 16 + 공식 16 = 96종)
const NEWS_GOOD = [
  // 금리·통화
  '중앙은행 기준금리 깜짝 인하', '중앙은행 총재 "추가 완화 열려 있다"', '시중 유동성 공급 확대 결정',
  // 수출·무역
  '수출 사상 최대 기록', '반도체 수출 두 자릿수 증가', '무역수지 8개월 연속 흑자', '대형 해외 수주 잇따라',
  // 정책·국회
  '정부 대규모 경기부양책 발표', '국회 증시 활성화 법안 통과', '증권거래세 인하 확정', '배당소득 분리과세 도입',
  // 수급
  '외국인 대규모 순매수', '연기금 국내 주식 비중 확대', '개인 투자자 예탁금 사상 최대',
  // 해외
  '해외 증시 일제히 급등', '주요국 경기지표 예상 상회', '해외 중앙은행 긴축 종료 시사',
  // 물가·경기
  '물가 상승률 예상치 하회', '고용 지표 깜짝 호조', '소비심리 지수 반등',
  // 신용·환율·기업
  '국가 신용등급 상향', '환율 급락, 원화 강세', '대표 기업 어닝 서프라이즈', '국제유가 급락, 비용 부담 완화',
];
const NEWS_BAD = [
  '중앙은행 기준금리 깜짝 인상', '중앙은행 총재 "추가 인상 불가피"', '시중 유동성 회수 본격화',
  '수출 3개월 연속 감소', '반도체 수출 급감', '무역수지 적자 전환', '대형 해외 수주 잇따라 취소',
  '국회 예산안 처리 무산', '증권거래세 인상 추진', '금융투자소득세 조기 시행', '대주주 양도세 기준 강화',
  '외국인 대규모 순매도', '연기금 국내 주식 비중 축소', '신용융자 반대매매 급증',
  '해외 증시 폭락', '주요국 경기 침체 진입 신호', '해외 중앙은행 추가 긴축 예고',
  '물가 상승률 예상치 상회', '실업률 급등', '소비심리 지수 급락',
  '국가 신용등급 하향 경고', '환율 급등, 원화 약세', '대표 기업 실적 쇼크', '국제유가 급등, 비용 부담 확대',
];
const BOMB_GOOD = ['접경지역 긴장 전격 해소', '해외 중앙은행 긴급 금리 인하', '정부 100조 증시 안정 기금 투입',
  '주요국과 무역 분쟁 전면 타결', '공매도 한시 금지 전격 발표', '세계 최대 지수에 국내 증시 편입 확정',
  '중앙은행 무제한 유동성 공급 선언', '휴전 협상 전격 타결'];
const BOMB_BAD = ['접경지역 무력 충돌 발생', '대형 금융사 파산 신청', '해외 대형 은행 지급 불능 선언',
  '주요국 전면 관세 부과 발표', '거래소 전산 장애로 주문 마비', '대형 건설사 연쇄 부도',
  '해외 증시 서킷브레이커 발동', '대규모 사이버 공격으로 금융망 마비'];
// 소문은 잠깐 그쪽으로 튀었다가 공식 발표로 뒤집힌다 (소문마다 부인 문구가 다름)
const RUMORS = [
  { text: '금리 인상설', dir: -1, off: '중앙은행 "이번 달 금리 동결"' },
  { text: '내각 총사퇴설', dir: -1, off: '총리실 "사실무근, 법적 대응"' },
  { text: '대형 증권사 부도설', dir: -1, off: '금융당국 "건전성 문제없음"' },
  { text: '외국인 자금 대거 이탈설', dir: -1, off: '거래소 "순유출 규모 미미"' },
  { text: '대표 기업 회계 부정설', dir: -1, off: '해당 기업 "명백한 허위 사실"' },
  { text: '긴급 증세설', dir: -1, off: '재정부처 "증세 계획 전혀 없어"' },
  { text: '해외 대형 펀드 청산설', dir: -1, off: '운용사 "정상 운용 중"' },
  { text: '거래소 해킹설', dir: -1, off: '거래소 "보안 이상 징후 없음"' },
  { text: '대규모 부양책 검토설', dir: 1, off: '정부 "검토한 바 없음"' },
  { text: '공매도 전면 금지설', dir: 1, off: '금융당국 "금지 계획 없다"' },
  { text: '해외 국부펀드 투자설', dir: 1, off: '해당 펀드 "투자 확정 아냐"' },
  { text: '깜짝 금리 인하설', dir: 1, off: '중앙은행 "논의된 적 없어"' },
  { text: '대표 기업 대형 인수설', dir: 1, off: '해당 기업 "인수 추진 안 해"' },
  { text: '세계 지수 편입 임박설', dir: 1, off: '지수 회사 "발표 일정 없음"' },
  { text: '접경지역 정상회담설', dir: 1, off: '당국 "추진 중인 회담 없어"' },
  { text: '배당 세금 폐지설', dir: 1, off: '국회 "법안 발의된 바 없음"' },
];

// 반복 방지: 같은 판 안에서 중복 금지, 직전 판에 나온 뉴스도 제외
const recent = { now: new Set(), last: new Set() };
function freshPick(list, key = x => x) {
  let c = list.filter(x => !recent.now.has(key(x)) && !recent.last.has(key(x)));
  if (!c.length) c = list.filter(x => !recent.now.has(key(x)));
  if (!c.length) c = list;
  const it = pick(c);
  if (state === 'play') recent.now.add(key(it));
  return it;
}
// 방향 주머니: 상승 4·하락 4를 섞어 차례로 꺼냄 → 출현 비율이 50:50에 붙어 있음
let dirBag = [];
function nextDir() {
  if (!dirBag.length) {
    dirBag = [1, 1, 1, 1, -1, -1, -1, -1];
    for (let i = dirBag.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [dirBag[i], dirBag[k]] = [dirBag[k], dirBag[i]]; }
  }
  return dirBag.pop();
}

const cv = document.getElementById('c');
const g = cv.getContext('2d');
let W, H, ox, dpr;
let state = 'menu';
let G = null;
let lastLev = 5;

// ---------- 경력 (판이 끝나도 이어지는 자산·기록) ----------
const SAVE_KEY = 'futures-career-v1';
function freshRun(c) {
  c.money = START_MONEY; c.curve = [START_MONEY]; c.rounds = 0; c.streak = 0; c.runRank = 0; c.runBest = START_MONEY;
  c.runMile = 0; c.runPeak = 1; // 자본금 2^k배 축하 기록, 이번 런 최고 배수
  c.bossLast = -99; c.mileRound = -99; c.rate = RATE.start;
  c.blessIn = 0; c.regimeNext = 'trend'; c.hab = { chase: 0.2, hold: 0, flip: 0, max: 0 }; c.recent = []; c.stats = { w: 0, l: 0, sw: 0, sl: 0 }; c.bigLossRound = -99; // 휩쏘 엔진의 런 기억 // 보스가 마지막으로 나온 라운드, 마일스톤을 달성한 라운드
  return c;
}
let C = freshRun({ best: START_MONEY, bestDay: 0, ach: {}, runs: 1, lastLev: 5 });
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.money > 0) C = Object.assign(C, s); } catch (e) { /* 저장 불가 */ }
if (C.money < MIN_MONEY) freshRun(C); // 깡통 상태로 닫았으면 새 도전
lastLev = C.lastLev || 5;
function saveCareer() {
  C.lastLev = lastLev;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(C)); } catch (e) { /* 무시 */ }
}
function rankIdx(m) { let r = 0; RANKS.forEach((k, i) => { if (m >= k.min) r = i; }); return r; }
function maxLev(m) { return RANKS[rankIdx(m)].lev; }
function unlockRank(lev) { return RANKS.find(k => k.lev >= lev); }
function fitLev(lev) { const mx = maxLev(C.money); return lev <= mx ? lev : LEVS.filter(l => l <= mx).pop(); }
// 큰 금액을 짧게: 3억, 1,200만
function kor(n) {
  if (n >= 1e12) { const v = n / 1e12; return (v >= 100 ? Math.round(v).toLocaleString('ko-KR') : +v.toFixed(1)) + '조'; }
  if (n >= 1e8) { const v = n / 1e8; return (v >= 100 ? Math.round(v).toLocaleString('ko-KR') : +v.toFixed(1)) + '억'; }
  if (n >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
  return Math.round(n).toLocaleString('ko-KR');
}
function unlockAch(id) {
  if (C.ach[id]) return;
  C.ach[id] = Date.now();
  const a = ACHS.find(x => x.id === id);
  if (G) { G.newAch.push(a); G.toasts.push({ text: `🏆 업적: ${a.name}`, life: 2.6 }); }
  tone(1047, 0.1, 'triangle', 0.06); tone(1568, 0.16, 'triangle', 0.06, null, 0.1);
  saveCareer();
}

// ---------- 유틸 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
function randn() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const won = n => Math.round(n).toLocaleString('ko-KR');
const sign = n => (n >= 0 ? '+' : '-') + won(Math.abs(n));
const pt = n => n.toFixed(2);
const pctText = r => (r >= 0 ? '+' : '') + (r * 100).toFixed(2) + '%';
const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';
const font = (px, w = 700) => `${w} ${px}px ${FONT}`;

function resize() {
  dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  cv.style.width = innerWidth + 'px';
  cv.style.height = innerHeight + 'px';
  W = Math.min(innerWidth, 520);
  H = innerHeight;
  ox = (innerWidth - W) / 2;
}
addEventListener('resize', () => { resize(); buildBg(); });
resize();

// ---------- 배경 (크기 바뀔 때 한 번만 그려 둠) ----------
let BG = null, BGQ = null;
function buildBg() { BG = paintBg(false); BGQ = paintBg(true); }
// calm = 플레이 중: 빛 번짐 30%, 캔들 워터마크 거의 안 보이게
function paintBg(calm) {
  const cvs = document.createElement('canvas');
  cvs.width = cv.width; cvs.height = cv.height;
  const b = cvs.getContext('2d');
  const k = calm ? 0.3 : 1;
  b.scale(dpr, dpr);
  const w = innerWidth, h = innerHeight;
  // 짙은 네이비 → 보라
  const lg = b.createLinearGradient(0, 0, w * 0.4, h);
  lg.addColorStop(0, '#081233'); lg.addColorStop(0.5, '#110f3c'); lg.addColorStop(1, '#2b0d4a');
  b.fillStyle = lg; b.fillRect(0, 0, w, h);
  // 빛 번짐
  const glow = (x, y, r, c) => {
    const rg = b.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = rg; b.fillRect(0, 0, w, h);
  };
  glow(w * 0.12, h * 0.08, h * 0.5, `rgba(63,240,255,${0.13 * k})`);
  glow(w * 0.95, h * 0.9, h * 0.6, `rgba(199,77,255,${0.20 * k})`);
  glow(w * 0.85, h * 0.35, h * 0.35, `rgba(255,77,94,${0.07 * k})`);
  glow(w * 0.1, h * 0.75, h * 0.35, `rgba(77,141,255,${0.10 * k})`);
  // 희미한 캔들 실루엣
  let p = h * 0.55;
  for (let x = -6; x < w + 12; x += 14) {
    const o = p, c = o + (Math.random() - 0.5) * 34;
    const hi = Math.min(o, c) - Math.random() * 16, lo = Math.max(o, c) + Math.random() * 16;
    const ca = calm ? 0.012 : 0.07;
    b.fillStyle = c < o ? `rgba(255,77,94,${ca})` : `rgba(77,141,255,${ca})`;
    b.fillRect(x + 4, hi, 1.5, lo - hi);
    b.fillRect(x, Math.min(o, c), 9, Math.max(2, Math.abs(c - o)));
    p = Math.max(h * 0.35, Math.min(h * 0.8, c));
  }
  // 점 격자 질감
  b.fillStyle = 'rgba(160,180,255,0.07)';
  for (let y = 10; y < h; y += 20) for (let x = 10; x < w; x += 20) b.fillRect(x, y, 1, 1);
  // 가장자리 어둡게
  const vg = b.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,10,0.45)');
  b.fillStyle = vg; b.fillRect(0, 0, w, h);
  return cvs;
}
buildBg();

// 반투명 유리 카드: 둥근 모서리, 그림자, 위쪽 광택, 빛나는 테두리
function glass(x, y, w, h, r = 16, a = 0.5, edge = CYAN) {
  g.save();
  g.shadowColor = 'rgba(0,0,12,0.55)'; g.shadowBlur = 24; g.shadowOffsetY = 8;
  g.fillStyle = `rgba(18,22,58,${a})`;
  roundRect(x, y, w, h, r); g.fill();
  g.restore();
  g.save();
  const sh = g.createLinearGradient(0, y, 0, y + h);
  sh.addColorStop(0, 'rgba(255,255,255,0.09)'); sh.addColorStop(0.35, 'rgba(255,255,255,0.02)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  roundRect(x, y, w, h, r); g.fill();
  const st = g.createLinearGradient(x, y, x + w, y + h);
  st.addColorStop(0, edge + '88'); st.addColorStop(0.45, 'rgba(255,255,255,0.08)'); st.addColorStop(1, 'rgba(199,77,255,0.45)');
  g.strokeStyle = st; g.lineWidth = 1.2;
  roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r); g.stroke();
  g.restore();
}

// 흐르는 티커 띠 (가상 종목)
const TICKERS = ['가온전자', '누리화학', '별빛금융', '한결바이오', '미르자동차', '다온건설', '새솔에너지', '푸른통신', '하늘항공', '바른제약']
  .map(n => ({ n, p: Math.round(rand(8, 120)) * 1000, c: rand(-3, 3) }));
let tickerX = 0, tickerNext = 0;
function drawTicker() {
  const y = H - 22, now = performance.now() / 1000;
  const live = state !== 'play';
  if (live && now > tickerNext) { tickerNext = now + 1.5; const t = pick(TICKERS); t.c = Math.max(-9, Math.min(9, t.c + rand(-0.6, 0.6))); }
  if (live) tickerX -= 0.6;
  g.save();
  g.fillStyle = 'rgba(6,8,28,0.8)';
  g.fillRect(-30, y, innerWidth + 60, 52);
  g.strokeStyle = 'rgba(63,240,255,0.3)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(-30, y + 0.5); g.lineTo(innerWidth + 30, y + 0.5); g.stroke();
  g.font = font(11, 700);
  g.textAlign = 'left';
  const idx = G ? G.price / OPEN - 1 : 0;
  const items = [{ n: INDEX, txt: (G ? G.price : OPEN).toFixed(2), c: idx * 100 }]
    .concat(TICKERS.map(t => ({ n: t.n, txt: won(t.p * (1 + t.c / 100)), c: t.c })));
  let total = 0;
  const parts = items.map(it => {
    const a = `${it.n} ${it.txt}`, bb = ` ${it.c >= 0 ? '▲' : '▼'}${Math.abs(it.c).toFixed(2)}%`;
    const wa = g.measureText(a).width, wb = g.measureText(bb).width;
    total += wa + wb + 28;
    return { a, bb, wa, wb, c: it.c };
  });
  tickerX %= total;
  for (let base = tickerX; base < innerWidth; base += total) {
    let x = base;
    for (const q of parts) {
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText(q.a, x, y + 15);
      g.fillStyle = q.c >= 0 ? UP : DOWN; g.fillText(q.bb, x + q.wa, y + 15);
      x += q.wa + q.wb + 28;
    }
  }
  g.restore();
}

// 로고: 엠블럼 + 그라데이션 글자
function drawLogo(cx, y) {
  g.save();
  g.font = font(40, 900);
  const tw = g.measureText('선물 러시').width, es = 46, gap = 12;
  const ex = cx - (tw + es + gap) / 2, ey = y - 38;
  const eg = g.createLinearGradient(ex, ey, ex + es, ey + es);
  eg.addColorStop(0, UP); eg.addColorStop(1, DOWN);
  g.fillStyle = 'rgba(10,12,40,0.9)';
  roundRect(ex, ey, es, es, 12); g.fill();
  g.strokeStyle = eg; g.lineWidth = 2.5; g.shadowColor = RUMOR; g.shadowBlur = 18;
  roundRect(ex, ey, es, es, 12); g.stroke();
  g.shadowColor = CYAN; g.shadowBlur = 10;
  g.strokeStyle = CYAN; g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  [[8, 34], [17, 24], [24, 30], [36, 14]].forEach(([a, b], i) => i ? g.lineTo(ex + a, ey + b) : g.moveTo(ex + a, ey + b));
  g.stroke();
  g.fillStyle = CYAN;
  g.beginPath(); g.moveTo(ex + 40, ey + 9); g.lineTo(ex + 39, ey + 20); g.lineTo(ex + 30, ey + 12); g.closePath(); g.fill();
  const tx = ex + es + gap;
  const tg = g.createLinearGradient(0, y - 34, 0, y + 4);
  tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#8ff3ff');
  g.textAlign = 'left';
  g.shadowColor = RUMOR; g.shadowBlur = 26;
  g.fillStyle = tg;
  g.font = font(40, 900);
  g.fillText('선물 러시', tx, y - 4);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(205,170,255,0.9)';
  g.font = font(10, 800);
  g.fillText('F U T U R E S   R U S H', tx + 2, y + 10);
  g.restore();
}

// ---------- 소리 (코드로 합성) ----------
let AC = null;
function ensureAudio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
  if (AC.state === 'suspended') AC.resume();
}
function tone(f, d, type = 'square', v = 0.05, f2 = null, delay = 0) {
  if (!AC) return;
  const t0 = AC.currentTime + delay;
  const o = AC.createOscillator(), gn = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
  gn.gain.setValueAtTime(v, t0);
  gn.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(gn).connect(AC.destination);
  o.start(t0);
  o.stop(t0 + d + 0.02);
}
const sfx = {
  long: () => tone(440, 0.09, 'square', 0.05, 880),
  short: () => tone(440, 0.09, 'square', 0.05, 220),
  win: c => [0, 4, 7, 12].forEach((s, i) => tone(523 * Math.pow(2, (s + Math.min(c, 8) * 2) / 12), 0.12, 'triangle', 0.07, null, i * 0.055)),
  lose: () => tone(180, 0.32, 'sawtooth', 0.06, 55),
  liq: () => { tone(300, 0.6, 'sawtooth', 0.09, 30); tone(90, 0.7, 'square', 0.06, 40, 0.05); },
  news: () => { tone(988, 0.07, 'square', 0.04); tone(1319, 0.09, 'square', 0.04, null, 0.09); },
  siren: () => [0, 1, 2, 3].forEach(i => tone(i % 2 ? 660 : 880, 0.16, 'sawtooth', 0.05, null, i * 0.17)),
  halt: () => tone(220, 0.8, 'triangle', 0.08, 110),
  tick: () => tone(1500, 0.03, 'square', 0.03),
  end: () => [784, 659, 523, 392].forEach((f, i) => tone(f, 0.16, 'triangle', 0.06, null, i * 0.12)),
};

// ---------- 한 판 ----------
function newRound(lev) {
  G = {
    lev, cap: stackCap(C.money), ctl: [], diffK: (DIFF[P.diff] || DIFF.normal).ws, noiseK: (DIFF[P.diff] || DIFF.normal).noise, bossK: (DIFF[P.diff] || DIFF.normal).boss, diffName: P.diff, rate: C.rate || RATE.start, rateVel: 0, rateHist: [], fees: 0, slip: 0, bossSlain: false, ws: [], regime: 'trend', track: null, wickUntil: 0, flips: 0, lastDir: 0, entries: 0, late2: 0, stackSum: 0, stackN: 0, holdW: 0, nW: 0, holdL: 0, nL: 0, revenged: false, blessed: false, blessDir: 0, stW: 0, stL: 0, sumW: 0, sumL: 0, afterBigLoss: false, suckerRolled: false, t: 0, acc: 0, price: OPEN, hist: [], trend: 0, segs: [], nextNews: 4, nextShift: 2, followUps: [],
    money: C.money, startMoney: C.money, pos: null, combo: 0, bestCombo: 0, trades: 0, wins: 0, liqs: 0,
    haltUntil: 0, cbDone: false, broke: false,
    news: null, flash: null, shake: 0, parts: [], floats: [], crack: null, pulse: 0, lastSec: ROUND + 1,
    doubled: false, buttons: [], press: { l: 0, r: 0 },
    toasts: [], newAch: [], confetti: [], rankUp: null, recordDay: false, celeb: null, sparks: [], mc: null,
  };
  // 화면을 채울 과거 시세 (시가에서 끝나도록 뒤에서부터)
  let p = OPEN;
  const pre = [];
  for (let i = 0; i < HIST; i++) { pre.unshift(p); p *= 1 + 0.0008 * randn(); }
  G.hist = pre;
}

function halted() { return G.t < G.haltUntil; }

function simTick() {
  const seg = G.segs.find(s => G.t >= s.from && G.t < s.until);
  let trend = seg ? seg.trend : G.trend;
  if (G.boss && !seg) trend = G.boss.dir * BOSS.drift * DB() + G.trend * 0.3; // 지속 출혈
  const vol = (0.0003 + 0.0001 * Math.min(1, G.t / ROUND)) * DN();
  const pull = G.boss ? 0 : -0.0015 * (G.regime === 'range' ? WS.rangePull : 1) * (G.price / OPEN - 1); // 시가에서 멀어질수록 되돌아오는 힘 (보스 중엔 없음)
  rateTick();
  const bias = (G.boss ? 0 : -rateTrend() * RATE.bias) + (G.blessed && G.pos && G.blessDir ? G.blessDir * BLESS.drift : 0); // 금리 상승 추세 → 아래로, 하락 추세 → 위로
  G.price = Math.max(50, G.price * (1 + trend + pull + bias + wsTrend() + vol * randn()));
  G.hist.push(G.price);
  if (G.hist.length > HIST) G.hist.shift();
  G.trend *= 0.97;
  if (G.t >= G.nextShift) { G.trend = randn() * 0.00015 * DN(); G.nextShift = G.t + rand(2, 4); }
  if (!G.boss && G.t >= G.nextNews && G.t < ROUND - 4) { fireNews(); G.nextNews = G.t + rand(6, 9); }
  const f = G.followUps.find(x => G.t >= x.at);
  if (f) { G.followUps = G.followUps.filter(x => x !== f); showNews(f.text, f.kind); }

  if (state !== 'play') return;
  if (checkMarginCall()) return;
  checkMilestone();
  engineTick();
  if (G.bossAt != null && !G.bossSlain && !G.boss && G.pos && !halted() && G.t >= G.bossAt && G.t < ROUND - BOSS.lastCall) fireBoss();
  // 단위별 강제청산: 청산가에 닿은 단위만
  if (G.pos) for (const u of G.pos.units.slice()) if (G.pos && unitPnl(u) <= -LIQ * u.margin) liquidateUnit(u);
  if (state !== 'play') return;
  // 서킷브레이커 (하락만, 한 판에 한 번)
  if (!G.boss && !G.cbDone && G.price / OPEN - 1 <= CB_DROP) { // 보스 중엔 출구를 막지 않음
    G.cbDone = true;
    G.haltUntil = G.t + CB_HALT;
    G.segs = [{ from: G.t + CB_HALT, until: G.t + CB_HALT + 2, trend: 0.0006 }]; // 재개 직후 반등
    sfx.halt();
    G.flash = { color: ALERT, life: 0.5 };
    G.shake = 12;
    if (G.pos && G.pos.dir < 0) unlockAch('cbshort');
  }
}

function showNews(text, kind, dir = 0) {
  if (G.boss && kind !== 'boss') return; // 보스 중엔 일반 뉴스 표시 안 함
  if (kind === 'news' || kind === 'bomb' || kind === 'boss') { const rd = rateNewsDir(text); if (rd) rateJump(rd, kind !== 'news'); }
  G.news = { text, kind, dir, life: kind === 'boss' ? 1e9 : 8, age: 0, at: G.t }; // 최소 8초 또렷하게, 보스는 판 끝까지
  if (state !== 'play') return;
  if (kind === 'bomb') { sfx.siren(); G.flash = { color: ALERT, life: 0.4 }; G.shake = 8; }
  else { sfx.news(); G.flash = { color: kind === 'rumor' ? RUMOR : GOLD, life: 0.25 }; }
}

function fireNews() {
  const t = G.t + 0.3; // 반응할 틈 0.3초
  const r = Math.random(), s = nextDir();
  if (r < 0.15) {
    // 긴급: 3초 동안 약 1.5~2%
    G.segs = [{ from: t, until: t + 3, trend: s * rand(0.0005, 0.0007) * (G.regime === 'range' ? WS.rangeNews : 1) * (G.blessed ? BLESS.newsBoost : 1) }];
    G.track = { seg: G.segs[0], p0: null, done: false };
    showNews(`[긴급] ${freshPick(s > 0 ? BOMB_GOOD : BOMB_BAD)}`, 'bomb', s);
  } else if (r < 0.4) {
    // 소문: 2초 동안 그쪽으로 갔다가, 공식 발표 뒤 3초 동안 되돌림
    const ru = freshPick(RUMORS.filter(x => x.dir === s), x => x.text);
    G.segs = [{ from: t, until: t + 2, trend: ru.dir * 0.0004 }, { from: t + 2, until: t + 5, trend: -ru.dir * 0.0004 }];
    G.followUps.push({ at: t + 2, text: `[공식] ${ru.off}`, kind: 'official' });
    showNews(`[소문] ${ru.text}`, 'rumor', ru.dir);
  } else {
    // 속보: 4초 동안 약 0.8~1.6%
    G.segs = [{ from: t, until: t + 4, trend: s * rand(0.0002, 0.0004) * (G.regime === 'range' ? WS.rangeNews : 1) * (G.blessed ? BLESS.newsBoost : 1) }];
    G.track = { seg: G.segs[0], p0: null, done: false };
    showNews(`[속보] ${freshPick(s > 0 ? NEWS_GOOD : NEWS_BAD)}`, 'news', s);
  }
}

// ---------- 매매 (피라미딩: 단위별로 진입가·증거금·청산가를 따로 가짐) ----------
const sideName = d => d > 0 ? '롱' : '숏';
function unitPnl(u) { return u.notional * (G.price / u.entry - 1) * G.pos.dir; }
function unreal() { return G.pos ? G.pos.units.reduce((a, u) => a + unitPnl(u), 0) : 0; }
function posMargin() { return G.pos.units.reduce((a, u) => a + u.margin, 0); }
function posUnits() { return G.pos ? G.pos.units.length : 0; }
// 평균 진입가: 전체 손익이 '계약금액 합 × (현재가/평균 - 1)'과 같아지는 값
function avgEntry() {
  const n = G.pos.units.reduce((a, u) => a + u.notional, 0), q = G.pos.units.reduce((a, u) => a + u.notional / u.entry, 0);
  return n / q;
}
function unitLiq(u) { return u.entry * (1 - G.pos.dir * LIQ * u.margin / u.notional); }
// 화면에 보이는 청산가: 가장 가까운(가장 위험한) 단위의 것
function liqPrice() {
  const ps = G.pos.units.map(unitLiq);
  return G.pos.dir > 0 ? Math.max(...ps) : Math.min(...ps);
}
// 청산까지 얼마나 왔는지: 0 = 진입가, 1 = 강제청산 (가장 위험한 단위 기준)
function danger() { return G.pos ? Math.max(0, ...G.pos.units.map(u => -unitPnl(u) / (LIQ * u.margin))) : 0; }

function toast(text, color, size = 18) {
  const m = msgPoint();
  G.floats = [];
  floatText(text, m.x, m.y, color, size);
}

// 시장가 체결가: 매수는 조금 비싸게, 매도는 조금 싸게 (side: +1 사는 쪽, -1 파는 쪽)
function fillPrice(side) {
  const ticks = Math.round(rand(COST.slipTicks[0], COST.slipTicks[1]));
  return G.price + side * ticks * COST.tickSize;
}
function addUnit(side) {
  const base = G.pos ? G.pos.base : G.money; // 단위 크기 = 첫 진입 때 자산
  const notional = base * G.lev, fee = notional * COST.fee;
  const px = fillPrice(side);
  G.money -= fee;
  G.fees += fee;
  G.slip += notional * Math.abs(px / G.price - 1);
  G.lastFee = fee;
  if (!G.pos) {
    const contra = G.news && G.news.kind === 'rumor' && G.news.dir === -side; // 소문 반대로 진입
    G.pos = { dir: side, base, units: [], maxD: 0, contra, net: 0 };
  }
  G.pos.units.push({ entry: px, notional, margin: base, fee });
}

// 단위 하나 정리: 손익 실현, 스택에서 빼기
function releaseUnit(u) {
  const px = fillPrice(-G.pos.dir); // 롱 정리는 파는 쪽, 숏 정리는 사는 쪽
  const pnl = u.notional * (px / u.entry - 1) * G.pos.dir, exitFee = Math.max(0, u.notional + pnl) * COST.fee;
  G.money += pnl - exitFee;
  G.fees += exitFee;
  G.slip += u.notional * Math.abs(px / G.price - 1);
  G.lastFee = exitFee;
  const net = pnl - exitFee - u.fee;
  G.pos.units = G.pos.units.filter(x => x !== u);
  G.pos.net += net;
  return net;
}

function trade(side) {
  G.press[side > 0 ? 'l' : 'r'] = 1;
  if (halted()) { tone(120, 0.12, 'square', 0.05); G.haltNudge = 1; return; } // 정지 중: 추가·해제 모두 불가
  if (!G.pos) {
    addUnit(side);
    G.pos.profitSecs = 0; G.pos.greedT = 0;
    engineOnAdd(side, true);
    side > 0 ? sfx.long() : sfx.short();
    toast(`${sideName(side)} 진입! · 수수료 ${won(G.lastFee)}`, side > 0 ? UP : DOWN, 16);
    checkBossSlain();
  } else if (G.pos.dir === side) {
    if (posUnits() >= G.cap) { tone(160, 0.1, 'square', 0.05); toast(`이번 판 최대 ${G.cap}단`, '#aab4c8', 16); return; }
    addUnit(side);
    engineOnAdd(side, false);
    side > 0 ? sfx.long() : sfx.short();
    toast(`${sideName(side)} 추가! x${posUnits()} · 수수료 ${won(G.lastFee)}`, side > 0 ? UP : DOWN, 16);
  } else {
    // 반대 버튼: 마지막에 쌓은 단위부터 1단위 해제
    const dir = G.pos.dir, net = releaseUnit(G.pos.units[G.pos.units.length - 1]);
    if (posUnits()) {
      tone(net >= 0 ? 700 : 260, 0.08, 'triangle', 0.05);
      toast(`${sideName(dir)} 1단위 해제 ${sign(net)} · 남은 x${posUnits()} · 수수료 ${won(G.lastFee)}`, net >= 0 ? UP : DOWN, 15);
      checkBroke();
    } else closeStack();
  }
}

// 남은 단위를 모두 정리 (판 마감 때)
function closePos() {
  if (!G.pos) return;
  for (const u of G.pos.units.slice()) releaseUnit(u);
  closeStack();
}

// 스택이 비었을 때: 스택 전체 손익으로 콤보·연출
function closeStack() {
  const pos = G.pos, net = pos.net;
  G.pos = null;
  G.trades += 1;
  engineOnClose(pos, net, true);
  const p = pricePoint(), m = msgPoint();
  G.floats = [];
  if (pos.maxD >= 0.9) unlockAch('survive');
  if (net > 0) {
    G.combo += 1;
    G.wins += 1;
    G.bestCombo = Math.max(G.bestCombo, G.combo);
    unlockAch('first');
    if (G.combo >= 5) unlockAch('combo5');
    if (pos.contra) unlockAch('contra');
    const bonus = net * 0.1 * (G.combo - 1);
    G.money += bonus;
    sfx.win(G.combo);
    floatText(G.combo >= 2 ? `${sign(net + bonus)} · 콤보 x${G.combo}` : sign(net + bonus), m.x, m.y, G.combo >= 2 ? GOLD : UP, 20);
    const n = Math.min(24, 6 + G.combo * 3);
    for (let i = 0; i < n; i++) {
      G.parts.push({ x: p.x, y: p.y, sx: p.x + rand(-80, 80), sy: p.y + rand(-90, 30), t: -i * 0.025 });
    }
    G.flash = { color: UP, life: 0.3 };
    G.shake = 6 + Math.min(G.combo, 6) * 2;
  } else {
    G.combo = 0;
    sfx.lose();
    floatText(sign(net), m.x, m.y, DOWN, 20);
    G.flash = { color: DOWN, life: 0.35 };
    G.shake = 14;
  }
  checkBroke();
}

// 한 단위 강제청산: 그 단위만 빠지고 스택이 1단위 줄어듦
function liquidateUnit(u) {
  const dir = G.pos.dir, net = releaseUnit(u);
  G.combo = 0;
  G.liqs += 1;
  unlockAch('liq');
  sfx.liq();
  G.flash = { color: ALERT, life: 0.5 };
  if (posUnits()) {
    G.shake = 16;
    toast(`⚠ ${sideName(dir)} 1단위 강제청산 ${sign(net)} · 남은 x${posUnits()}`, ALERT, 16);
    checkBroke();
    return;
  }
  const total = G.pos.net, lpos = G.pos;
  G.pos = null;
  G.trades += 1;
  engineOnClose(lpos, total, false);
  G.shake = 26;
  const cx = ox + W / 2, cy = H * 0.42, lines = [];
  for (let i = 0; i < 9; i++) {
    let x = cx, y = cy;
    const a = rand(0, Math.PI * 2), pts = [[x, y]];
    for (let k = 0; k < 6; k++) { x += Math.cos(a + rand(-0.5, 0.5)) * rand(20, 50); y += Math.sin(a + rand(-0.5, 0.5)) * rand(20, 50); pts.push([x, y]); }
    lines.push(pts);
  }
  G.crack = { lines, life: 1.4 };
  G.floats = [];
  floatText('강제청산!', cx, cy, ALERT, 44);
  floatText(sign(total), cx, cy + 50, DOWN, 26);
  checkBroke();
}

// 깡통: 포지션이 다 정리된 뒤 자산이 최소 증거금 아래면 (마진콜이 먼저)
function checkBroke() {
  if (checkMarginCall()) return;
  if (!G.pos && G.money < MIN_MONEY) { G.broke = true; endRound(); }
}

// ---------- 마진콜 ----------
// 판정은 손익으로: 런 시작(최초 자본금) 이후 실현손익 + 평가손익 합이 -최초 자본금 이하면 발동
function runPnl() {
  const realized = G.money - START_MONEY; // 런 내내 이어진 확정 잔액에서 최초 자본금을 뺀 것 = 누적 실현손익
  return realized + unreal();
}
function checkMarginCall() {
  if (state !== 'play') return false;
  const pnl = runPnl();
  if (pnl > -START_MONEY) return false;
  if (G.pos) { for (const u of G.pos.units.slice()) releaseUnit(u); G.pos = null; }
  G.mc = { pnl, deficit: Math.max(0, -(START_MONEY + pnl)), at: new Date(), age: 0, rounds: C.rounds + 1, peak: C.runPeak };
  state = 'margin';
  sfx.liq();
  tone(110, 1.2, 'sawtooth', 0.06, 55, 0.4);
  G.shake = 22;
  G.flash = { color: ALERT, life: 0.6 };
  unlockAch('broke');
  // 빚은 이월하지 않음: 다음 판은 최초 자본금으로 새 런
  C.rounds += 1;
  C.runPeak = Math.max(C.runPeak || 1, (START_MONEY + pnl) / START_MONEY);
  recordRound(true);
  resetRecent();
  freshRun(C);
  C.runs += 1;
  lastLev = fitLev(lastLev);
  saveCareer();
  return true;
}

// ---------- 자본금 2^k배 축하 ----------
const MILE_MSG = [
  '',
  '축하합니다! 제법 하시네요.',
  '당신은 선물거래에 소질이 있습니다.',
  '당신은 선물거래를 위해 태어났습니다.',
  '전설입니다. 지점장님이 당신을 뵙고 싶어합니다.',
  '본사 VIP 라운지를 열어 두었습니다. 커피는 평생 무료입니다.',
  '대표이사가 직접 인사드리러 가는 중입니다.',
  '저희 증권사가 당신 이름으로 펀드를 만들고 싶어합니다.',
  '한빛200이 당신을 따라 움직인다는 소문이 돕니다.',
  '중앙은행 총재가 당신의 다음 포지션을 묻습니다.',
  '당신이 곧 시장입니다. 저희를 거두어 주십시오.',
];
function checkMilestone() {
  const mult = (G.money + unreal()) / START_MONEY;
  if (mult > C.runPeak) C.runPeak = mult;
  let k = C.runMile || 0;
  if (mult < Math.pow(2, k + 1)) return;
  while (mult >= Math.pow(2, k + 1)) k++;
  C.runMile = k;
  C.mileRound = C.rounds + 1;
  G.celeb = { k, life: 3 };
  for (let i = 0; i < 70; i++) {
    const b = celebBox();
    G.sparks.push({ x: ox + rand(20, W - 20), y: b.y + rand(0, b.h), vx: rand(-60, 60), vy: rand(-220, -40), life: rand(1.2, 2.4), s: rand(2, 5) });
  }
  [0, 4, 7, 12, 16].forEach((st, i) => tone(784 * Math.pow(2, st / 12), 0.14, 'triangle', 0.06, null, i * 0.07));
}
function mileText(k) {
  return { title: `자본금 ${Math.pow(2, k).toLocaleString('ko-KR')}배 달성!`, msg: MILE_MSG[Math.min(k, MILE_MSG.length - 1)] };
}

// 떠오르는 글자: 항상 가운데 정렬, 어두운 받침 위에 (차트 선과 섞이지 않게)
function floatText(text, x, y, color, size) {
  G.floats.push({ text, x, y, color, size, life: 1.2 });
}
// 손익·진입 문구 자리: 차트 가운데 (가격 꼬리표와 떨어진 곳)
function zoneTop() { return Math.max(H * 0.765, 352); }
function rateBarY() { return chartBox().y1 + 24; } // 차트 시간 눈금 바로 아래
function celebBox() { return { y: 38, h: 76 }; } // 차트·뉴스·버튼을 피해 자산 숫자 자리 위에
function msgPoint() {
  return { x: ox + W / 2, y: zoneTop() - 9 };
}

// ---------- 화면 배치 ----------
function chartBox() {
  return { x0: ox + 16, x1: ox + W - 92, y0: 236, y1: Math.max(320, H * 0.66) };
}
function range() {
  let lo = Math.min(...G.hist), hi = Math.max(...G.hist);
  if (G.pos) {
    // 진입가는 항상, 청산가는 6% 안쪽일 때 화면에 들어오게
    const ae = avgEntry();
    lo = Math.min(lo, ae); hi = Math.max(hi, ae);
    const lq = liqPrice();
    if (Math.abs(lq / G.price - 1) < 0.06) { lo = Math.min(lo, lq); hi = Math.max(hi, lq); }
  }
  const pad = (hi - lo) * 0.15 || 1;
  return [lo - pad, hi + pad];
}
function yOf(v, b, lo, hi) { return b.y1 - (v - lo) / (hi - lo) * (b.y1 - b.y0); }
function pricePoint() {
  const b = chartBox(), [lo, hi] = range();
  return { x: b.x1, y: yOf(G.price, b, lo, hi) };
}

// ---------- 진행 ----------
function update(dt) {
  if (state !== 'over' && state !== 'margin') {
    G.acc += dt;
    while (G.acc >= TICK) {
      G.acc -= TICK;
      G.t += TICK;
      if (!halted()) simTick();
      if (state === 'over') break;
    }
  }
  if (state === 'menu' && G.t > 40) { const keep = G.hist, p = G.price; newRound(lastLev); G.hist = keep; G.price = p; }
  if (state === 'play') {
    const sec = Math.ceil(ROUND - G.t);
    if (sec < G.lastSec) { G.lastSec = sec; if (sec <= 10 && sec > 0) sfx.tick(); }
    // 청산 임박 심장 박동: 가까울수록 빨라진다
    const d = danger();
    if (G.pos) G.pos.maxD = Math.max(G.pos.maxD, d);
    if (d >= WARN && !G.warned) { G.warned = true; tone(660, 0.12, 'triangle', 0.06); tone(660, 0.12, 'triangle', 0.06, null, 0.16); }
    if (d < WARN * 0.8) G.warned = false;
    if (d >= CRIT && !halted() && G.t >= (G.nextBeat || 0)) {
      tone(70, 0.12, 'sine', 0.18);
      tone(60, 0.1, 'sine', 0.14, null, 0.14);
      G.nextBeat = G.t + 0.9 - 0.6 * Math.min(1, (d - CRIT) / (1 - CRIT));
    }
    if (G.t >= ROUND) endRound();
  }
  G.shake *= Math.pow(0.001, dt);
  G.haltNudge = Math.max(0, (G.haltNudge || 0) - dt * 3);
  G.pulse = Math.max(0, G.pulse - dt * 3);
  G.press.l = Math.max(0, G.press.l - dt * 5);
  G.press.r = Math.max(0, G.press.r - dt * 5);
  if (G.flash && (G.flash.life -= dt) <= 0) G.flash = null;
  if (G.crack && (G.crack.life -= dt) <= 0) G.crack = null;
  if (G.news) { G.news.age += dt; if ((G.news.life -= dt) <= 0) G.news = null; }
  G.floats = G.floats.filter(f => (f.life -= dt) > 0);
  G.toasts = G.toasts.filter(f => (f.life -= dt) > 0);
  if (G.celeb && (G.celeb.life -= dt) <= 0) G.celeb = null;
  for (const p of G.sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }
  G.sparks = G.sparks.filter(p => p.life > 0);
  if (G.mc) G.mc.age += dt;
  if (G.rankUp) G.rankUp.age += dt;
  for (const c of G.confetti) { c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 260 * dt; c.r += c.vr * dt; }
  G.confetti = G.confetti.filter(c => c.y < H + 20);
  for (const p of G.parts) p.t += dt * 1.6;
  const before = G.parts.length;
  G.parts = G.parts.filter(p => p.t < 1);
  if (G.parts.length < before) G.pulse = 1;
}

function startRound(lev) {
  if (lev > maxLev(C.money)) { tone(120, 0.12, 'square', 0.05); return; } // 아직 잠김
  lastLev = lev;
  newRound(lev);
  recent.last = recent.now; recent.now = new Set();
  state = 'play';
  toast(`이번 판 최대 ${G.cap}단`, CYAN, 18);
  planBoss();
  planRegime();
  G.afterBigLoss = C.bigLossRound === C.rounds; // 직전 판이 큰 손실
  planBless();
  if (P.diff === 'normal') { P.playedNormal = true; P.nudgePending = false; saveProfile(); }
}

// 이번 판에 보스가 나올지 정함 (나온다면 노릴 시각만 정하고, 실제 발동은 포지션이 있을 때)
function planBoss() {
  G.bossAt = null;
  const idx = C.rounds + 1; // 이번 라운드 번호
  if (C.rounds < BOSS.grace) return;
  if (idx - C.bossLast <= BOSS.cooldown) return;
  let p = BOSS.chance;
  if (C.mileRound === C.rounds) p *= BOSS.wMilestone; // 직전 라운드에 마일스톤
  if (C.streak >= 3) p *= BOSS.wStreak;
  if (Math.random() < p) G.bossAt = rand(BOSS.window[0], BOSS.window[1]);
}

// 보스 방향 포지션을 잡는 순간 보스 종료 (플랫만으론 안 됨)
function checkBossSlain() {
  if (!G.boss || !G.pos || G.pos.dir !== G.boss.dir) return;
  G.boss = null;
  G.bossSlain = true;
  G.bossAt = null;
  G.news = null;
  G.nextNews = G.t + 3;
  G.floats = [];
  const m = msgPoint();
  floatText('☠ 보스 처치!', m.x, m.y, GOLD, 22);
  G.flash = { color: GOLD, life: 0.4 };
  [0, 7, 12, 19].forEach((st, i) => tone(523 * Math.pow(2, st / 12), 0.16, 'triangle', 0.07, null, i * 0.08));
}

function fireBoss() {
  const dir = -G.pos.dir; // 항상 보유 포지션의 반대
  const text = pick(dir < 0 ? BOSS_CRASH : BOSS_SURGE);
  const size = BOSS.shock * DB(), ticks = BOSS.shockSecs / TICK;
  G.boss = { dir, at: G.t };
  C.bossLast = C.rounds + 1;
  G.followUps = [];
  G.segs = [{ from: G.t, until: G.t + BOSS.shockSecs, trend: dir * (Math.pow(1 + size, 1 / ticks) - 1) }];
  G.news = null;
  showNews(`[보스] ${text}`, 'boss', dir);
  sfx.siren(); sfx.halt();
  tone(55, 1.4, 'sawtooth', 0.08, 40);
}
// 보스 화면 효과: 발동 직후 흔들림+붉은빛, 그 뒤 가장자리 붉은빛만
function bossShakeOffset() {
  if (!G.boss || state !== 'play') return 0;
  const age = G.t - G.boss.at;
  if (age > BOSS.shakeSecs) return 0;
  return (Math.random() - 0.5) * 2 * BOSS.shakePx * (1 - age / BOSS.shakeSecs);
}
function drawBossFx() {
  if (!G.boss || state !== 'play') return;
  const age = G.t - G.boss.at;
  g.save();
  if (age < BOSS.shakeSecs) {
    g.fillStyle = `rgba(255,20,20,${BOSS.tint * (1 - age / BOSS.shakeSecs)})`;
    g.fillRect(-30, -30, innerWidth + 60, innerHeight + 60);
  }
  const vg = g.createRadialGradient(innerWidth / 2, H / 2, Math.min(W, H) * 0.32, innerWidth / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(255,20,20,0)');
  vg.addColorStop(1, `rgba(220,0,0,${BOSS.vignette})`);
  g.fillStyle = vg;
  g.fillRect(-30, -30, innerWidth + 60, innerHeight + 60);
  g.restore();
}
// 보스 배너: 일반 뉴스보다 크고, 각진 검정·빨강 태그 (두 테마 공통)
const BOSS_H = 78;
function drawBossBanner(cx, cy, w) {
  const n = G.news, { body } = newsParts(n), a = newsAnim(n), h = BOSS_H;
  const beat = 0.5 + 0.5 * Math.sin(n.age * 8);
  g.save();
  g.translate(cx, cy - (1 - a.e) * 18);
  g.scale(a.pop * 1.02, a.pop * 1.02);
  const gr = g.createLinearGradient(0, -h / 2, 0, h / 2);
  gr.addColorStop(0, '#3a0000'); gr.addColorStop(1, '#120000');
  g.shadowColor = '#ff1a1a'; g.shadowBlur = 24 + beat * 18;
  g.fillStyle = gr; g.fillRect(-w / 2, -h / 2, w, h);
  g.shadowBlur = 0;
  // 경고 줄무늬 테두리
  g.save();
  g.beginPath(); g.rect(-w / 2, -h / 2, w, h); g.rect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12); g.clip('evenodd');
  for (let x = -w / 2 - h; x < w / 2 + h; x += 16) {
    g.fillStyle = '#ff2e2e'; g.beginPath(); g.moveTo(x, -h / 2); g.lineTo(x + 8, -h / 2); g.lineTo(x + 8 + h, h / 2); g.lineTo(x + h, h / 2); g.closePath(); g.fill();
  }
  g.restore();
  g.strokeStyle = `rgba(255,80,80,${0.6 + 0.4 * beat})`; g.lineWidth = 2;
  g.strokeRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12);
  // 태그: 각진 검정 상자 + 빨간 글자 (일반 태그는 둥근 알약)
  g.font = font(15, 900);
  const tt = '☠ 보스', tw = g.measureText(tt).width + 18;
  g.fillStyle = '#000'; g.fillRect(-w / 2 + 16, -15, tw, 30);
  g.strokeStyle = '#ff2e2e'; g.lineWidth = 2; g.strokeRect(-w / 2 + 16, -15, tw, 30);
  g.fillStyle = '#ff3b3b'; g.textAlign = 'left'; g.fillText(tt, -w / 2 + 25, 6);
  const fs = fitFont(body, w - tw - 44, 20, 13, 900);
  g.fillStyle = '#fff'; g.shadowColor = '#ff2e2e'; g.shadowBlur = 10;
  g.fillText(body, -w / 2 + tw + 28, fs * 0.36);
  g.restore();
}

// ---------- 정리 버튼 (상단 구석, 일부러 작고 멀리) ----------
// 일괄청산: 전 단위를 현재가로 정리, 판은 계속
function flattenAll() {
  if (!G.pos || halted()) return;
  for (const u of G.pos.units.slice()) releaseUnit(u);
  closeStack();
}
// 투자중지: 전 단위 정리하고 판을 바로 끝냄 (포지션이 없어도 종료)
function stopInvest() {
  if (halted()) return;
  endRound();
}
// 버튼 자리 (네온: 상단 카드 왼쪽 위 구석)
function ctlRects() {
  return [{ act: 'flat', label: '일괄청산', x: ox + 16, y: 13, w: 58, h: 24 }, { act: 'stop', label: '투자중지', x: ox + 80, y: 13, w: 58, h: 24 }];
}
function ctlEnabled(act) { return !halted() && (act === 'stop' || !!G.pos); }
function drawCtl() {
  if (state !== 'play') return;
  G.ctl = ctlRects();
  for (const c of G.ctl) {
    const on = ctlEnabled(c.act);
    g.save();
    g.globalAlpha = on ? 1 : 0.3;
    g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1;
    roundRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1, 6); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.62)'; g.font = font(11, 700); g.textAlign = 'center';
    g.fillText(c.label, c.x + c.w / 2, c.y + 16);
    g.restore();
  }
}

function endRound() {
  if (state === 'over' || G.ending) return;
  G.ending = true;
  if (G.pos) closePos();
  state = 'over';
  sfx.end();
  finishRound();
}

// 판 결과를 경력에 반영: 자산 이어가기, 연승, 기록, 칭호
function finishRound() {
  const profit = G.money - G.startMoney, rate = profit / G.startMoney;
  C.rounds += 1;
  C.money = G.money;
  C.rate = G.rate;
  C.lastRoundLev = G.lev;
  C.hab.flip = ema(C.hab.flip, G.flips, ADAPT.flipAlpha);
  if (rate <= WS.bigLoss || G.liqs > 0) C.bigLossRound = C.rounds;
  G.regimeShown = G.regime;
  C.curve.push(G.money);
  if (C.curve.length > 300) C.curve.splice(1, C.curve.length - 300);
  C.streak = profit > 0 ? C.streak + 1 : 0;
  if (C.streak >= 3) unlockAch('streak3');
  if (C.streak >= 5) unlockAch('streak5');
  if (rate >= 0.5) unlockAch('day50');
  if (rate >= 1) unlockAch('day100');
  if (rate > C.bestDay) { C.bestDay = rate; G.recordDay = profit > 0; }
  if (G.money > C.best) C.best = G.money;
  C.runBest = Math.max(C.runBest, G.money);
  if (G.broke) unlockAch('broke');
  checkRank();
  saveCareer();
  recordRound(false);
  if (G.diffName === 'easy' && !P.playedNormal && !P.nudgeSeen && C.money >= 2 * START_MONEY) { P.nudgeSeen = true; P.nudgePending = true; saveProfile(); }
}

function checkRank() {
  const r = rankIdx(C.money);
  if (r >= 2) unlockAch('super');
  if (r >= 4) unlockAch('fund');
  if (r >= 6) unlockAch('legend');
  if (r <= C.runRank) return;
  const newLev = RANKS[r].lev > RANKS[C.runRank].lev ? RANKS[r].lev : 0;
  C.runRank = r;
  G.rankUp = { r, lev: newLev, age: 0 };
  // 축하: 꽃가루 + 팡파르
  const cols = [GOLD, UP, CYAN, GREEN, RUMOR, '#fff'];
  for (let i = 0; i < 140; i++) {
    G.confetti.push({ x: ox + W / 2 + rand(-30, 30), y: H * 0.36, vx: rand(-320, 320), vy: rand(-620, -180),
      r: rand(0, 6), vr: rand(-12, 12), c: pick(cols), s: rand(5, 10) });
  }
  [0, 4, 7, 12, 7, 12, 16, 19].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0.18, 'triangle', 0.07, null, 0.3 + i * 0.09));
}

// 난이도 세그먼트 (네온): 쉬움 | 보통
function drawDiffSeg(x, y, w) {
  const h = 36, half = (w - 6) / 2;
  g.fillStyle = 'rgba(10,12,32,0.7)'; roundRect(x, y, w, h, 12); g.fill();
  ['easy', 'normal'].forEach((k, i) => {
    const bx = x + 3 + i * (half), on = P.diff === k, c = k === 'easy' ? CYAN : ORANGE;
    if (on) { g.save(); g.fillStyle = c + '33'; g.shadowColor = c; g.shadowBlur = 12; roundRect(bx, y + 3, half, h - 6, 10); g.fill(); g.restore();
      g.strokeStyle = c; g.lineWidth = 1.5; roundRect(bx, y + 3, half, h - 6, 10); g.stroke(); }
    g.font = font(14, 900); const lw = g.measureText(DIFF_LABEL[k][0]).width;
    g.font = font(11, 700); const sw = g.measureText(DIFF_LABEL[k][1]).width;
    const sx = bx + half / 2 - (lw + 6 + sw) / 2; // 이름과 설명을 나란히 가운데 정렬
    g.textAlign = 'left';
    g.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.45)'; g.font = font(14, 900);
    g.fillText(DIFF_LABEL[k][0], sx, y + 23);
    g.fillStyle = on ? c : 'rgba(255,255,255,0.35)'; g.font = font(11, 700);
    g.fillText(DIFF_LABEL[k][1], sx + lw + 6, y + 22);
    G.buttons.push({ x: bx, y: y + 3, w: half, h: h - 6, act: 'diff', val: k });
  });
  return h + 10;
}
// 보통 도전 안내 (한 번만, 닫으면 끝) — 네온: 로고 자리 위에 띄움
function drawNudge() {
  if (!P.nudgePending) return;
  const x = ox + 12, w = W - 24, y = 10, h = 74;
  glass(x, y, w, h, 16, 0.95, ORANGE);
  g.textAlign = 'left'; g.fillStyle = GOLD; g.font = font(14, 900);
  g.fillText('쉬움 정복! 자본금 2배 달성', x + 14, y + 24);
  g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = font(12, 600);
  g.fillText('보통(실전 난이도)에 도전해 보세요.', x + 14, y + 44);
  const bw = 78, by = y + h - 32;
  g.fillStyle = ORANGE; roundRect(x + w - bw * 2 - 18, by, bw, 24, 8); g.fill();
  g.fillStyle = '#1a0d00'; g.textAlign = 'center'; g.font = font(12, 800);
  g.fillText('보통으로', x + w - bw * 1.5 - 18, by + 16);
  g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1; roundRect(x + w - bw - 10, by, bw, 24, 8); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText('닫기', x + w - bw / 2 - 10, by + 16);
  // 안내 버튼이 다른 버튼보다 먼저 눌리게 앞에 넣음
  G.buttons.unshift({ x: x + w - bw * 2 - 18, y: by, w: bw, h: 24, act: 'nudgeGo' }, { x: x + w - bw - 10, y: by, w: bw, h: 24, act: 'nudgeX' });
}
function setDiff(k) { P.diff = k; saveProfile(); tone(k === 'easy' ? 660 : 880, 0.06, 'sine', 0.04); }

// 로비의 자본금 리셋: 한 번 누르면 3초 동안 확인 상태, 그 안에 한 번 더 누르면 리셋
let resetArmAt = -1e9;
function resetArmed() { return performance.now() - resetArmAt < 3000; }
function resetLabel() { return resetArmed() ? '정말 리셋? 한 번 더 탭' : '자본금 리셋'; }
function resetAsk() {
  if (resetArmed()) { resetArmAt = -1e9; restartCareer(); tone(330, 0.2, 'triangle', 0.06); return; }
  resetArmAt = performance.now();
  tone(500, 0.08, 'square', 0.04);
}

// 게임 오버 뒤 처음부터: 최고 기록·업적은 남긴다
function restartCareer() {
  resetRecent();
  freshRun(C);
  C.runs += 1;
  lastLev = 5;
  saveCareer();
  toMenu();
}
function toMenu() {
  state = 'menu';
  const keep = G.hist, p = G.price;
  newRound(fitLev(lastLev));
  G.hist = keep; G.price = p;
}

// ---------- 그리기 ----------
function draw() {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.drawImage(state === 'play' ? BGQ : BG, 0, 0, innerWidth, innerHeight);
  g.translate((Math.random() - 0.5) * G.shake + bossShakeOffset(), (Math.random() - 0.5) * G.shake + bossShakeOffset());

  drawGrid();
  if (state !== 'menu' && state !== 'ach' && state !== 'analysis') drawPanels();
  drawChart();
  drawParts(); // 동전은 잔액 숫자 뒤로
  if (state === 'play' || state === 'over' || state === 'margin') { drawTop(); drawZones(); drawNews(); drawCtl(); drawRateBar(); }
  if (state === 'play' && halted()) drawHalt();
  drawDanger();
  drawBossFx();
  drawCrack();
  drawFloats();
  drawToasts();
  drawCelebrate();
  if (G.flash) {
    g.globalAlpha = Math.min(0.28, G.flash.life);
    g.fillStyle = G.flash.color;
    g.fillRect(-30, -30, innerWidth + 60, innerHeight + 60);
    g.globalAlpha = 1;
  }
  drawTicker();
  if (state === 'menu') drawMenu();
  if (state === 'ach') drawAch();
  if (state === 'analysis') drawAnalysis();
  if (state === 'over') { drawOver(); drawRankUp(); }
  if (state === 'margin') drawMarginCall();
}

// 상단 정보 카드와 차트 카드
function drawPanels() {
  glass(ox + 8, 6, W - 16, 146, 18, 0.5);
  const b = chartBox();
  glass(ox + 8, b.y0 - 14, W - 16, b.y1 - b.y0 + 40, 18, 0.42, RUMOR);
}

function drawGrid() {
  const off = state === 'play' ? 0 : (G.t * 24) % 40; // 플레이 중엔 격자도 정지
  g.strokeStyle = 'rgba(120,140,255,0.06)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = ox - off; x < ox + W; x += 40) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = 0; y < H; y += 40) { g.moveTo(ox, y); g.lineTo(ox + W, y); }
  g.stroke();
}

function drawChart() {
  const b = chartBox(), [lo, hi] = range(), n = G.hist.length;
  const X = i => b.x0 + i / (HIST - 1) * (b.x1 - b.x0);
  const col = CYAN; // 차트선은 한 색 고정

  g.save();
  if (state !== 'play' && state !== 'over') g.globalAlpha = 0.15; // 메뉴에선 흐리게, 글자가 잘 보이도록
  else drawAxes(b, lo, hi, X);

  // 시가 기준선
  if (state !== 'menu' && OPEN > lo && OPEN < hi) {
    const y = yOf(OPEN, b, lo, hi);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.setLineDash([2, 6]);
    g.beginPath(); g.moveTo(b.x0, y); g.lineTo(b.x1, y); g.stroke();
    g.setLineDash([]);
  }

  const grad = g.createLinearGradient(0, b.y0, 0, b.y1);
  grad.addColorStop(0, col + '55');
  grad.addColorStop(1, col + '00');
  g.beginPath();
  G.hist.forEach((v, i) => { const x = X(i + HIST - n), y = yOf(v, b, lo, hi); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.lineTo(b.x1, b.y1);
  g.lineTo(X(HIST - n), b.y1);
  g.closePath();
  g.fillStyle = grad;
  g.fill();

  g.save();
  g.shadowColor = col;
  g.shadowBlur = 16;
  g.strokeStyle = col;
  g.lineWidth = 3;
  g.lineJoin = 'round';
  g.beginPath();
  G.hist.forEach((v, i) => { const x = X(i + HIST - n), y = yOf(v, b, lo, hi); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
  g.restore();

  g.restore(); // 메뉴용 흐림 끝

  // 진입가·청산가 선 (글자는 오른쪽 축 꼬리표로)
  const tags = tagLayout(b, lo, hi);
  if (G.pos) {
    const c = G.pos.dir > 0 ? UP : DOWN;
    const y = yOf(avgEntry(), b, lo, hi);
    g.setLineDash([6, 6]);
    g.strokeStyle = c;
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(b.x0, y); g.lineTo(b.x1, y); g.stroke();
    g.setLineDash([]);
    const lq = liqPrice();
    if (lq > lo && lq < hi) {
      const ly = yOf(lq, b, lo, hi);
      g.strokeStyle = ALERT;
      g.lineWidth = 1.5;
      g.setLineDash([3, 4]);
      g.beginPath(); g.moveTo(b.x0, ly); g.lineTo(b.x1, ly); g.stroke();
      g.setLineDash([]);
    }
    liqDistance(b, lo, hi, ALERT, 'rgba(7,10,20,0.8)');
  }
  const lobby = state === 'menu' || state === 'ach' || state === 'analysis'; // 로비 뒤편 차트엔 시가·진입·청산 꼬리표 없음
  for (const t of lobby ? [] : tags) {
    if (t.k === 'open') axisTag(b, t.ty, `시가 ${OPEN.toFixed(1)}`, 'rgba(255,255,255,0.45)', t.y);
    if (t.k === 'entry') axisTag(b, t.ty, `${sideName(G.pos.dir)}${posUnits() > 1 ? 'x' + posUnits() : ''} ${avgEntry().toFixed(1)}`, G.pos.dir > 0 ? UP : DOWN, t.y);
    if (t.k === 'liq') axisTag(b, t.ty, `${t.edge ? (t.edge > 0 ? '▲' : '▼') : ''}청산 ${liqPrice().toFixed(1)}`, ALERT, t.edge ? null : t.y);
  }

  const pt0 = tags.find(t => t.k === 'price');
  const py = pt0.y, pty = pt0.ty;
  const r = 5 + Math.sin(performance.now() / 120) * 1.5;
  g.save();
  if (state !== 'play' && state !== 'over') g.globalAlpha = 0.15;
  g.shadowColor = col; g.shadowBlur = 20;
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(b.x1, py, r, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  if (Math.abs(pty - py) > 1) { g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(b.x1, py); g.lineTo(b.x1 + 6, pty); g.stroke(); }
  g.fillStyle = col;
  roundRect(b.x1 + 6, pty - 13, 78, 26, 6); g.fill();
  g.fillStyle = '#070a14';
  g.font = font(13);
  g.textAlign = 'center';
  g.fillText(pt(G.price), b.x1 + 45, pty + 5);
  g.restore();
}

// 오른쪽 축 꼬리표 자리 정하기: 실제 높이(y)에서 시작해 겹치면 아래로 밀고, 넘치면 전체를 위로
function tagLayout(b, lo, hi) {
  const t = [{ k: 'price', y: yOf(G.price, b, lo, hi), h: 26 }];
  if (G.pos) {
    t.push({ k: 'entry', y: yOf(avgEntry(), b, lo, hi), h: 20 });
    const lq = liqPrice(), inside = lq > lo && lq < hi;
    t.push({ k: 'liq', y: inside ? yOf(lq, b, lo, hi) : lq < lo ? b.y1 - 10 : b.y0 + 10, h: 20, edge: inside ? 0 : lq < lo ? -1 : 1 });
  }
  if (OPEN > lo && OPEN < hi) {
    const oy = yOf(OPEN, b, lo, hi);
    if (!t.some(x => Math.abs(x.y - oy) < 24)) t.push({ k: 'open', y: oy, h: 20 }); // 붙어 있으면 시가는 생략
  }
  t.sort((a, c) => a.y - c.y);
  t.forEach((x, i) => { x.ty = i ? Math.max(x.y, t[i - 1].ty + (t[i - 1].h + x.h) / 2 + 3) : x.y; });
  const last = t[t.length - 1], over = last.ty + last.h / 2 - (b.y1 + 8);
  if (over > 0) t.forEach(x => { x.ty -= over; });
  for (let i = t.length - 2; i >= 0; i--) t[i].ty = Math.min(t[i].ty, t[i + 1].ty - (t[i].h + t[i + 1].h) / 2 - 3);
  return t;
}

// 청산선 옆에 '청산까지 x%' 거리 표시
function liqDistance(b, lo, hi, color, bg) {
  const lq = liqPrice(), d = Math.abs(G.price / lq - 1) * 100;
  const inside = lq > lo && lq < hi;
  const y = inside ? yOf(lq, b, lo, hi) : lq < lo ? b.y1 - 4 : b.y0 + 4;
  const text = `청산까지 ${d.toFixed(1)}%`;
  g.font = font(11, 800);
  const w = g.measureText(text).width + 12;
  const ty = inside ? (lq < G.price ? y - 12 : y + 12) : (lq < lo ? y - 10 : y + 10);
  g.fillStyle = bg; roundRect(b.x0 + 4, ty - 9, w, 18, 9); g.fill();
  g.fillStyle = color; g.textAlign = 'left';
  g.fillText(text, b.x0 + 10, ty + 4);
}

function axisTag(b, y, text, c, trueY = null) {
  if (trueY !== null && Math.abs(trueY - y) > 1) { g.strokeStyle = c; g.lineWidth = 1; g.beginPath(); g.moveTo(b.x1, trueY); g.lineTo(b.x1 + 6, y); g.stroke(); }
  g.fillStyle = '#0b1020';
  roundRect(b.x1 + 6, y - 10, 78, 20, 5); g.fill();
  g.strokeStyle = c; g.lineWidth = 1.5;
  roundRect(b.x1 + 6, y - 10, 78, 20, 5); g.stroke();
  g.fillStyle = c;
  g.font = font(11, 700);
  g.textAlign = 'center';
  g.fillText(text, b.x1 + 45, y + 4);
}

function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

// 오른쪽 축 칸에 붙는 꼬리표들의 높이 (가격 눈금 숫자를 피하려고)
function tagYs(b, lo, hi) { return tagLayout(b, lo, hi).map(t => t.ty); }

function drawAxes(b, lo, hi, X) {
  g.font = font(11, 500);
  // 가격 눈금: 6칸 정도, 꼬리표에 가려질 숫자는 건너뜀
  const step = niceStep((hi - lo) / 9);
  const busy = tagYs(b, lo, hi);
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 1;
  g.textAlign = 'left';
  for (let v = Math.ceil(lo / step) * step; v < hi; v += step) {
    const y = yOf(v, b, lo, hi);
    g.beginPath(); g.moveTo(b.x0, y); g.lineTo(b.x1, y); g.stroke();
    if (busy.some(t => Math.abs(t - y) < 15)) continue;
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText(v.toFixed(step < 1 ? 1 : 0), b.x1 + 12, y + 4);
  }
  // 시간 눈금 (5초 = 50틱)
  g.textAlign = 'center';
  [['-15초', 0], ['-10초', 50], ['-5초', 100], ['지금', HIST - 1]].forEach(([label, i]) => {
    const x = X(i);
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.beginPath(); g.moveTo(x, b.y0); g.lineTo(x, b.y1); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillText(label, Math.min(x, b.x1 - 10), b.y1 + 16);
  });
}

function drawTop() {
  const cx = ox + W / 2;
  // 지수 줄: 종목명 | 현재가 · 등락률 · 남은 시간 (한 줄에)
  const chg = G.price / OPEN - 1, sec = Math.max(0, Math.ceil(ROUND - G.t));
  const urgent = ROUND - G.t <= 10;
  // 타이머 알약: 시계는 직접 그림 (이모지는 기기마다 폭이 달라 글자와 겹침)
  const tt = `${sec}초`;
  g.font = font(14, 800);
  const tw = 30 + g.measureText(tt).width + 10, tx = ox + W - 18 - tw;
  const blink = urgent && Math.floor(G.t * 4) % 2, tc = blink ? '#fff' : urgent ? UP : CYAN;
  g.fillStyle = urgent ? (blink ? UP : 'rgba(255,77,94,0.35)') : 'rgba(63,240,255,0.16)';
  roundRect(tx, 10, tw, 24, 12); g.fill();
  g.strokeStyle = tc; g.lineWidth = 1.8;
  g.beginPath(); g.arc(tx + 16, 22, 6.5, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(tx + 16, 22); g.lineTo(tx + 16, 17.5); g.moveTo(tx + 16, 22); g.lineTo(tx + 19.5, 22); g.stroke();
  g.textAlign = 'left'; g.fillStyle = tc;
  g.fillText(tt, tx + 28, 27);
  g.textAlign = 'right';
  g.fillStyle = chg >= 0 ? UP : DOWN;
  g.font = font(15, 800);
  g.fillText(`${pt(G.price)}  ${pctText(chg)}`, tx - 12, 27);

  // 큰 숫자 = 지금 청산하면 남는 돈, 바로 옆에 손익 %
  const u = unreal(), eq = G.money + u;
  const rk = RANKS[rankIdx(eq)];
  const label = G.pos ? '평가 자산 (지금 청산하면)' : '자산';
  g.font = font(12, 800);
  const rw = g.measureText(rk.name + '  ').width;
  g.font = font(12, 600);
  const lw = g.measureText(label).width;
  g.textAlign = 'left';
  g.fillStyle = rk.c;
  g.font = font(12, 800);
  g.fillText(rk.name, cx - (rw + lw) / 2, 50);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = font(12, 600);
  g.fillText(label, cx - (rw + lw) / 2 + rw, 50);
  const rate = G.pos ? u / posMargin() : (G.money - G.startMoney) / G.startMoney;
  const rc = rate >= 0 ? UP : DOWN;
  g.font = font(30, 800);
  const ew = g.measureText(won(eq)).width;
  g.font = font(17, 800);
  const pw = g.measureText(pctText(rate)).width;
  const gx = cx - (ew + 10 + pw) / 2;
  const scale = 1 + G.pulse * 0.12;
  g.save();
  g.translate(gx + ew / 2, 82);
  g.scale(scale, scale);
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  g.shadowColor = GOLD; g.shadowBlur = G.pulse * 24;
  g.font = font(30, 800);
  g.fillText(won(eq), 0, 0);
  g.restore();
  g.textAlign = 'left';
  g.fillStyle = rc;
  g.font = font(17, 800);
  g.fillText(pctText(rate), gx + ew + 10, 81);

  g.font = font(13, 600);
  if (G.pos) {
    g.textAlign = 'left';
    g.fillStyle = G.pos.dir > 0 ? UP : DOWN;
    g.font = font(13, 800);
    g.font = font(12, 800);
    g.fillText(`${sideName(G.pos.dir)} x${posUnits()} / 최대 ${G.cap}단 · 평균 ${avgEntry().toFixed(2)}`, ox + 20, 106);
    g.font = font(13, 600);
    g.textAlign = 'right';
    g.fillStyle = rc;
    g.fillText(`평가손익 ${sign(u)}`, ox + W - 20, 106);
  } else {
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText(`${G.lev}배 · 포지션 없음 · 이번 판 최대 ${G.cap}단`, cx, 106);
  }

  const left = Math.max(0, 1 - G.t / ROUND);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ox + 20, 118, W - 40, 6, 3); g.fill();
  g.fillStyle = urgent ? UP : CYAN;
  roundRect(ox + 20, 118, (W - 40) * left, 6, 3); g.fill();
  if (G.combo >= 2) {
    g.textAlign = 'left';
    g.fillStyle = GOLD;
    g.font = font(15, 800);
    g.fillText(`콤보 x${G.combo}`, ox + 20, 142);
  }
}

function drawZones() {
  const y0 = zoneTop(), h = H - y0 - 34, w = (W - 48) / 2;
  const zones = [{ x: ox + 16, c: UP, side: 1, p: G.press.l }, { x: ox + 32 + w, c: DOWN, side: -1, p: G.press.r }]
    .map(z => Object.assign(z, zoneText(z.side)));
  const off = halted();
  for (const z of zones) {
    g.save();
    g.globalAlpha = off ? 0.08 : 0.16 + z.p * 0.4;
    g.fillStyle = z.c;
    roundRect(z.x, y0, w, h, 18); g.fill();
    g.globalAlpha = off ? 0.3 : 1;
    g.strokeStyle = z.c;
    g.lineWidth = 2;
    g.shadowColor = z.c; g.shadowBlur = 10 + z.p * 30;
    roundRect(z.x, y0, w, h, 18); g.stroke();
    g.restore();
    g.textAlign = 'center';
    g.fillStyle = off ? 'rgba(255,255,255,0.3)' : '#fff';
    g.font = font(z.label.length > 2 ? 26 : 30, 800);
    g.fillText(z.label, z.x + w / 2, y0 + h / 2 + 4);
    g.font = font(13, 500);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(off ? '정지' : z.sub, z.x + w / 2, y0 + h / 2 + 28);
    if (z.badge && !off) { // 보유 단위 배지
      g.fillStyle = z.c; roundRect(z.x + w - 52, y0 + 10, 42, 24, 12); g.fill();
      g.fillStyle = '#fff'; g.font = font(14, 900); g.textAlign = 'center';
      g.fillText(z.badge, z.x + w - 31, y0 + 27);
    }
  }
}

// 뉴스 태그: 색 + 모양 (두 테마 공통) — 속보 ● 꽉 찬 알약, 긴급 ! 꽉 찬 알약, 소문 ? 점선, 공식 ✓ 테두리
function newsParts(n) {
  const m = n.text.match(/^\[(.+?)\]\s*(.*)$/);
  return { tag: m ? m[1] : '속보', body: m ? m[2] : n.text };
}
function newsTag(x, y, tag, c, onFill) {
  const st = { 속보: ['●', 'fill'], 긴급: ['!', 'fill'], 소문: ['?', 'dash'], 공식: ['✓', 'line'] }[tag] || ['●', 'fill'];
  const text = `${st[0]} ${tag}`;
  g.save();
  g.font = font(14, 900);
  const w = g.measureText(text).width + 18, h = 28;
  if (st[1] === 'fill') {
    g.fillStyle = c; roundRect(x, y - h / 2, w, h, h / 2); g.fill();
    g.fillStyle = onFill;
  } else {
    g.strokeStyle = c; g.lineWidth = 2;
    if (st[1] === 'dash') g.setLineDash([4, 3]);
    roundRect(x + 1, y - h / 2 + 1, w - 2, h - 2, h / 2); g.stroke();
    g.setLineDash([]);
    g.fillStyle = c;
  }
  g.textAlign = 'left';
  g.fillText(text, x + 9, y + 5);
  g.restore();
  return w;
}
// 등장 연출 값: 팝(0.3초) + 펄스(1초)
function newsAnim(n) {
  const e = 1 - Math.pow(1 - Math.min(1, n.age / 0.3), 3);
  const pop = 0.9 + 0.1 * e + (n.age < 0.5 ? 0.04 * Math.sin(n.age / 0.5 * Math.PI) : 0);
  return { e, pop, pulse: Math.max(0, 1 - n.age) };
}
function fitFont(text, maxW, big, small, weight) {
  let fs = big;
  while (fs > small && (g.font = font(fs, weight), g.measureText(text).width > maxW)) fs--;
  g.font = font(fs, weight);
  return fs;
}

const NEWS_H = 60, NEWS_Y = 186; // 뉴스 칸: 늘 같은 자리 (가운데 높이)
// 버튼 글자: 보유 방향이면 '추가', 반대면 '1단위 해제'
function zoneText(side) {
  const n = posUnits(), nm = sideName(side);
  if (!G.pos) return { label: nm, sub: side > 0 ? '오른다' : '내린다' };
  if (G.pos.dir === side) return { label: n < G.cap ? `${nm} 추가` : nm, sub: n < G.cap ? `x${n} → x${n + 1}` : `최대 ${G.cap}단 보유 중`, badge: `x${n}` };
  return { label: nm, sub: `${sideName(G.pos.dir)} 1단위 해제` };
}

function drawNews() {
  const x = ox + 16, w = W - 32, h = NEWS_H, cy = NEWS_Y;
  if (G.news && G.news.kind === 'boss') { drawBossBanner(ox + W / 2, cy, W - 24); return; }
  if (!G.news) {
    if (state !== 'play') return;
    // 뉴스가 없을 때도 자리 표시
    g.save();
    g.fillStyle = 'rgba(10,12,30,0.55)'; roundRect(x, cy - h / 2, w, h, 14); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1.5; g.setLineDash([5, 6]);
    roundRect(x, cy - h / 2, w, h, 14); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,0.32)'; g.font = font(15, 700); g.textAlign = 'center';
    g.fillText('뉴스 대기 중…', ox + W / 2, cy + 5);
    g.restore();
    return;
  }
  const n = G.news, { tag, body } = newsParts(n), a = newsAnim(n);
  const c = tag === '소문' ? RUMOR : tag === '긴급' ? ALERT : tag === '공식' ? '#d6dbe6' : GOLD;
  const blink = tag === '긴급' && Math.floor(n.age * 4) % 2;
  g.save();
  g.translate(ox + W / 2, cy - (1 - a.e) * 16);
  g.scale(a.pop, a.pop);
  g.globalAlpha = Math.min(1, n.life / 0.3, 0.3 + a.e);
  g.fillStyle = blink ? 'rgba(80,8,8,0.97)' : 'rgba(10,12,30,0.96)';
  roundRect(-w / 2, -h / 2, w, h, 14); g.fill();
  g.strokeStyle = tag === '긴급' && !blink ? c + '66' : c;
  g.lineWidth = 2 + a.pulse * 2;
  g.shadowColor = c; g.shadowBlur = 12 + a.pulse * 30;
  roundRect(-w / 2, -h / 2, w, h, 14); g.stroke();
  g.shadowBlur = 0;
  if (a.pulse > 0) { // 퍼져 나가는 고리
    const e = (1 - a.pulse) * 12;
    g.globalAlpha = a.pulse * 0.8;
    g.strokeStyle = c; g.lineWidth = 2;
    roundRect(-w / 2 - e, -h / 2 - e, w + e * 2, h + e * 2, 14 + e); g.stroke();
    g.globalAlpha = 1;
  }
  const tw = newsTag(-w / 2 + 12, 0, tag, c, tag === '긴급' ? '#fff' : '#0b0f20');
  const fs = fitFont(body, w - tw - 36, 17, 13, 800);
  g.fillStyle = '#fff';
  g.textAlign = 'left';
  g.fillText(body, -w / 2 + tw + 24, fs * 0.36);
  g.restore();
}

function drawHalt() {
  const cx = ox + W / 2, cy = H * 0.42, left = Math.ceil(G.haltUntil - G.t);
  g.save();
  g.translate((G.haltNudge || 0) * Math.sin(performance.now() / 18) * 8, 0); // 정지 중 탭하면 흔들림
  g.save();
  g.fillStyle = 'rgba(40,0,0,0.85)';
  roundRect(ox + 32, cy - 60, W - 64, 120, 16); g.fill();
  g.strokeStyle = ALERT; g.lineWidth = 2; g.shadowColor = ALERT; g.shadowBlur = 24;
  roundRect(ox + 32, cy - 60, W - 64, 120, 16); g.stroke();
  g.restore();
  g.textAlign = 'center';
  g.fillStyle = ALERT;
  g.font = font(24, 900);
  g.fillText('서킷브레이커 발동', cx, cy - 18);
  g.fillStyle = '#fff';
  g.font = font(15, 600);
  g.fillText(`지수 ${Math.round(-CB_DROP * 100)}% 급락 — 매매 정지`, cx, cy + 10);
  g.font = font(28, 900);
  g.fillText(`${left}`, cx, cy + 46);
  g.restore();
}

// 경고 단계: 0.35 이상 '주의'(노랑), 0.65 이상 '임박'(빨강, 깜빡임·심장 소리)
const WARN = 0.35, CRIT = 0.65;

function drawDanger() {
  if (state !== 'play' || halted()) return;
  const d = danger();
  if (d < WARN) return;
  const crit = d >= CRIT;
  const k = crit ? Math.min(1, (d - CRIT) / (1 - CRIT)) : 0;
  const beat = 0.5 + 0.5 * Math.sin(performance.now() / (crit ? 180 - 110 * k : 400));
  const rgb = crit ? '255,46,46' : '255,154,60';
  const a = crit ? (0.3 + 0.5 * k) * (0.45 + 0.55 * beat) : 0.12 + 0.08 * beat;
  // 화면 가장자리 테두리
  const grad = g.createRadialGradient(innerWidth / 2, H / 2, Math.min(W, H) * 0.35, innerWidth / 2, H / 2, Math.max(W, H) * 0.75);
  grad.addColorStop(0, `rgba(${rgb},0)`);
  grad.addColorStop(1, `rgba(${rgb},${a})`);
  g.fillStyle = grad;
  g.fillRect(-30, -30, innerWidth + 60, innerHeight + 60);
  // 경고 문구 (차트 위쪽): 청산가까지 지수가 몇 % 남았는지
  const left = Math.abs(G.price / liqPrice() - 1) * 100;
  const text = crit ? `⚠ 청산 임박! 청산가까지 ${left.toFixed(1)}%` : `청산 주의 · 청산가까지 ${left.toFixed(1)}%`;
  const c = crit ? ALERT : ORANGE;
  const b = chartBox(), cx = (b.x0 + b.x1) / 2, y = b.y0 + 18;
  g.font = font(14, 800);
  const w = g.measureText(text).width + 32;
  g.save();
  g.globalAlpha = crit ? 0.7 + 0.3 * beat : 1;
  g.fillStyle = crit ? 'rgba(60,6,6,0.94)' : 'rgba(45,20,4,0.94)';
  roundRect(cx - w / 2, y - 16, w, 30, 15); g.fill();
  g.strokeStyle = c; g.lineWidth = 2; g.shadowColor = c; g.shadowBlur = 16;
  roundRect(cx - w / 2, y - 16, w, 30, 15); g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = crit ? '#fff' : ORANGE;
  g.textAlign = 'center';
  g.fillText(text, cx, y + 4);
  g.restore();
}

function drawParts() {
  // 동전은 잔액 숫자 바로 아래(시간 막대)까지만 날아가고, 그 전에 사라진다
  const tx = ox + W / 2, ty = 128;
  for (const p of G.parts) {
    if (p.t < 0) continue;
    const t = p.t, e = t * t;
    const mx = p.x + (p.sx - p.x) * Math.min(1, t * 3);
    const my = p.y + (p.sy - p.y) * Math.min(1, t * 3);
    const x = mx + (tx - mx) * e, y = Math.max(ty, my + (ty - my) * e);
    g.save();
    g.globalAlpha = t < 0.7 ? 1 : (1 - t) / 0.3;
    g.shadowColor = GOLD; g.shadowBlur = 12;
    g.fillStyle = GOLD;
    g.beginPath(); g.ellipse(x, y, 7 * Math.abs(Math.cos(t * 12)) + 1.5, 7, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}

function drawCrack() {
  if (!G.crack) return;
  g.save();
  g.globalAlpha = Math.min(1, G.crack.life);
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.shadowColor = ALERT; g.shadowBlur = 14;
  for (const pts of G.crack.lines) {
    g.beginPath();
    pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.stroke();
  }
  g.restore();
}

function drawFloats() {
  for (const f of G.floats) {
    const rise = (1.2 - f.life) * 10;
    g.save();
    g.globalAlpha = Math.min(1, f.life / 0.4);
    g.font = font(f.size, 800);
    g.textAlign = 'center';
    const pop = 1 + Math.max(0, f.life - 1.0) * 2;
    g.translate(f.x, f.y - rise);
    g.scale(pop, pop);
    const w = g.measureText(f.text).width + 24, h = f.size + 14;
    g.fillStyle = 'rgba(7,10,20,0.85)';
    roundRect(-w / 2, -f.size * 0.85 - 7, w, h, h / 2); g.fill();
    g.fillStyle = f.color;
    g.shadowColor = f.color; g.shadowBlur = 14;
    g.fillText(f.text, 0, 0);
    g.restore();
  }
}

// 업적 알림 (판 도중): 차트 아래쪽 가운데
function drawToasts() {
  if (state !== 'play') return;
  const b = chartBox();
  G.toasts.slice(0, 2).forEach((t, i) => {
    const y = b.y1 - 22 - i * 36;
    g.save();
    g.globalAlpha = Math.min(1, t.life / 0.4, (2.6 - t.life) / 0.2);
    g.font = font(14, 800);
    const w = g.measureText(t.text).width + 32;
    g.fillStyle = 'rgba(30,24,4,0.94)';
    roundRect(ox + W / 2 - w / 2, y - 16, w, 30, 15); g.fill();
    g.strokeStyle = GOLD; g.lineWidth = 2; g.shadowColor = GOLD; g.shadowBlur = 14;
    roundRect(ox + W / 2 - w / 2, y - 16, w, 30, 15); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = GOLD; g.textAlign = 'center';
    g.fillText(t.text, ox + W / 2, y + 4);
    g.restore();
  });
}

// 자산 성장 곡선: 세로축은 로그(몇 배로 컸는지), 칭호 경계선을 같이 그린다
function drawCurve(x, y, w, h, data) {
  g.save();
  g.fillStyle = 'rgba(255,255,255,0.04)';
  roundRect(x, y, w, h, 10); g.fill();
  const pts = data.length > 1 ? data : [data[0], data[0]];
  let lo = Math.min(...pts), hi = Math.max(...pts);
  lo = Math.min(lo, START_MONEY); hi = Math.max(hi, lo * 3);
  const L0 = Math.log(lo) - 0.15, L1 = Math.log(hi) + 0.15;
  const px = 10, top = y + 8, bot = y + h - 8, left = x + px, right = x + w - 64;
  const Y = v => bot - (Math.log(Math.max(1, v)) - L0) / (L1 - L0) * (bot - top);
  const X = i => left + i / (pts.length - 1) * (right - left);
  // 칭호 경계
  g.font = font(10, 700);
  g.textAlign = 'left';
  RANKS.forEach(k => {
    if (k.min <= 0) return;
    const ly = Y(k.min);
    if (ly < top || ly > bot) return;
    g.strokeStyle = k.c + '55'; g.lineWidth = 1; g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(left, ly); g.lineTo(right, ly); g.stroke();
    g.setLineDash([]);
    g.fillStyle = k.c;
    g.fillText(k.name, right + 6, ly + 4);
  });
  // 시작선
  const sy = Y(START_MONEY);
  g.strokeStyle = 'rgba(255,255,255,0.2)'; g.setLineDash([2, 5]);
  g.beginPath(); g.moveTo(left, sy); g.lineTo(right, sy); g.stroke(); g.setLineDash([]);
  // 곡선
  const up = pts[pts.length - 1] >= START_MONEY;
  const col = up ? GOLD : DOWN;
  const grad = g.createLinearGradient(0, top, 0, bot);
  grad.addColorStop(0, col + '44'); grad.addColorStop(1, col + '00');
  g.beginPath();
  pts.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
  g.lineTo(right, bot); g.lineTo(left, bot); g.closePath();
  g.fillStyle = grad; g.fill();
  g.shadowColor = col; g.shadowBlur = 10;
  g.strokeStyle = col; g.lineWidth = 2.5; g.lineJoin = 'round';
  g.beginPath();
  pts.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
  g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(right, Y(pts[pts.length - 1]), 4, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.font = font(10, 600);
  g.fillText(`${data.length - 1}판`, left, bot - 2);
  g.restore();
}

// 칭호 카드: 이름, 자산, 다음 칭호까지 진행 막대
function drawRankCard(x, y, w, money) {
  const r = rankIdx(money), k = RANKS[r], nx = RANKS[r + 1];
  g.textAlign = 'left';
  g.fillStyle = k.c;
  g.font = font(22, 900);
  g.save(); g.shadowColor = k.c; g.shadowBlur = 14;
  g.fillText(k.name, x, y + 22);
  g.restore();
  g.textAlign = 'right';
  g.fillStyle = '#fff';
  g.font = font(20, 800);
  g.fillText((money >= 1e9 ? kor(money) : won(money)) + '원', x + w, y + 22);
  // 진행 막대 (로그 기준: 몇 배 남았는지)
  const by = y + 36;
  g.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(x, by, w, 8, 4); g.fill();
  let f = 1, txt = '최고 칭호 달성!';
  if (nx) {
    const a = Math.log(Math.max(k.min, START_MONEY * 0.1)), z = Math.log(nx.min);
    f = Math.max(0, Math.min(1, (Math.log(Math.max(1, money)) - a) / (z - a)));
    txt = `다음 ${nx.name}: ${kor(nx.min)}원` + (nx.lev > k.lev ? ` · ${nx.lev}배 해금` : '');
  }
  g.fillStyle = nx ? nx.c : k.c;
  roundRect(x, by, Math.max(8, w * f), 8, 4); g.fill();
  g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.font = font(12, 600);
  g.fillText(txt, x, by + 24);
}

function drawMenu() {
  const cx = ox + W / 2, x = ox + 20, w = W - 40;
  const tight = H < 720;
  let y = tight ? 58 : 70;
  drawLogo(cx, y);
  y += 32;
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = font(13, 500);
  g.fillText(`${INDEX} 선물 60초 롱숏 · 자산은 판마다 이어집니다`, cx, y);

  y += 24;
  const showAna = P.rounds >= 3;
  const ch = tight ? 52 : showAna ? 80 : 110;
  glass(x - 10, y - 10, w + 20, 74 + ch + 20, 18, 0.55);
  drawRankCard(x, y, w, C.money);
  y += 74;
  drawCurve(x, y, w, ch, C.curve);
  y += ch + 40;
  g.textAlign = 'center';

  if (!tight && !showAna) {
    const lines = [['왼쪽 탭 롱 · 오른쪽 탭 숏', '#fff'], ['[속보]·[긴급]은 따라가고, [소문]은 거꾸로', GOLD]];
    glass(x - 10, y - 22, w + 20, 56, 14, 0.5, GOLD);
    g.textAlign = 'center';
    g.font = font(13, 600);
    lines.forEach(([t, c], i) => { g.fillStyle = c; g.fillText(t, cx, y + i * 22); });
    y += 52;
  }

  G.buttons = [];
  y += drawDiffSeg(x, y - 18, w) - 4;
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.font = font(14, 700);
  g.fillText(`레버리지 선택 · 스택 최대 ${stackCap(C.money)}단`, cx, y);
  y += 12;
  const mx = maxLev(C.money), bw = (w - 20) / 3, bh = 54;
  const subs = { 1: '안전', 5: '보통', 10: '화끈', 20: '위험', 50: '광기', 100: '전설' };
  const cols = { 1: CYAN, 5: GOLD, 10: ALERT, 20: GREEN, 50: ORANGE, 100: RUMOR };
  LEVS.forEach((lv, i) => {
    const bx = x + (i % 3) * (bw + 10), byy = y + Math.floor(i / 3) * (bh + 10);
    const open = lv <= mx, c = open ? cols[lv] : '#3a4260';
    g.save();
    g.fillStyle = c + '22';
    roundRect(bx, byy, bw, bh, 12); g.fill();
    const sel = open && lv === fitLev(lastLev);
    g.strokeStyle = c; g.lineWidth = sel ? 3.5 : 2; g.shadowColor = c; g.shadowBlur = sel ? 26 : open ? 6 : 0;
    roundRect(bx, byy, bw, bh, 12); g.stroke();
    g.restore();
    g.textAlign = 'center';
    g.fillStyle = open ? '#fff' : 'rgba(255,255,255,0.35)';
    g.font = font(20, 900);
    g.fillText(open ? `${lv}배` : `🔒 ${lv}배`, bx + bw / 2, byy + 25);
    g.fillStyle = open ? c : 'rgba(255,255,255,0.4)';
    g.font = font(12, 600);
    g.fillText(open ? subs[lv] : unlockRank(lv).name, bx + bw / 2, byy + 44);
    G.buttons.push({ x: bx, y: byy, w: bw, h: bh, act: 'sel', lev: lv });
  });
  y += 2 * (bh + 10) + 2;
  g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = font(12, 600);
  g.fillText(nextCapText(C.money), cx, y + 6);
  y += 18;
  // 시작 버튼 (레버리지 칸은 선택만)
  const lv0 = fitLev(lastLev);
  button(x, y, w, 50, CYAN, '#00151a', `${lv0}배로 60초 거래 시작`, 'lev');
  G.buttons[G.buttons.length - 1].lev = lv0;
  y += 60;
  if (showAna) y += drawAnaCard(x - 10, y, w + 20) + 10;
  g.textAlign = 'center';
  g.fillStyle = GOLD;
  g.font = font(12, 600);
  g.fillText(`최고 자산 ${kor(C.best)}원 · 한 판 최고 ${pctText(C.bestDay)}`, cx, y + 12);
  // 업적: 왼쪽 위 구석 둘째 줄
  const got = ACHS.filter(a => C.ach[a.id]).length, at = `🏆 ${got}/${ACHS.length}`;
  g.font = font(12, 700); g.textAlign = 'left'; g.fillStyle = GOLD;
  g.fillText(at, ox + 14, 46);
  G.buttons.push({ x: ox + 6, y: 32, w: g.measureText(at).width + 16, h: 26, act: 'ach' });
  // 디자인 전환·자본금 리셋: 화면 맨 위 구석 (화면 높이와 상관없이 늘 보임)
  g.font = font(12, 700);
  g.textAlign = 'left'; g.fillStyle = CYAN;
  g.fillText('디자인 바꾸기', ox + 14, 22);
  G.buttons.push({ x: ox + 6, y: 4, w: g.measureText('디자인 바꾸기').width + 16, h: 28, act: 'theme' });
  const rl = resetLabel(), rw = g.measureText(rl).width;
  g.textAlign = 'right'; g.fillStyle = resetArmed() ? ALERT : 'rgba(255,255,255,0.5)';
  g.fillText(rl, ox + W - 14, 22);
  G.buttons.push({ x: ox + W - 22 - rw, y: 4, w: rw + 16, h: 28, act: 'resetAsk' });
  drawNudge();
}

function drawAch() {
  const cx = ox + W / 2, x = ox + 20, w = W - 40;
  g.fillStyle = 'rgba(7,10,20,0.9)';
  g.fillRect(0, 0, innerWidth, innerHeight);
  g.textAlign = 'center';
  g.fillStyle = GOLD;
  g.font = font(24, 900);
  const got = ACHS.filter(a => C.ach[a.id]).length;
  g.fillText(`업적 ${got}/${ACHS.length}`, cx, 48);
  const rh = Math.min(44, (H - 150) / ACHS.length);
  ACHS.forEach((a, i) => {
    const y = 70 + i * rh, ok = !!C.ach[a.id];
    g.fillStyle = ok ? 'rgba(255,211,77,0.10)' : 'rgba(255,255,255,0.04)';
    roundRect(x, y, w, rh - 6, 10); g.fill();
    g.textAlign = 'left';
    g.fillStyle = ok ? GOLD : 'rgba(255,255,255,0.35)';
    g.font = font(15, 800);
    g.fillText((ok ? '🏆 ' : '🔒 ') + a.name, x + 12, y + rh / 2 + 2);
    g.textAlign = 'right';
    g.fillStyle = ok ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)';
    g.font = font(12, 500);
    g.fillText(a.desc, x + w - 12, y + rh / 2 + 1);
  });
  G.buttons = [];
  button(x, 70 + ACHS.length * rh + 8, w, 46, CYAN, '#00151a', '돌아가기', 'back');
}

function drawOver() {
  const cx = ox + W / 2, pw = W - 32, px = ox + 16;
  const profit = G.money - G.startMoney, rate = profit / G.startMoney;
  const showDouble = profit > 0 && !G.doubled && !G.broke;
  const ch = H < 720 ? 90 : 120;
  const ph = 336 + ch + (G.newAch.length ? 26 : 0) + (showDouble ? 60 : 0) + 104;
  const py = Math.max(12, (H - ph) / 2);
  g.fillStyle = 'rgba(5,6,24,0.72)';
  g.fillRect(0, 0, innerWidth, innerHeight);
  glass(px, py, pw, ph, 20, 0.88, G.broke ? ALERT : CYAN);

  let y = py + 36;
  g.textAlign = 'center';
  g.fillStyle = G.broke ? ALERT : 'rgba(255,255,255,0.7)';
  g.font = font(G.broke ? 22 : 16, G.broke ? 900 : 600);
  g.fillText(G.broke ? '깡통! 게임 오버' : `${C.rounds}번째 판 마감!`, cx, y);
  y += 24;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = font(12, 600);
  g.fillText(G.broke ? `자산이 최소 증거금 ${kor(MIN_MONEY)}원 아래로` : `이번 판 결과 · 최고 자본금 ${C.runPeak.toFixed(1)}배`, cx, y);
  y += 38;
  g.fillStyle = profit >= 0 ? UP : DOWN;
  g.font = font(32, 900);
  g.fillText(`${sign(profit)}원`, cx, y);
  y += 26;
  g.font = font(17, 800);
  g.fillText(`${pctText(rate)}`, cx, y);
  if (G.recordDay) { g.fillStyle = GOLD; g.font = font(13, 800); g.fillText('★ 한 판 최고 수익 경신! ★', cx, y + 22); }
  y += 44;
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.font = font(12, 500);
  g.fillText(`${G.lev}배 · 매매 ${G.trades} · 수익 ${G.wins} · 콤보 x${G.bestCombo} · 청산 ${G.liqs} · 연승 ${C.streak}`, cx, y);
  y += 18;
  g.fillStyle = ORANGE;
  g.fillText(`이번 판 수수료 ${won(G.fees)}원 · 슬리피지 ${won(G.slip)}원${G.bossSlain ? ' · ☠ 보스 처치' : ''}`, cx, y);
  y += 18;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  { const t = statLine(); let fs = 12; while (fs > 9 && (g.font = font(fs, 500), g.measureText(t).width > pw - 24)) fs--; g.fillText(t, cx, y); }
  y += 18;

  drawRankCard(px + 18, y, pw - 36, G.money);
  y += 70;
  drawCurve(px + 18, y, pw - 36, ch, C.curve);
  y += ch + 8;
  if (G.newAch.length) {
    g.textAlign = 'center';
    g.fillStyle = GOLD;
    g.font = font(13, 800);
    g.fillText('🏆 ' + G.newAch.map(a => a.name).join(' · '), cx, y + 14);
    y += 26;
  }
  y += 8;

  G.buttons = [];
  if (G.broke) {
    button(px + 18, y, pw - 36, 52, ALERT, '#fff', '100만 원으로 처음부터', 'reset');
    y += 62;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = font(12, 600);
    g.fillText(`이번 도전 최고 ${kor(C.runBest)}원 · 업적과 최고 기록은 남습니다`, cx, y + 16);
    return;
  }
  const lev = fitLev(G.lev);
  button(px + 18, y, pw - 36, 54, CYAN, '#00151a', `다음 판 (${lev}배 · 최대 ${stackCap(C.money)}단)`, 'again');
  y += 64;
  if (showDouble) { button(px + 18, y, pw - 36, 44, GOLD, GOLD, '광고 보고 이번 판 수익 2배', 'double', true); y += 54; }
  button(px + 18, y, pw - 36, 40, '#2a3350', '#fff', '메뉴 · 레버리지 바꾸기', 'menu');
}

// 칭호 상승 축하 (결과 화면 위에)
function drawConfetti() {
  for (const c of G.confetti) {
    g.save();
    g.translate(c.x, c.y); g.rotate(c.r);
    g.fillStyle = c.c;
    g.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2);
    g.restore();
  }
}
function drawRankUp() {
  const ru = G.rankUp;
  if (!ru || ru.done) { drawConfetti(); return; }
  const k = RANKS[ru.r], cx = ox + W / 2, cy = H * 0.4;
  const e = Math.min(1, ru.age / 0.35), s = 0.6 + 0.4 * (1 - Math.pow(1 - e, 3)) + Math.max(0, 0.08 * Math.sin(ru.age * 5)) * (ru.age < 1.2 ? 1 : 0);
  g.save();
  g.fillStyle = `rgba(7,10,20,${0.93 * e})`;
  g.fillRect(0, 0, innerWidth, innerHeight);
  drawConfetti();
  g.translate(cx, cy);
  g.scale(s, s);
  g.globalAlpha = e;
  g.textAlign = 'center';
  g.fillStyle = GOLD;
  g.font = font(20, 900);
  g.fillText('칭호 상승!', 0, -54);
  g.shadowColor = k.c; g.shadowBlur = 40;
  g.fillStyle = k.c;
  g.font = font(44, 900);
  g.fillText(k.name, 0, 4);
  g.shadowBlur = 0;
  g.fillStyle = '#fff';
  g.font = font(16, 700);
  g.fillText(`자산 ${kor(k.min)}원 돌파`, 0, 38);
  if (ru.lev) {
    g.fillStyle = ALERT;
    g.font = font(18, 900);
    g.fillText(`🔓 ${ru.lev}배 레버리지 해금!`, 0, 74);
  }
  g.restore();
  if (ru.age > 0.8) {
    g.textAlign = 'center';
    g.fillStyle = `rgba(255,255,255,${0.4 + 0.3 * Math.sin(ru.age * 4)})`;
    g.font = font(13, 600);
    g.fillText('탭해서 계속', cx, cy + 130);
  }
}

// ---------- 자본금 배수 축하 배너 (플레이를 막지 않음, 3초) ----------
// ---------- 금리 바 (네온) ----------
function rateLabels() {
  const tr = rateTrend();
  return {
    rate: `기준금리 ${G.rate.toFixed(2)}%`,
    trend: tr > 0 ? '▲ 상승 중' : tr < 0 ? '▼ 하락 중' : '― 횡보',
    flow: tr > 0 ? '숏 우세' : tr < 0 ? '롱 우세' : '중립',
    tr,
  };
}
function drawRateBar() {
  const y = rateBarY(), x = ox + 16, w = W - 32, h = 22, L = rateLabels();
  g.save();
  g.fillStyle = 'rgba(10,12,32,0.7)'; roundRect(x, y, w, h, 11); g.fill();
  g.strokeStyle = 'rgba(255,200,90,0.25)'; g.lineWidth = 1; roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 11); g.stroke();
  g.font = font(12, 700); g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(L.rate, x + 12, y + 15);
  const rw = g.measureText(L.rate).width;
  g.fillStyle = L.tr ? ORANGE : 'rgba(255,200,120,0.6)'; g.font = font(12, 800);
  g.fillText(L.trend, x + 22 + rw, y + 15);
  g.textAlign = 'right';
  g.fillStyle = L.tr > 0 ? DOWN : L.tr < 0 ? UP : '#9aa3b5';
  g.fillText(L.flow, x + w - 12, y + 15);
  g.restore();
}

// 결과 통계 한 줄: 승률·평균 수익·평균 손실·시장 (차트와 통계가 선생님)
function statLine() {
  const n = G.stW + G.stL, R = C.stats, rn = R.w + R.l;
  const parts = [n ? `승률 ${Math.round(G.stW / n * 100)}% (${G.stW}/${n})` : '매매 없음'];
  if (G.stW) parts.push(`평균 수익 ${sign(G.sumW / G.stW)}`);
  if (G.stL) parts.push(`평균 손실 ${sign(G.sumL / G.stL)}`);
  parts.push(G.regime === 'range' ? '횡보장' : '추세장');
  if (rn) parts.push(`누적 승률 ${Math.round(R.w / rn * 100)}%`);
  return parts.join(' · ');
}

function drawCelebrate() {
  for (const p of G.sparks) {
    g.save();
    g.globalAlpha = Math.min(1, p.life);
    g.fillStyle = '#ffd34d'; g.shadowColor = '#ffb300'; g.shadowBlur = 8;
    g.beginPath(); g.arc(p.x, p.y, p.s, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  const c = G.celeb;
  if (!c || state === 'menu' || state === 'ach' || state === 'analysis') return;
  const b = celebBox(), t = 3 - c.life, x = ox + 12, w = W - 24;
  const a = Math.min(1, t / 0.25, c.life / 0.4), pop = 0.9 + 0.1 * Math.min(1, t / 0.25) + (t < 0.5 ? 0.04 * Math.sin(t / 0.5 * Math.PI) : 0);
  const { title, msg } = mileText(c.k);
  g.save();
  g.globalAlpha = a;
  g.translate(ox + W / 2, b.y + b.h / 2); g.scale(pop, pop); g.translate(-(ox + W / 2), -(b.y + b.h / 2));
  const gr = g.createLinearGradient(0, b.y, 0, b.y + b.h);
  gr.addColorStop(0, '#fff0a8'); gr.addColorStop(0.5, '#ffd34d'); gr.addColorStop(1, '#f0a800');
  g.shadowColor = '#ffc400'; g.shadowBlur = 26;
  g.fillStyle = gr; roundRect(x, b.y, w, b.h, 16); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = '#fff8d6'; g.lineWidth = 2; roundRect(x + 1, b.y + 1, w - 2, b.h - 2, 15); g.stroke();
  g.textAlign = 'center';
  g.fillStyle = '#3a2600'; g.font = font(21, 900);
  g.fillText(`👑 ${title}`, ox + W / 2, b.y + b.h * 0.44);
  g.fillStyle = '#5a3a00';
  fitFont(msg, w - 28, 15, 11, 800);
  g.fillText(msg, ox + W / 2, b.y + b.h * 0.8);
  g.restore();
}

// ---------- 마진콜 통지서 ----------
function drawMarginCall() {
  const m = G.mc;
  if (!m) return;
  const e = Math.min(1, m.age / 0.35);
  g.fillStyle = `rgba(0,0,0,${0.72 * e})`;
  g.fillRect(-30, -30, innerWidth + 60, innerHeight + 60);
  const pw = Math.min(W - 28, 420), px = ox + (W - pw) / 2, ph = 500, py = Math.max(12, (H - ph) / 2) + (1 - e) * 40;
  const SERIF = (px2, wt = 700) => `${wt} ${px2}px "Batang", "Noto Serif KR", "Nanum Myeongjo", serif`;
  g.save();
  g.globalAlpha = e;
  // 종이
  g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
  g.fillStyle = '#fbf8f0'; roundRect(px, py, pw, ph, 6); g.fill();
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  // 머리띠
  g.fillStyle = '#7d1414'; roundRect(px, py, pw, 54, 6); g.fill(); g.fillRect(px, py + 40, pw, 14);
  g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = font(13, 800);
  g.fillText('러시증권', px + 18, py + 33);
  g.textAlign = 'right'; g.font = SERIF(18, 800);
  g.fillText('마진콜 통지서', px + pw - 18, py + 28);
  g.font = font(9, 700); g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillText('MARGIN CALL NOTICE', px + pw - 18, py + 44);
  // 내역
  const d = m.at, two = n => String(n).padStart(2, '0');
  const when = `${d.getFullYear()}.${two(d.getMonth() + 1)}.${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
  const rows = [['고객명', '선물러시 고객님'], ['계좌번호', '7777-**-0404 (선물옵션)'], ['통지일시', when],
    ['누적 손익', `${sign(m.pnl)}원`], ['계좌 평가금액', `${won(START_MONEY + m.pnl)}원`], ['진행한 판', `${m.rounds}판 · 최고 ${m.peak.toFixed(1)}배`]];
  let y = py + 84;
  rows.forEach(([a, b], i) => {
    g.textAlign = 'left'; g.fillStyle = '#7a7366'; g.font = font(12, 600);
    g.fillText(a, px + 22, y);
    g.textAlign = 'right'; g.fillStyle = i === 3 || i === 4 ? '#b3261e' : '#2b2722'; g.font = font(13, 800);
    g.fillText(b, px + pw - 22, y);
    g.strokeStyle = '#e7e1d3'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px + 18, y + 10); g.lineTo(px + pw - 18, y + 10); g.stroke();
    y += 30;
  });
  y += 30;
  // 본문
  g.textAlign = 'center';
  g.fillStyle = '#b3261e';
  fitFontSerif('내일중으로 입금바랍니다.', pw - 40, 26, 16, SERIF);
  g.fillText('내일중으로 입금바랍니다.', px + pw / 2, y);
  y += 44;
  g.fillStyle = '#1f1b16';
  fitFontSerif('당신은 선물거래를 하지마세요.', pw - 40, 24, 15, SERIF);
  g.fillText('당신은 선물거래를 하지마세요.', px + pw / 2, y);
  // 도장
  g.save();
  g.translate(px + pw - 62, py + ph - 96);
  g.rotate(-0.26);
  g.globalAlpha = e * (0.55 + 0.3 * Math.min(1, Math.max(0, (m.age - 0.4) / 0.2)));
  g.strokeStyle = '#d0201a'; g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, 36, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#d0201a'; g.textAlign = 'center';
  g.font = SERIF(15, 900); g.fillText('반대매매', 0, 2);
  g.font = font(7, 800); g.fillText('MARGIN CALL', 0, 15);
  g.restore();
  // 작은 글씨
  g.textAlign = 'left'; g.fillStyle = '#a39b8b'; g.font = font(10, 500);
  g.fillText('※ 가상 게임 화면입니다. 실제 금융거래·회사와 무관.', px + 20, py + ph - 72);
  // 확인 버튼
  G.buttons = [];
  const bx = px + 18, by = py + ph - 58, bw = pw - 36, bh = 44;
  g.fillStyle = m.age > 0.8 ? '#2b2722' : '#8d877b';
  roundRect(bx, by, bw, bh, 8); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = font(15, 800);
  g.fillText('확인 · 100만 원으로 다시 시작', bx + bw / 2, by + 28);
  G.buttons.push({ x: bx, y: by, w: bw, h: bh, act: 'mcok' });
  g.restore();
}
function fitFontSerif(text, maxW, big, small, SERIF) {
  let fs = big;
  while (fs > small && (g.font = SERIF(fs, 900), g.measureText(text).width > maxW)) fs--;
  g.font = SERIF(fs, 900);
}

function button(x, y, w, h, bg, fg, label, act, quiet = false) {
  if (quiet) { // 테두리만, 빛 없음
    g.strokeStyle = bg + '99'; g.lineWidth = 1.5;
    roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 14); g.stroke();
    g.fillStyle = fg; g.font = font(15, 700); g.textAlign = 'center';
    g.fillText(label, x + w / 2, y + h / 2 + 5);
    G.buttons.push({ x, y, w, h, act });
    return;
  }
  g.save();
  g.fillStyle = bg; g.shadowColor = bg; g.shadowBlur = 16;
  roundRect(x, y, w, h, 14); g.fill();
  g.restore();
  g.fillStyle = fg;
  g.font = font(17, 800);
  g.textAlign = 'center';
  g.fillText(label, x + w / 2, y + h / 2 + 6);
  G.buttons.push({ x, y, w, h, act });
}

function roundRect(x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------- 입력 ----------
function hit(x, y) { return G.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); }

function tapAt(x, y) {
  ensureAudio();
  if (state === 'menu') {
    const b = hit(x, y);
    if (b && b.act === 'lev') startRound(b.lev);
    if (b && b.act === 'sel') { // 레버리지 칸: 선택만 (시작은 시작 버튼)
      if (b.lev > maxLev(C.money)) tone(120, 0.12, 'square', 0.05);
      else { lastLev = b.lev; tone(880, 0.05, 'sine', 0.04); }
    }
    if (b && b.act === 'ach') state = 'ach';
    if (b && b.act === 'ana') state = 'analysis';
    if (b && b.act === 'resetAsk') resetAsk();
    if (b && b.act === 'diff') setDiff(b.val);
    if (b && b.act === 'nudgeGo') { P.nudgePending = false; setDiff('normal'); }
    if (b && b.act === 'nudgeX') { P.nudgePending = false; saveProfile(); }
    if (b && b.act === 'theme') { // 디자인 전환: 증권사 앱 ↔ 네온
      try { localStorage.setItem('futures-theme', localStorage.getItem('futures-theme') === 'neon' ? 'mts' : 'neon'); } catch (e) { /* 무시 */ }
      location.reload();
    }
    return;
  }
  if (state === 'ach' || state === 'analysis') { const b = hit(x, y); if (b) state = 'menu'; return; }
  if (state === 'margin') { const b = hit(x, y); if (b && b.act === 'mcok' && G.mc.age > 0.8) toMenu(); return; }
  if (state === 'over') {
    if (G.rankUp && !G.rankUp.done) { if (G.rankUp.age > 0.8) G.rankUp.done = true; return; }
    const b = hit(x, y);
    if (!b) return;
    if (b.act === 'again') startRound(fitLev(G.lev));
    if (b.act === 'menu') toMenu();
    if (b.act === 'reset') restartCareer();
    if (b.act === 'double') {
      // 데모: 실제 광고 대신 바로 지급
      G.money += G.money - G.startMoney;
      G.doubled = true;
      G.pulse = 1;
      sfx.win(4);
      C.money = G.money;
      C.curve[C.curve.length - 1] = G.money;
      if (G.money > C.best) C.best = G.money;
      C.runBest = Math.max(C.runBest, G.money);
      const rate = (G.money - G.startMoney) / G.startMoney;
      if (rate >= 0.5) unlockAch('day50');
      if (rate >= 1) unlockAch('day100');
      if (rate > C.bestDay) { C.bestDay = rate; G.recordDay = true; }
      checkRank();
      saveCareer();
    }
    return;
  }
  const c = (G.ctl || []).find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  if (c) { if (ctlEnabled(c.act)) (c.act === 'flat' ? flattenAll : stopInvest)(); return; }
  trade(x < ox + W / 2 ? 1 : -1);
}
cv.addEventListener('pointerdown', e => { e.preventDefault(); tapAt(e.clientX, e.clientY); });
addEventListener('keydown', e => {
  if (e.repeat) return;
  ensureAudio();
  if (state === 'play') {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') trade(1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') trade(-1);
  } else if (state === 'margin') { if ((e.code === 'Space' || e.code === 'Enter') && G.mc.age > 0.8) toMenu(); }
  else if (state === 'over' && G.rankUp && !G.rankUp.done) { if (G.rankUp.age > 0.8) G.rankUp.done = true; }
  else if (state === 'over' && G.broke) { if (e.code === 'Space' || e.code === 'Enter') restartCareer(); }
  else if (e.code === 'Digit1') startRound(1);
  else if (e.code === 'Digit5') startRound(5);
  else if (e.code === 'Digit0') startRound(10);
  else if (e.code === 'Space' || e.code === 'Enter') startRound(fitLev(lastLev));
});
// 판 도중 앱을 나가면 그 자리에서 마감 (손실 회피용 새로고침 방지)
addEventListener('pagehide', () => { if (state === 'play') endRound(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') endRound(); });

// ---------- 루프 ----------
newRound(lastLev);
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
