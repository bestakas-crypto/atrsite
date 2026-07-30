(() => {
  'use strict';

  const DEFAULT_ROUND_AMOUNT = 10000000;
  const DEFAULT_TOTAL_ROUNDS = 10;
  const STORAGE_PREFIX = 'atr-grid:';
  const ASSET_LABELS = { kospi: '코스피200', qqq: 'QQQ' };

  let currentAsset = 'kospi';
  let state = null;

  // ---------- Storage ----------
  function storageKey(asset) {
    return STORAGE_PREFIX + asset;
  }

  function defaultState() {
    return {
      roundAmount: DEFAULT_ROUND_AMOUNT,
      totalRounds: DEFAULT_TOTAL_ROUNDS,
      k: 1,
      initialEntryPrice: 0,
      started: false,
      basePrice: 0,
      holdings: [], // stack, bottom = round 1
      history: []   // newest first
    };
  }

  function loadState(asset) {
    const raw = localStorage.getItem(storageKey(asset));
    if (!raw) return defaultState();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      showToast('저장된 데이터를 읽을 수 없어 초기 상태로 불러옵니다.');
      return defaultState();
    }

    const isLegacy = typeof parsed.roundAmount === 'undefined';
    const merged = Object.assign(defaultState(), parsed);

    if (isLegacy) {
      delete merged.totalCapital;
      if (merged.holdings.length > merged.totalRounds) {
        merged.totalRounds = merged.holdings.length;
      }
      localStorage.setItem(storageKey(asset), JSON.stringify(merged));
      showToast('기존 데이터를 새 회차 구조(회차당 1,000만원 · 총 10회차)로 이전했습니다.');
    }

    return merged;
  }

  function saveState() {
    localStorage.setItem(storageKey(currentAsset), JSON.stringify(state));
  }

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ---------- Formatting ----------
  function formatMoney(n) {
    if (!isFinite(n)) return '-';
    return Math.round(n).toLocaleString('ko-KR') + '원';
  }

  function formatPrice(n) {
    if (!isFinite(n)) return '-';
    const rounded = Math.round(n * 100) / 100;
    return rounded.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatQty(n) {
    if (!isFinite(n)) return '-';
    const rounded = Math.round(n * 10000) / 10000;
    return rounded.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  }

  // ---------- DOM refs ----------
  const el = {};
  function cacheDom() {
    el.setupPanel = document.getElementById('setup-panel');
    el.trackerPanel = document.getElementById('tracker-panel');
    el.setupRoundAmount = document.getElementById('setup-round-amount');
    el.setupTotalRounds = document.getElementById('setup-total-rounds');
    el.setupTotalPreviewValue = document.getElementById('setup-total-preview-value');
    el.setupK = document.getElementById('setup-k');
    el.setupEntryPrice = document.getElementById('setup-entry-price');
    el.setupEntryAtr = document.getElementById('setup-entry-atr');
    el.btnStartGrid = document.getElementById('btn-start-grid');

    el.statTotalPlanned = document.getElementById('stat-total-planned');
    el.statInvested = document.getElementById('stat-invested');
    el.statRound = document.getElementById('stat-round');
    el.statBasePrice = document.getElementById('stat-base-price');

    el.ladder = document.getElementById('ladder');

    el.todayAtr = document.getElementById('today-atr');
    el.btnCalc = document.getElementById('btn-calc');
    el.calcResult = document.getElementById('calc-result');
    el.calcBuyRound = document.getElementById('calc-buy-round');
    el.calcBuyPrice = document.getElementById('calc-buy-price');
    el.calcBuyAmount = document.getElementById('calc-buy-amount');
    el.calcSellRound = document.getElementById('calc-sell-round');
    el.calcSellPrice = document.getElementById('calc-sell-price');
    el.calcSellAmount = document.getElementById('calc-sell-amount');

    el.buyFillPrice = document.getElementById('buy-fill-price');
    el.btnBuyFill = document.getElementById('btn-buy-fill');
    el.buyFillNote = document.getElementById('buy-fill-note');
    el.sellFillPrice = document.getElementById('sell-fill-price');
    el.btnSellFill = document.getElementById('btn-sell-fill');
    el.sellFillNote = document.getElementById('sell-fill-note');

    el.historyBody = document.getElementById('history-body');
    el.historyEmpty = document.getElementById('history-empty');

    el.holdingsBody = document.getElementById('holdings-body');
    el.holdingsEmpty = document.getElementById('holdings-empty');

    el.btnResetAsset = document.getElementById('btn-reset-asset');

    el.confirmModal = document.getElementById('confirm-modal');
    el.confirmMessage = document.getElementById('confirm-message');
    el.confirmOk = document.getElementById('confirm-ok');
    el.confirmCancel = document.getElementById('confirm-cancel');

    el.toast = document.getElementById('toast');
    el.assetTabs = document.querySelectorAll('.asset-tab');
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, 2200);
  }

  // ---------- Confirm modal ----------
  let confirmCallback = null;
  function askConfirm(message, onConfirm) {
    el.confirmMessage.textContent = message;
    confirmCallback = onConfirm;
    el.confirmModal.hidden = false;
  }

  function closeConfirm() {
    el.confirmModal.hidden = true;
    confirmCallback = null;
  }

  // ---------- Rendering ----------
  function render() {
    if (!state.started) {
      el.setupPanel.hidden = false;
      el.trackerPanel.hidden = true;
      updateSetupTotalPreview();
      return;
    }
    el.setupPanel.hidden = true;
    el.trackerPanel.hidden = false;

    renderStats();
    renderHoldings();
    renderLadder();
    renderHistory();
    updateActionButtons();
    hideCalcResult();
  }

  function renderStats() {
    const invested = state.holdings.reduce((sum, h) => sum + h.amount, 0);
    el.statTotalPlanned.textContent = formatMoney(state.roundAmount * state.totalRounds);
    el.statInvested.textContent = formatMoney(invested);
    el.statRound.textContent = `${state.holdings.length} / ${state.totalRounds}`;
    el.statBasePrice.textContent = formatPrice(state.basePrice);
  }

  function renderLadder() {
    el.ladder.innerHTML = '';
    for (let round = 1; round <= state.totalRounds; round++) {
      const row = document.createElement('div');
      row.className = 'ladder-row';

      const label = document.createElement('div');
      label.className = 'ladder-round-label';
      label.textContent = `${round}회`;
      row.appendChild(label);

      const track = document.createElement('div');
      track.className = 'ladder-bar-track';

      const bar = document.createElement('div');
      bar.style.width = '100%';

      if (round <= state.holdings.length) {
        bar.className = 'ladder-bar filled';
        const h = state.holdings[round - 1];
        bar.textContent = `${formatPrice(h.price)} 매수 · ${formatMoney(h.amount)}`;
      } else if (round === state.holdings.length + 1) {
        bar.className = 'ladder-bar next';
        bar.textContent = `다음 매수 예정 · ${formatMoney(state.roundAmount)}`;
      } else {
        bar.className = 'ladder-bar';
        bar.textContent = formatMoney(state.roundAmount);
      }

      track.appendChild(bar);
      row.appendChild(track);
      el.ladder.appendChild(row);
    }
  }

  function renderHoldings() {
    el.holdingsBody.innerHTML = '';
    if (state.holdings.length === 0) {
      el.holdingsEmpty.hidden = false;
      return;
    }
    el.holdingsEmpty.hidden = true;

    state.holdings.forEach((h) => {
      const tr = document.createElement('tr');

      const tdRound = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'holdings-round-badge';
      badge.textContent = `${h.round}`;
      tdRound.appendChild(badge);
      tr.appendChild(tdRound);

      const tdDate = document.createElement('td');
      tdDate.textContent = h.date;
      tr.appendChild(tdDate);

      const tdPrice = document.createElement('td');
      tdPrice.textContent = formatPrice(h.price);
      tr.appendChild(tdPrice);

      const tdQty = document.createElement('td');
      tdQty.textContent = formatQty(h.qty);
      tr.appendChild(tdQty);

      const tdAmount = document.createElement('td');
      tdAmount.textContent = formatMoney(h.amount);
      tr.appendChild(tdAmount);

      el.holdingsBody.appendChild(tr);
    });
  }

  function renderHistory() {
    el.historyBody.innerHTML = '';
    if (state.history.length === 0) {
      el.historyEmpty.hidden = false;
      return;
    }
    el.historyEmpty.hidden = true;

    state.history.forEach((rec) => {
      const tr = document.createElement('tr');

      const tdRound = document.createElement('td');
      tdRound.textContent = `${rec.round}`;
      tr.appendChild(tdRound);

      const tdType = document.createElement('td');
      const span = document.createElement('span');
      span.className = rec.type === 'buy' ? 'badge-buy' : 'badge-sell';
      span.textContent = rec.type === 'buy' ? '매수' : '매도';
      tdType.appendChild(span);
      tr.appendChild(tdType);

      const tdDate = document.createElement('td');
      tdDate.textContent = rec.date;
      tr.appendChild(tdDate);

      const tdAtr = document.createElement('td');
      tdAtr.textContent = formatPrice(rec.atr);
      tr.appendChild(tdAtr);

      const tdPrice = document.createElement('td');
      tdPrice.textContent = formatPrice(rec.price);
      tr.appendChild(tdPrice);

      const tdQty = document.createElement('td');
      tdQty.textContent = formatQty(rec.qty);
      tr.appendChild(tdQty);

      const tdAmount = document.createElement('td');
      tdAmount.textContent = formatMoney(rec.amount);
      tr.appendChild(tdAmount);

      const tdPnl = document.createElement('td');
      if (rec.pnl === null || rec.pnl === undefined) {
        tdPnl.textContent = '-';
      } else {
        tdPnl.textContent = (rec.pnl >= 0 ? '+' : '') + formatMoney(rec.pnl);
        tdPnl.className = rec.pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
      }
      tr.appendChild(tdPnl);

      el.historyBody.appendChild(tr);
    });
  }

  function updateActionButtons() {
    const canBuy = state.holdings.length < state.totalRounds;
    const canSell = state.holdings.length > 0;

    el.btnBuyFill.disabled = !canBuy;
    el.buyFillNote.textContent = canBuy ? '' : `${state.totalRounds}회차를 모두 소진했습니다.`;

    el.btnSellFill.disabled = !canSell;
    el.sellFillNote.textContent = canSell ? '' : '보유 물량이 없습니다.';
  }

  function hideCalcResult() {
    el.calcResult.hidden = true;
  }

  // ---------- Calculation ----------
  function handleCalc() {
    const atr = parseFloat(el.todayAtr.value);
    if (!isFinite(atr) || atr < 0) {
      showToast('ATR값을 올바르게 입력하세요.');
      return;
    }
    const basePrice = state.basePrice;

    // Buy side
    if (state.holdings.length >= state.totalRounds) {
      el.calcBuyRound.textContent = '';
      el.calcBuyPrice.textContent = '회차 소진';
      el.calcBuyAmount.textContent = `${state.totalRounds}회차를 모두 사용했습니다.`;
    } else {
      const nextRound = state.holdings.length + 1;
      const buyPrice = basePrice - atr * state.k;
      const buyAmount = state.roundAmount;
      el.calcBuyRound.textContent = `${nextRound}회차 예정`;
      el.calcBuyPrice.textContent = formatPrice(buyPrice);
      el.calcBuyAmount.textContent = `예정 투입금액 ${formatMoney(buyAmount)}`;
    }

    // Sell side
    if (state.holdings.length === 0) {
      el.calcSellRound.textContent = '';
      el.calcSellPrice.textContent = '보유 물량 없음';
      el.calcSellAmount.textContent = '';
    } else {
      const top = state.holdings[state.holdings.length - 1];
      const sellPrice = basePrice + atr * state.k;
      const proceeds = top.qty * sellPrice;
      const pnl = proceeds - top.amount;
      el.calcSellRound.textContent = `${top.round}회차 대상`;
      el.calcSellPrice.textContent = formatPrice(sellPrice);
      el.calcSellAmount.textContent =
        `예상 실현금액 ${formatMoney(proceeds)} / 예상 손익 ${(pnl >= 0 ? '+' : '') + formatMoney(pnl)}`;
    }

    el.calcResult.hidden = false;
  }

  // ---------- Setup ----------
  function updateSetupTotalPreview() {
    const roundAmount = parseFloat(el.setupRoundAmount.value);
    const totalRounds = parseFloat(el.setupTotalRounds.value);
    if (!isFinite(roundAmount) || roundAmount < 0 || !isFinite(totalRounds) || totalRounds <= 0) {
      el.setupTotalPreviewValue.textContent = '-';
      return;
    }
    el.setupTotalPreviewValue.textContent = formatMoney(roundAmount * totalRounds);
  }

  function handleStartGrid() {
    const roundAmount = parseFloat(el.setupRoundAmount.value);
    const totalRounds = parseInt(el.setupTotalRounds.value, 10);
    const k = parseFloat(el.setupK.value);
    const entryPrice = parseFloat(el.setupEntryPrice.value);
    const entryAtr = parseFloat(el.setupEntryAtr.value);

    if (!isFinite(roundAmount) || roundAmount <= 0) {
      showToast('회차당 투입금액을 올바르게 입력하세요.');
      return;
    }
    if (!isFinite(totalRounds) || totalRounds <= 0) {
      showToast('총 회차 수를 올바르게 입력하세요.');
      return;
    }
    if (!isFinite(k) || k <= 0) {
      showToast('ATR 배수(k)를 올바르게 입력하세요.');
      return;
    }
    if (!isFinite(entryPrice) || entryPrice <= 0) {
      showToast('최초 진입가를 올바르게 입력하세요.');
      return;
    }
    if (!isFinite(entryAtr) || entryAtr < 0) {
      showToast('최초 ATR값을 올바르게 입력하세요.');
      return;
    }

    state = defaultState();
    state.roundAmount = roundAmount;
    state.totalRounds = totalRounds;
    state.k = k;
    state.initialEntryPrice = entryPrice;
    state.started = true;
    state.basePrice = entryPrice;

    const amount = roundAmount;
    const qty = amount / entryPrice;
    const date = todayStr();

    const holding = { round: 1, price: entryPrice, amount, qty, date, atr: entryAtr };
    state.holdings.push(holding);
    state.history.unshift({
      round: 1, type: 'buy', date, atr: entryAtr, price: entryPrice, amount, qty, pnl: null
    });

    saveState();
    render();
    showToast('그리드가 시작되었습니다.');
  }

  // ---------- Fill registration ----------
  function handleBuyFill() {
    if (state.holdings.length >= state.totalRounds) return;
    const price = parseFloat(el.buyFillPrice.value);
    if (!isFinite(price) || price <= 0) {
      showToast('매수 체결가를 올바르게 입력하세요.');
      return;
    }
    const atr = parseFloat(el.todayAtr.value);
    const atrValue = isFinite(atr) && atr >= 0 ? atr : 0;

    const round = state.holdings.length + 1;
    const amount = state.roundAmount;
    const qty = amount / price;
    const date = todayStr();

    state.holdings.push({ round, price, amount, qty, date, atr: atrValue });
    state.history.unshift({ round, type: 'buy', date, atr: atrValue, price, amount, qty, pnl: null });
    state.basePrice = price;

    saveState();
    el.buyFillPrice.value = '';
    render();
    showToast(`${round}회차 매수 체결이 등록되었습니다.`);
  }

  function handleSellFill() {
    if (state.holdings.length === 0) return;
    const price = parseFloat(el.sellFillPrice.value);
    if (!isFinite(price) || price <= 0) {
      showToast('매도 체결가를 올바르게 입력하세요.');
      return;
    }
    const atr = parseFloat(el.todayAtr.value);
    const atrValue = isFinite(atr) && atr >= 0 ? atr : 0;

    const sold = state.holdings.pop();
    const proceeds = sold.qty * price;
    const pnl = proceeds - sold.amount;
    const date = todayStr();

    state.history.unshift({
      round: sold.round, type: 'sell', date, atr: atrValue, price, amount: proceeds, qty: sold.qty, pnl
    });

    state.basePrice = state.holdings.length > 0
      ? state.holdings[state.holdings.length - 1].price
      : state.initialEntryPrice;

    saveState();
    el.sellFillPrice.value = '';
    render();
    showToast(`${sold.round}회차 매도 체결이 등록되었습니다.`);
  }

  // ---------- Reset ----------
  function handleResetAsset() {
    const label = ASSET_LABELS[currentAsset];
    askConfirm(`'${label}' 자산의 모든 데이터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`, () => {
      localStorage.removeItem(storageKey(currentAsset));
      state = defaultState();
      resetInputs();
      render();
      showToast('자산 데이터가 초기화되었습니다.');
    });
  }

  function resetInputs() {
    el.todayAtr.value = '';
    el.buyFillPrice.value = '';
    el.sellFillPrice.value = '';
    hideCalcResult();
  }

  // ---------- Asset switching ----------
  function switchAsset(asset) {
    currentAsset = asset;
    state = loadState(asset);
    resetInputs();
    el.assetTabs.forEach((btn) => {
      const active = btn.dataset.asset === asset;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    render();
  }

  // ---------- Init ----------
  function bindEvents() {
    el.assetTabs.forEach((btn) => {
      btn.addEventListener('click', () => switchAsset(btn.dataset.asset));
    });
    el.btnStartGrid.addEventListener('click', handleStartGrid);
    el.setupRoundAmount.addEventListener('input', updateSetupTotalPreview);
    el.setupTotalRounds.addEventListener('input', updateSetupTotalPreview);
    el.btnCalc.addEventListener('click', handleCalc);
    el.btnBuyFill.addEventListener('click', handleBuyFill);
    el.btnSellFill.addEventListener('click', handleSellFill);
    el.btnResetAsset.addEventListener('click', handleResetAsset);

    el.confirmOk.addEventListener('click', () => {
      const cb = confirmCallback;
      closeConfirm();
      if (cb) cb();
    });
    el.confirmCancel.addEventListener('click', closeConfirm);
    el.confirmModal.addEventListener('click', (e) => {
      if (e.target === el.confirmModal) closeConfirm();
    });
  }

  function init() {
    cacheDom();
    bindEvents();
    switchAsset('kospi');

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(() => {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
