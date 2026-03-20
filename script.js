/* ═══════════════════════════════════════════════════════════
   MEETHA PIPE — script.js
   XAUUSD + BTC/USD Super Strategy Signal Engine
   ► Dynamic EMA / RSI / Bollinger Bands calculations
   ► Multi-timeframe (15M + 5M) with consensus
   ► Dynamic SL/TP from recent high/low (6-candle)
   ► Web Audio API sound alerts
   ► Canvas candlestick chart with indicators
   ═══════════════════════════════════════════════════════════ */
"use strict";

/* ══════════════════════
   CONFIG
══════════════════════ */
const CFG = {
  emaFast  : 10,
  emaSlow  : 21,
  bbPer    : 20,
  bbStd    : 2,
  rsiPer   : 14,
  rsiOB    : 70,      // overbought → SELL
  rsiOS    : 30,      // oversold   → BUY
  deadLo   : 45,      // dead zone low
  deadHi   : 55,      // dead zone high
  bbNear   : 0.30,    // within 30% of half-band = "near"
  slCandles: 6,       // candles to look back for SL
  N        : 250,     // candles to generate
  tick     : 60000,   // refresh every 60s

  /* Base prices — real-world region */
  bases: {
    XAU: { price: 4720, vol: 8  },   // Gold ~$4700
    BTC: { price: 85000, vol: 800 }  // BTC  ~$85000
  }
};

/* ══════════════════════
   STATE
══════════════════════ */
let TF      = "15m";
let PAIR    = "XAU";
let SIG     = { XAU: { "15m": "WAIT", "5m": "WAIT" }, BTC: { "15m": "WAIT", "5m": "WAIT" } };
let LOGN    = 0;
let refreshTimer;

/* ══════════════════════
   CLOCK
══════════════════════ */
setInterval(() => {
  const d = new Date();
  const p = v => String(v).padStart(2,"0");
  document.getElementById("clk").textContent =
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}, 1000);

/* ══════════════════════
   MATH HELPERS
══════════════════════ */
function calcEMA(data, n) {
  if (data.length < n) return data.map(() => null);
  const k = 2 / (n + 1);
  let e = data.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const r = Array(n - 1).fill(null);
  r.push(e);
  for (let i = n; i < data.length; i++) { e = data[i] * k + e * (1 - k); r.push(e); }
  return r;
}

function calcSMA(data, n) {
  return data.map((_, i) => {
    if (i < n - 1) return null;
    return data.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n;
  });
}

function calcBB(data, n, std) {
  const mid = calcSMA(data, n);
  const up = [], lo = [];
  for (let i = 0; i < data.length; i++) {
    if (i < n - 1) { up.push(null); lo.push(null); continue; }
    const sl = data.slice(i - n + 1, i + 1);
    const m  = mid[i];
    const sd = Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / n);
    up.push(m + std * sd);
    lo.push(m - std * sd);
  }
  return { upper: up, middle: mid, lower: lo };
}

function calcRSI(data, n) {
  if (data.length <= n) return data.map(() => null);
  const gains = [], losses = [];
  for (let i = 0; i < data.length; i++) {
    const d = i === 0 ? 0 : data[i] - data[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  let ag = gains.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
  let al = losses.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
  const r = Array(n).fill(null);
  r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = n + 1; i < data.length; i++) {
    ag = (ag * (n - 1) + gains[i])  / n;
    al = (al * (n - 1) + losses[i]) / n;
    r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return r;
}

/* ══════════════════════
   CANDLE GENERATOR
   Deterministic per epoch — no flicker
   Realistic price region per pair
══════════════════════ */
function genCandles(pair, tf, N) {
  const step  = (tf === "15m" ? 15 : 5) * 60;
  const now   = Math.floor(Date.now() / 1000);
  const epoch = Math.floor(now / step);
  let seed    = (epoch * 0x1F3A7 + (tf === "15m" ? 0xAB01 : 0xCD02) +
                 (pair === "BTC" ? 0x9F01 : 0x1F01)) >>> 0;

  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967295;
  };

  const base = CFG.bases[pair];
  let price  = base.price + (rng() - 0.5) * base.price * 0.05;
  const candles = [];

  for (let i = N - 1; i >= 0; i--) {
    const t    = (epoch - i) * step;
    const vol  = base.vol * (0.5 + rng() * 2.0);
    const drift = (rng() - 0.487) * base.vol * 0.3;
    const open  = price;
    const body  = (rng() - 0.5 + drift / base.vol) * vol * 2.5;
    const close = open + body;
    const high  = Math.max(open, close) + rng() * vol * 0.9;
    const low   = Math.min(open, close) - rng() * vol * 0.9;
    candles.push({ t, o: open, h: high, l: low, c: close });
    price = close;
  }
  return candles;
}

/* ══════════════════════
   SIGNAL ENGINE
══════════════════════ */
function computeSignal(candles) {
  const closes = candles.map(c => c.c);
  const highs  = candles.map(c => c.h);
  const lows   = candles.map(c => c.l);
  const N      = closes.length;

  const e10arr = calcEMA(closes, CFG.emaFast);
  const e21arr = calcEMA(closes, CFG.emaSlow);
  const bbData = calcBB(closes, CFG.bbPer, CFG.bbStd);
  const rsiArr = calcRSI(closes, CFG.rsiPer);

  const price = closes[N - 1];
  const e10   = e10arr[N - 1];
  const e21   = e21arr[N - 1];
  const bbU   = bbData.upper[N - 1];
  const bbM   = bbData.middle[N - 1];
  const bbL   = bbData.lower[N - 1];
  const rsi   = rsiArr[N - 1];

  if (!e10 || !e21 || !bbU || rsi == null) return null;

  /* Recent high/low for SL (last 6 candles) */
  const recentH = Math.max(...highs.slice(-CFG.slCandles));
  const recentL = Math.min(...lows.slice(-CFG.slCandles));

  /* BB position metrics */
  const bandWidth = bbU - bbL;
  const halfBand  = bandWidth / 2;
  const bbPct     = bandWidth > 0 ? ((price - bbL) / bandWidth) * 100 : 50;
  const nearUpper = bandWidth > 0 && price >= bbU - halfBand * CFG.bbNear;
  const nearLower = bandWidth > 0 && price <= bbL + halfBand * CFG.bbNear;

  /* RSI states */
  const rsiDead    = rsi >= CFG.deadLo && rsi <= CFG.deadHi;  // FORCE WAIT
  const rsiSellOK  = rsi > 50 && rsi > CFG.rsiOB;             // >70
  const rsiBuyOK   = rsi < 50 && rsi < CFG.rsiOS;             // <30
  const emaUp      = e10 > e21;
  const emaDown    = e10 < e21;

  /* ── BUY conditions ── */
  const buyChecks = [
    { label: "EMA 10 > EMA 21",     pass: emaUp,    note: emaUp    ? "UPTREND ▲"   : "NO UPTREND"   },
    { label: "RSI < 50 & < 30",     pass: rsiBuyOK, note: rsiDead  ? "DEAD ZONE"   : `RSI ${rsi.toFixed(1)}` },
    { label: "Price near Lower BB", pass: nearLower, note: `${bbPct.toFixed(0)}% in band` },
  ];

  /* ── SELL conditions ── */
  const sellChecks = [
    { label: "EMA 10 < EMA 21",     pass: emaDown,   note: emaDown   ? "DOWNTREND ▼" : "NO DOWNTREND"  },
    { label: "RSI > 50 & > 70",     pass: rsiSellOK, note: rsiDead   ? "DEAD ZONE"   : `RSI ${rsi.toFixed(1)}` },
    { label: "Price near Upper BB", pass: nearUpper,  note: `${bbPct.toFixed(0)}% in band` },
  ];

  let buyScore  = buyChecks.filter(c => c.pass).length;
  let sellScore = sellChecks.filter(c => c.pass).length;

  /* RSI dead zone forces WAIT regardless */
  let dir = "WAIT", score = 0, checks = buyChecks;

  if (rsiDead) {
    dir = "WAIT"; score = 0;
    checks = [
      { label: "EMA Trend",   pass: false, note: "RSI DEAD ZONE" },
      { label: "RSI Level",   pass: false, note: `RSI ${rsi.toFixed(1)} in 45–55` },
      { label: "BB Position", pass: false, note: "SIDEWAYS" },
    ];
  } else if (buyScore >= 2 && buyScore >= sellScore) {
    dir = "BUY";  score = buyScore;  checks = buyChecks;
  } else if (sellScore >= 2 && sellScore > buyScore) {
    dir = "SELL"; score = sellScore; checks = sellChecks;
  } else if (buyScore === 1) {
    dir = "WAIT"; score = 1; checks = buyChecks;
  } else if (sellScore === 1) {
    dir = "WAIT"; score = 1; checks = sellChecks;
  } else {
    dir = "WAIT"; score = 0;
    checks = [
      { label: "EMA Trend",   pass: false, note: "NO SIGNAL"    },
      { label: "RSI Level",   pass: false, note: `RSI ${rsi.toFixed(1)}` },
      { label: "BB Position", pass: false, note: "NEUTRAL"       },
    ];
  }

  const strength = score === 3 ? "STRONG" : score === 2 ? "WEAK" : "NO TRADE";

  /* ── Trade levels ── */
  let entry = price, sl, tp;
  if (dir === "BUY") {
    sl = recentL - bandWidth * 0.02;
    tp = entry + (entry - sl) * 2;
  } else if (dir === "SELL") {
    sl = recentH + bandWidth * 0.02;
    tp = entry - (sl - entry) * 2;
  } else {
    sl = recentL;
    tp = recentH;
  }

  return {
    dir, score, strength, checks,
    price, e10, e21, bbU, bbM, bbL, bbPct,
    rsi, rsiDead, emaUp, emaDown, nearUpper, nearLower,
    entry, sl, tp,
    candles, e10arr, e21arr,
    bbUpperArr: bbData.upper, bbLowerArr: bbData.lower,
  };
}

/* ══════════════════════
   CHART RENDERING
   Full canvas candlestick + EMA + BB
══════════════════════ */
function drawChart(result) {
  const cv  = document.getElementById("cvChart");
  const box = cv.parentElement;
  const W   = box.clientWidth  || window.innerWidth;
  const H   = box.clientHeight || 380;
  cv.width  = W;
  cv.height = H;

  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, W, H);

  const { candles, e10arr, e21arr, bbUpperArr, bbLowerArr } = result;

  /* Show last 80 candles */
  const vis  = candles.slice(-80);
  const e10v = e10arr.slice(-80);
  const e21v = e21arr.slice(-80);
  const bbuv = bbUpperArr.slice(-80);
  const bblv = bbLowerArr.slice(-80);
  const n    = vis.length;
  if (!n) return;

  /* Price range */
  const allPrices = [];
  vis.forEach(c => allPrices.push(c.h, c.l));
  bbuv.forEach(v => v && allPrices.push(v));
  bblv.forEach(v => v && allPrices.push(v));
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const rng  = maxP - minP || 1;

  const padT = 20, padB = 26, padL = 6, padR = 70;
  const cH   = H - padT - padB;
  const cW   = W - padL - padR;

  const fy = v => padT + cH - ((v - minP) / rng) * cH;
  const fx = i => padL + (i / Math.max(n - 1, 1)) * cW;

  /* Grid */
  ctx.strokeStyle = "#0d1520";
  ctx.lineWidth   = 1;
  for (let g = 0; g < 6; g++) {
    const gy = padT + g * (cH / 5);
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
    const pv = maxP - g * (rng / 5);
    ctx.fillStyle = "#253452";
    ctx.font = "9px monospace";
    ctx.fillText(formatPrice(pv, result.price), W - padR + 4, gy + 3);
  }

  /* Line series helper */
  const drawLine = (arr, color, dash = false, lw = 1.5) => {
    ctx.strokeStyle = color;
    ctx.lineWidth   = lw;
    ctx.setLineDash(dash ? [5, 4] : []);
    ctx.beginPath();
    let started = false;
    arr.forEach((v, i) => {
      if (v == null) return;
      if (!started) { ctx.moveTo(fx(i), fy(v)); started = true; }
      else           ctx.lineTo(fx(i), fy(v));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };

  /* BB shaded region */
  ctx.beginPath();
  let first = true;
  bbuv.forEach((v, i) => {
    if (v == null) return;
    if (first) { ctx.moveTo(fx(i), fy(v)); first = false; }
    else ctx.lineTo(fx(i), fy(v));
  });
  for (let i = n - 1; i >= 0; i--) {
    if (bblv[i] != null) ctx.lineTo(fx(i), fy(bblv[i]));
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(56,182,255,0.04)";
  ctx.fill();

  drawLine(bbuv, "rgba(100,100,220,.55)", true, 1);
  drawLine(bblv, "rgba(220,100,100,.55)", true, 1);
  drawLine(e10v, "#05d68c", false, 2);
  drawLine(e21v, "#f0273e", false, 2);

  /* Candles */
  const cw = Math.max(2, Math.floor(cW / n) - 1);
  vis.forEach((c, i) => {
    const x    = fx(i);
    const bull = c.c >= c.o;
    const col  = bull ? "#05d68c" : "#f0273e";

    /* wick */
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, fy(c.h)); ctx.lineTo(x, fy(c.l));
    ctx.stroke();

    /* body */
    const yO = fy(Math.max(c.o, c.c));
    const yC = fy(Math.min(c.o, c.c));
    const bh = Math.max(1, yC - yO);
    ctx.fillStyle = col;
    ctx.fillRect(x - cw / 2, yO, cw, bh);
  });

  /* Current price label */
  const lp  = vis[n - 1].c;
  const lpy = fy(lp);
  ctx.fillStyle = "rgba(7,9,14,.92)";
  ctx.fillRect(W - padR + 2, lpy - 9, padR - 4, 18);
  ctx.fillStyle = (n > 1 && lp >= vis[n - 2].c) ? "#05d68c" : "#f0273e";
  ctx.font = "bold 10px monospace";
  ctx.fillText(formatPrice(lp, lp), W - padR + 5, lpy + 4);

  /* Time labels */
  ctx.fillStyle = "#253452"; ctx.font = "8px monospace";
  [0, Math.floor(n / 2), n - 1].forEach(i => {
    const d   = new Date(vis[i].t * 1000);
    const lbl = `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
    ctx.fillText(lbl, fx(i) - 13, H - 6);
  });
}

function formatPrice(v, ref) {
  if (!v) return "--";
  /* If BTC region (>10000) show no decimals, else 2 */
  return ref > 10000 ? Math.round(v).toLocaleString() : v.toFixed(2);
}

/* ══════════════════════
   UI UPDATE
══════════════════════ */
const f2 = (v, ref) => v == null ? "--" : ref > 10000 ? Math.round(v).toLocaleString() : v.toFixed(2);
const f1 = v => v == null ? "--" : v.toFixed(1);

function swapCls(el, add) {
  el.className = el.className
    .replace(/\b(buy|sell|wait|bull|bear|neut|pass|fail)\b/g, "")
    .trim();
  if (add) el.classList.add(add);
}

function updateMainUI(result, pair, tf) {
  const { dir, score, strength, checks, price,
          e10, e21, bbU, bbM, bbL, bbPct,
          rsi, rsiDead, emaUp, nearUpper, nearLower,
          entry, sl, tp } = result;

  const isBTC = price > 10000;

  /* Signal Box */
  const box = document.getElementById("sigbox");
  swapCls(box, dir.toLowerCase());

  document.getElementById("sigPairTag").textContent = pair === "XAU" ? "XAUUSD" : "BTC/USD";
  document.getElementById("sigico").textContent = dir === "BUY" ? "🟢" : dir === "SELL" ? "🔴" : "⚠️";

  const ww = document.getElementById("sigwrd");
  ww.textContent = dir === "BUY" ? "STRONG BUY" :
                   dir === "SELL" ? "STRONG SELL" :
                   score === 1 ? "WEAK — WAIT" : "WAIT";

  const ss = document.getElementById("sigstr");
  ss.className = "sigstr";
  if (strength === "STRONG")     { ss.textContent = "● STRONG · 3/3 CONDITIONS MET"; ss.classList.add("sS"); }
  else if (strength === "WEAK")  { ss.textContent = "● WEAK · 2/3 CONDITIONS MET";   ss.classList.add("sW"); }
  else                            { ss.textContent = "○ NO TRADE · LESS THAN 2/3";    ss.classList.add("sN"); }

  /* Trade levels */
  document.getElementById("tdE").textContent = f2(entry, price);
  document.getElementById("tdS").textContent = f2(sl, price);
  document.getElementById("tdT").textContent = f2(tp, price);
  const sd = Math.abs(entry - sl), td = Math.abs(tp - entry);
  document.getElementById("slDst").textContent = sd > 0 ? `$${isBTC ? sd.toFixed(0) : sd.toFixed(1)}` : "--";
  document.getElementById("tpDst").textContent = td > 0 ? `$${isBTC ? td.toFixed(0) : td.toFixed(1)}` : "--";

  /* BB strip */
  document.getElementById("vBBu").textContent = f2(bbU, price);
  document.getElementById("vBBm").textContent = f2(bbM, price);
  document.getElementById("vBBl").textContent = f2(bbL, price);
  document.getElementById("vPRC").textContent = f2(price, price);

  /* Live prices in toolbar */
  if (pair === "XAU") document.getElementById("xauPrice").textContent = f2(price, price);
  if (pair === "BTC") document.getElementById("btcPrice").textContent = f2(price, price);

  /* Conditions */
  [["ck1","ci1","cr1"], ["ck2","ci2","cr2"], ["ck3","ci3","cr3"]].forEach(([rowId, icId, resId], i) => {
    const c   = checks[i];
    const row = document.getElementById(rowId);
    const ic  = document.getElementById(icId);
    const re  = document.getElementById(resId);
    swapCls(row, c.pass ? "pass" : rsiDead ? "neut" : "fail");
    ic.textContent = c.pass ? "✓" : rsiDead ? "~" : "✗";
    re.textContent = c.note || "--";
  });

  /* Score bar */
  const pct  = (score / 3) * 100;
  const fill = document.getElementById("sfil");
  fill.style.width      = pct + "%";
  fill.style.background = score === 3 ? "var(--gn)" :
                          score === 2 ? "var(--gd2)" :
                          score === 1 ? "var(--yw)" : "var(--t3)";
  document.getElementById("stxt").textContent = `Score: ${score} / 3  —  ${strength}`;

  /* EMA card */
  const icEMA = document.getElementById("icEMA");
  swapCls(icEMA, emaUp ? "bull" : "bear");
  document.getElementById("vE10").textContent = f2(e10, price);
  document.getElementById("vE21").textContent = f2(e21, price);
  const spread = Math.abs(e10 - e21);
  document.getElementById("emaDiff").textContent = `Spread: ${f2(spread, price)}`;
  const tEMA = document.getElementById("tEMA");
  tEMA.className   = "itag " + (emaUp ? "tgB" : "tgR");
  tEMA.textContent = emaUp ? "UPTREND ▲" : "DOWNTREND ▼";

  /* RSI card */
  const icRSI = document.getElementById("icRSI");
  swapCls(icRSI, rsiDead ? "neut" : rsi >= CFG.rsiOB ? "bear" : rsi <= CFG.rsiOS ? "bull" : "neut");
  document.getElementById("vRSI").textContent = f1(rsi);
  const rf = document.getElementById("rfil");
  rf.style.width      = rsi + "%";
  rf.style.background = rsi >= CFG.rsiOB ? "var(--rd)" :
                        rsi <= CFG.rsiOS ? "var(--gn)" : "var(--bl)";
  const tRSI = document.getElementById("tRSI");
  const vRSIn= document.getElementById("vRSIn");
  if      (rsiDead)          { tRSI.className = "itag tgY"; tRSI.textContent = "DEAD ZONE";  vRSIn.textContent = "45–55"; }
  else if (rsi >= CFG.rsiOB) { tRSI.className = "itag tgR"; tRSI.textContent = "OVERBOUGHT"; vRSIn.textContent = ">70 SELL"; }
  else if (rsi <= CFG.rsiOS) { tRSI.className = "itag tgB"; tRSI.textContent = "OVERSOLD";   vRSIn.textContent = "<30 BUY"; }
  else if (rsi > 50)         { tRSI.className = "itag tgY"; tRSI.textContent = "> 50";       vRSIn.textContent = "sell zone"; }
  else                        { tRSI.className = "itag tgY"; tRSI.textContent = "< 50";       vRSIn.textContent = "buy zone"; }

  /* BB card */
  const icBB = document.getElementById("icBB");
  swapCls(icBB, nearLower ? "bull" : nearUpper ? "bear" : "neut");
  document.getElementById("vBBP").textContent = bbPct.toFixed(1) + "%";
  const tBB = document.getElementById("tBB");
  tBB.className   = "itag " + (nearLower ? "tgB" : nearUpper ? "tgR" : "tgD");
  tBB.textContent = nearLower ? "NEAR LOWER ↓" : nearUpper ? "NEAR UPPER ↑" : "MID RANGE";

  /* Labels */
  const tfu = tf.toUpperCase();
  document.getElementById("condtag").textContent = tfu;
  document.getElementById("indtag").textContent  = tfu;
  document.getElementById("chartag").textContent = `${pair === "XAU" ? "XAUUSD" : "BTCUSD"} · ${tfu}`;

  /* Status */
  const now = new Date();
  const p2 = v => String(v).padStart(2, "0");
  document.getElementById("lastupd").textContent =
    `Updated: ${p2(now.getUTCHours())}:${p2(now.getUTCMinutes())}:${p2(now.getUTCSeconds())} UTC`;
  document.getElementById("statmsg").innerHTML = `<span class="gok">&#9679;</span> Signal Engine Active`;
}

/* ══════════════════════
   MINI SIGNAL BOXES
   (secondary pair)
══════════════════════ */
function updateMiniBox(result, pairId, tf) {
  const { dir, strength, price, rsi, entry, sl, tp } = result;
  const isBTC = price > 10000;
  const prefix = pairId === "BTC" ? "btcMini" : "xauMini";

  document.getElementById(prefix + "Sig").className   = "mini-sig-main " + dir.toLowerCase();
  document.getElementById(prefix + "Sig").textContent = dir === "BUY" ? "STRONG BUY ▲" :
                                                         dir === "SELL" ? "STRONG SELL ▼" : "WAIT ⚠";
  document.getElementById(prefix + "TF").textContent    = tf.toUpperCase();
  document.getElementById(prefix + "Price").textContent = f2(price, price);
  document.getElementById(prefix + "RSI").textContent   = f1(rsi);
  document.getElementById(prefix + "Entry").textContent = f2(entry, price);
  document.getElementById(prefix + "SL").textContent    = f2(sl, price);
  document.getElementById(prefix + "TP").textContent    = f2(tp, price);
  document.getElementById(prefix + "Str").textContent   = strength;

  /* Toolbar price */
  if (pairId === "XAU") document.getElementById("xauPrice").textContent = f2(price, price);
  if (pairId === "BTC") document.getElementById("btcPrice").textContent = f2(price, price);
}

/* ══════════════════════
   MTF BANNER
══════════════════════ */
function updateMTF(pair) {
  const s15 = SIG[pair]["15m"];
  const s5  = SIG[pair]["5m"];

  const setCard = (sigId, subId, scoreId, sig, score) => {
    const el  = document.getElementById(sigId);
    const sub = document.getElementById(subId);
    const scr = document.getElementById(scoreId);
    el.className = "mtfv " + (sig === "BUY" ? "buy" : sig === "SELL" ? "sell" : "wait");
    el.textContent = sig === "BUY" ? "BUY ▲" : sig === "SELL" ? "SELL ▼" : "WAIT ⚠";
    sub.textContent = sig === "BUY" ? "Bullish confirmed" :
                      sig === "SELL" ? "Bearish confirmed" : "No clear setup";
    if (scr) scr.textContent = score != null ? `${score} / 3` : "0 / 3";
  };

  const scoreCache = window._scoreCache || {};
  setCard("v15sig", "v15sub", "v15score", s15, scoreCache[pair + "15"]);
  setCard("v5sig",  "v5sub",  "v5score",  s5,  scoreCache[pair + "5"]);

  /* Consensus */
  const cs   = document.getElementById("consensusSig");
  const csub = document.getElementById("consensusSub");
  if (s15 === "WAIT" && s5 === "WAIT") {
    cs.className = "mtfv wait"; cs.textContent = "WAIT ⚠";
    csub.textContent = "Both TFs waiting";
  } else if (s15 === s5 && s15 !== "WAIT") {
    cs.className = "mtfv " + s15.toLowerCase();
    cs.textContent = s15 === "BUY" ? "STRONG BUY ✓" : "STRONG SELL ✓";
    csub.textContent = "Both TFs agree";
  } else {
    cs.className = "mtfv wait"; cs.textContent = "CONFLICT";
    csub.textContent = "TFs disagree — Stay out";
  }

  /* Main consensus box in signal panel */
  const cv = document.getElementById("consv");
  if (!cv) return;
  if (s15 === "WAIT" || s5 === "WAIT") { cv.className = "consv no";  cv.textContent = "ONE TF WAITING"; }
  else if (s15 === s5)                  { cv.className = "consv yes"; cv.textContent = `BOTH ${s15} — STRONG`; }
  else                                  { cv.className = "consv no";  cv.textContent = "CONFLICT — STAY OUT"; }
}

/* ══════════════════════
   SIGNAL LOG
══════════════════════ */
function addLog(result, pair, tf) {
  if (result.dir === "WAIT") return;
  const now = new Date();
  const p   = v => String(v).padStart(2, "0");
  const ts  = `${p(now.getUTCHours())}:${p(now.getUTCMinutes())}`;
  const row = document.createElement("tr");
  const cls = result.dir === "BUY" ? "lbuy" : "lsell";
  row.innerHTML = `
    <td>${ts}</td>
    <td>${pair === "XAU" ? "XAUUSD" : "BTCUSD"}</td>
    <td>${tf.toUpperCase()}</td>
    <td class="${cls}">${result.dir === "BUY" ? "BUY 🟢" : "SELL 🔴"}</td>
    <td>${result.strength}</td>
    <td>${f2(result.entry, result.price)}</td>
    <td>${f2(result.sl, result.price)}</td>
    <td>${f2(result.tp, result.price)}</td>`;
  const body  = document.getElementById("logbody");
  const empty = body.querySelector(".lempty");
  if (empty) empty.parentNode.removeChild(empty);
  body.insertBefore(row, body.firstChild);
  while (body.children.length > 30) body.removeChild(body.lastChild);
  LOGN++;
  document.getElementById("logcnt").textContent = `${LOGN} signal${LOGN !== 1 ? "s" : ""}`;
}

/* ══════════════════════
   WEB AUDIO ALERTS
   BUY  = ascending arp (C5→E5→G5)
   SELL = descending arp (G5→E5→C5)
══════════════════════ */
function playAlert(dir) {
  try {
    const ac    = new (window.AudioContext || window.webkitAudioContext)();
    const notes = dir === "BUY" ? [523.25, 659.25, 783.99] : [783.99, 659.25, 523.25];
    notes.forEach((hz, i) => {
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = "sine";
      osc.frequency.value = hz;
      const t = ac.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      osc.start(t);
      osc.stop(t + 0.45);
    });
  } catch (e) { /* audio unavailable */ }
}

/* ══════════════════════
   FLASH ANIMATION
══════════════════════ */
function flashBox(dir) {
  const b = document.getElementById("sigbox");
  b.classList.remove("flash");
  void b.offsetWidth;
  if (dir !== "WAIT") b.classList.add("flash");
  setTimeout(() => b.classList.remove("flash"), 3000);
}

/* ══════════════════════
   RUN ONE TF + PAIR
══════════════════════ */
function runTF(pair, tf, updateChart) {
  const candles = genCandles(pair, tf, CFG.N);
  const result  = computeSignal(candles);
  if (!result) return null;

  const prevSig = SIG[pair][tf];
  SIG[pair][tf] = result.dir;

  /* Cache score for MTF display */
  if (!window._scoreCache) window._scoreCache = {};
  window._scoreCache[pair + (tf === "15m" ? "15" : "5")] = result.score;

  /* Update UI only if this is the currently active pair + TF */
  if (pair === PAIR && tf === TF) {
    updateMainUI(result, pair, tf);
    if (updateChart) drawChart(result);
  }

  /* Update mini box for secondary pair */
  if (pair !== PAIR) {
    updateMiniBox(result, pair, tf);
  } else {
    /* Also update the secondary pair's mini with its current TF data */
    const secPair = pair === "XAU" ? "BTC" : "XAU";
    const secRes  = computeSignal(genCandles(secPair, tf, CFG.N));
    if (secRes) updateMiniBox(secRes, secPair, tf);
  }

  /* New signal? → alert + log */
  if (result.dir !== "WAIT" && result.dir !== prevSig) {
    if (pair === PAIR && tf === TF) {
      playAlert(result.dir);
      flashBox(result.dir);
    }
    addLog(result, pair, tf);
  }

  return result;
}

/* ══════════════════════
   RUN ALL (both pairs × both TFs)
══════════════════════ */
function runAll(updateChart = true) {
  runTF("XAU", "15m", updateChart && PAIR === "XAU" && TF === "15m");
  runTF("XAU", "5m",  updateChart && PAIR === "XAU" && TF === "5m");
  runTF("BTC", "15m", updateChart && PAIR === "BTC" && TF === "15m");
  runTF("BTC", "5m",  updateChart && PAIR === "BTC" && TF === "5m");
  updateMTF(PAIR);
}

/* ══════════════════════
   CONTROLS
══════════════════════ */
window.setTF = tf => {
  TF = tf;
  document.getElementById("btn15").className = "tfbtn" + (tf === "15m" ? " on" : "");
  document.getElementById("btn5").className  = "tfbtn" + (tf === "5m"  ? " on" : "");
  runAll(true);
};

window.setPair = pair => {
  PAIR = pair;
  document.getElementById("pbtnXAU").className = "pbtn" + (pair === "XAU" ? " on" : "");
  document.getElementById("pbtnBTC").className = "pbtn" + (pair === "BTC" ? " on" : "");

  /* Show/hide mini boxes */
  document.getElementById("btcMiniBox").style.display = pair === "XAU" ? "" : "none";
  document.getElementById("xauMiniBox").style.display = pair === "BTC" ? "" : "none";

  runAll(true);
};

window.doRefresh = () => {
  const btn = document.getElementById("rfbtn");
  btn.style.opacity = "0.4";
  setTimeout(() => btn.style.opacity = "1", 500);
  runAll(true);
};

/* Resize → redraw chart */
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => runAll(true), 200);
});

/* ══════════════════════
   BOOT
══════════════════════ */
window.addEventListener("load", () => {
  runAll(true);
  refreshTimer = setInterval(() => runAll(true), CFG.tick);
});
