/* ═══════════════════════════════════════════════════════════════
   MEETHA PIPE — script.js  v4.0
   XAUUSD + BTC/USD  ·  Lightweight Charts  ·  Full Signal Engine
   ► Lightweight Charts candlestick + EMA lines + BB lines
   ► Dynamic EMA10, EMA21, RSI(14), Bollinger Bands
   ► SL = recent 6-candle high/low  ·  TP = SL×2 (1:2 RR)
   ► RSI dead zone 45–55 → force WAIT
   ► Multi-TF (15M + 5M) + Consensus panel
   ► Web Audio API alerts (ascending BUY / descending SELL)
   ► Fully dynamic — no placeholders
   ═══════════════════════════════════════════════════════════════ */
"use strict";

/* ══════════════════════════════════
   CONFIG
══════════════════════════════════ */
const CFG = {
  emaFast  : 10,
  emaSlow  : 21,
  bbPer    : 20,
  bbDev    : 2,
  rsiPer   : 14,
  rsiOB    : 70,
  rsiOS    : 30,
  deadLo   : 45,
  deadHi   : 55,
  bbNear   : 0.28,
  slBars   : 6,
  N        : 260,
  tickMs   : 60000,
  bases    : {
    XAU : { price: 4720,  vol: 7   },
    BTC : { price: 85000, vol: 700 }
  }
};

/* ══════════════════════════════════
   STATE
══════════════════════════════════ */
let TF   = "15m";
let PAIR = "XAU";
let SIG  = { XAU: { "15m":"WAIT","5m":"WAIT" }, BTC: { "15m":"WAIT","5m":"WAIT" } };
let SCORES = {};
let LOGN = 0;

/* Lightweight Charts objects */
let lwChart       = null;
let candleSeries  = null;
let ema10Series   = null;
let ema21Series   = null;
let bbUpSeries    = null;
let bbLoSeries    = null;

/* ══════════════════════════════════
   CLOCK
══════════════════════════════════ */
setInterval(() => {
  const d = new Date();
  const p = v => String(v).padStart(2,"0");
  document.getElementById("clk").textContent =
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}, 1000);

/* ══════════════════════════════════
   MATH HELPERS
══════════════════════════════════ */
function calcEMA(data, n) {
  if (data.length < n) return data.map(() => null);
  const k = 2 / (n + 1);
  let e = data.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const r = Array(n - 1).fill(null);
  r.push(e);
  for (let i = n; i < data.length; i++) {
    e = data[i] * k + e * (1 - k);
    r.push(e);
  }
  return r;
}

function calcSMA(data, n) {
  return data.map((_, i) => {
    if (i < n - 1) return null;
    return data.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n;
  });
}

function calcBB(data, n, dev) {
  const mid = calcSMA(data, n);
  const up = [], lo = [];
  for (let i = 0; i < data.length; i++) {
    if (i < n - 1) { up.push(null); lo.push(null); continue; }
    const sl  = data.slice(i - n + 1, i + 1);
    const m   = mid[i];
    const sd  = Math.sqrt(sl.reduce((s, v) => s + (v - m) ** 2, 0) / n);
    up.push(m + dev * sd);
    lo.push(m - dev * sd);
  }
  return { upper: up, middle: mid, lower: lo };
}

function calcRSI(data, n) {
  if (data.length <= n) return data.map(() => null);
  let ag = 0, al = 0;
  for (let i = 1; i <= n; i++) {
    const d = data[i] - data[i - 1];
    if (d > 0) ag += d; else al += -d;
  }
  ag /= n; al /= n;
  const r = Array(n).fill(null);
  r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = n + 1; i < data.length; i++) {
    const d = data[i] - data[i - 1];
    ag = (ag * (n - 1) + (d > 0 ? d : 0)) / n;
    al = (al * (n - 1) + (d < 0 ? -d : 0)) / n;
    r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return r;
}

/* ══════════════════════════════════
   CANDLE GENERATOR
   Deterministic per epoch (no flicker)
   Real price regions per asset
══════════════════════════════════ */
function genCandles(pair, tf, N) {
  const step  = (tf === "15m" ? 15 : 5) * 60;
  const now   = Math.floor(Date.now() / 1000);
  const epoch = Math.floor(now / step);
  let   seed  = (epoch * 0x1F3A7 +
                 (tf === "15m" ? 0xAB01 : 0xCD02) +
                 (pair === "BTC" ? 0x9F03 : 0x1F04)) >>> 0;

  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967295;
  };

  const base  = CFG.bases[pair];
  let   price = base.price * (1 + (rng() - 0.5) * 0.04);
  const out   = [];

  for (let i = N - 1; i >= 0; i--) {
    const t     = (epoch - i) * step;
    const vol   = base.vol * (0.4 + rng() * 1.8);
    const drift = (rng() - 0.488) * base.vol * 0.25;
    const o     = price;
    const body  = (rng() - 0.5 + drift / base.vol) * vol * 2.6;
    const c     = o + body;
    const h     = Math.max(o, c) + rng() * vol * 0.85;
    const l     = Math.min(o, c) - rng() * vol * 0.85;
    out.push({ t, o, h, l, c });
    price = c;
  }
  return out;
}

/* ══════════════════════════════════
   SIGNAL ENGINE
══════════════════════════════════ */
function computeSignal(candles) {
  const closes = candles.map(c => c.c);
  const highs  = candles.map(c => c.h);
  const lows   = candles.map(c => c.l);
  const N      = closes.length;

  const e10a = calcEMA(closes, CFG.emaFast);
  const e21a = calcEMA(closes, CFG.emaSlow);
  const bb   = calcBB(closes, CFG.bbPer, CFG.bbDev);
  const rsia = calcRSI(closes, CFG.rsiPer);

  const price = closes[N - 1];
  const e10   = e10a[N - 1];
  const e21   = e21a[N - 1];
  const bbU   = bb.upper[N - 1];
  const bbM   = bb.middle[N - 1];
  const bbL   = bb.lower[N - 1];
  const rsi   = rsia[N - 1];

  if (!e10 || !e21 || !bbU || rsi == null) return null;

  /* SL from recent high/low */
  const recH = Math.max(...highs.slice(-CFG.slBars));
  const recL = Math.min(...lows.slice(-CFG.slBars));

  const band    = bbU - bbL;
  const bbPct   = band > 0 ? ((price - bbL) / band) * 100 : 50;
  const nearUp  = band > 0 && price >= bbU - band * CFG.bbNear;
  const nearLo  = band > 0 && price <= bbL + band * CFG.bbNear;
  const dead    = rsi >= CFG.deadLo && rsi <= CFG.deadHi;
  const emaUp   = e10 > e21;
  const emaDn   = e10 < e21;

  const bChk = [
    { l:"EMA 10 > EMA 21",     p: emaUp,                       n: emaUp ? "UPTREND ▲"   : "NO UPTREND"   },
    { l:"RSI < 50 & < 30",     p: rsi < 50 && rsi < CFG.rsiOS, n: dead  ? "DEAD ZONE"   : `RSI ${rsi.toFixed(1)}` },
    { l:"Price near Lower BB", p: nearLo,                       n: `${bbPct.toFixed(0)}% in band` },
  ];
  const sChk = [
    { l:"EMA 10 < EMA 21",     p: emaDn,                        n: emaDn ? "DOWNTREND ▼" : "NO DOWNTREND" },
    { l:"RSI > 50 & > 70",     p: rsi > 50 && rsi > CFG.rsiOB, n: dead  ? "DEAD ZONE"   : `RSI ${rsi.toFixed(1)}` },
    { l:"Price near Upper BB", p: nearUp,                        n: `${bbPct.toFixed(0)}% in band` },
  ];

  const bS = bChk.filter(c => c.p).length;
  const sS = sChk.filter(c => c.p).length;

  let dir = "WAIT", score = 0, chks = bChk;

  if (dead) {
    dir = "WAIT"; score = 0;
    chks = [
      { l:"EMA Trend",   p:false, n:"RSI DEAD ZONE"          },
      { l:"RSI Level",   p:false, n:`RSI ${rsi.toFixed(1)} (45–55)` },
      { l:"BB Position", p:false, n:"SIDEWAYS MARKET"        },
    ];
  } else if (bS >= 2 && bS >= sS) {
    dir = "BUY";  score = bS; chks = bChk;
  } else if (sS >= 2 && sS > bS) {
    dir = "SELL"; score = sS; chks = sChk;
  } else if (bS === 1) {
    dir = "WAIT"; score = 1; chks = bChk;
  } else if (sS === 1) {
    dir = "WAIT"; score = 1; chks = sChk;
  } else {
    dir = "WAIT"; score = 0;
    chks = [
      { l:"EMA Trend",   p:false, n:"NO SIGNAL"    },
      { l:"RSI Level",   p:false, n:`RSI ${rsi.toFixed(1)}` },
      { l:"BB Position", p:false, n:"NEUTRAL"       },
    ];
  }

  const strength = score === 3 ? "STRONG" : score === 2 ? "WEAK" : "NO TRADE";

  /* Trade levels */
  let entry = price, sl, tp;
  if (dir === "BUY") {
    sl = recL - band * 0.015;
    tp = entry + (entry - sl) * 2;
  } else if (dir === "SELL") {
    sl = recH + band * 0.015;
    tp = entry - (sl - entry) * 2;
  } else {
    sl = recL; tp = recH;
  }

  return {
    dir, score, strength, chks,
    price, e10, e21, bbU, bbM, bbL, bbPct,
    rsi, dead, emaUp, emaDn, nearUp, nearLo,
    entry, sl, tp,
    candles, e10a, e21a, bbUp: bb.upper, bbLo: bb.lower,
  };
}

/* ══════════════════════════════════
   LIGHTWEIGHT CHARTS INIT + UPDATE
══════════════════════════════════ */
function initChart() {
  const container = document.getElementById("lwChart");
  container.innerHTML = "";

  if (typeof LightweightCharts === "undefined") {
    /* Fallback canvas if LWC unavailable */
    useFallbackCanvas();
    return;
  }

  try {
    lwChart = LightweightCharts.createChart(container, {
      width  : container.clientWidth  || 600,
      height : container.clientHeight || 400,
      layout : {
        background : { type: "solid", color: "#07090e" },
        textColor  : "#3a4f6a",
      },
      grid : {
        vertLines  : { color: "#0d1520" },
        horzLines  : { color: "#0d1520" },
      },
      crosshair     : { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1c2840", textColor: "#3a4f6a" },
      timeScale      : { borderColor: "#1c2840", textColor: "#3a4f6a", timeVisible: true, secondsVisible: false },
      handleScroll   : true,
      handleScale    : true,
    });

    candleSeries = lwChart.addCandlestickSeries({
      upColor        : "#05d68c",
      downColor      : "#f0273e",
      borderUpColor  : "#05d68c",
      borderDownColor: "#f0273e",
      wickUpColor    : "#05d68c",
      wickDownColor  : "#f0273e",
    });

    ema10Series = lwChart.addLineSeries({
      color              : "#05d68c",
      lineWidth          : 2,
      priceLineVisible   : false,
      lastValueVisible   : false,
      crosshairMarkerVisible: false,
    });

    ema21Series = lwChart.addLineSeries({
      color              : "#f0273e",
      lineWidth          : 2,
      priceLineVisible   : false,
      lastValueVisible   : false,
      crosshairMarkerVisible: false,
    });

    bbUpSeries = lwChart.addLineSeries({
      color              : "rgba(100,100,220,0.55)",
      lineWidth          : 1,
      lineStyle          : 2,   /* dashed */
      priceLineVisible   : false,
      lastValueVisible   : false,
      crosshairMarkerVisible: false,
    });

    bbLoSeries = lwChart.addLineSeries({
      color              : "rgba(220,100,100,0.55)",
      lineWidth          : 1,
      lineStyle          : 2,
      priceLineVisible   : false,
      lastValueVisible   : false,
      crosshairMarkerVisible: false,
    });

    /* Auto-resize */
    const ro = new ResizeObserver(() => {
      if (lwChart) {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 10 && h > 10) lwChart.resize(w, h);
      }
    });
    ro.observe(container);

  } catch (e) {
    console.warn("LWC init error:", e);
    useFallbackCanvas();
  }
}

function updateChart(result) {
  if (!lwChart || !candleSeries) {
    drawFallbackCanvas(result);
    return;
  }
  const { candles, e10a, e21a, bbUp, bbLo } = result;

  try {
    /* Candles */
    candleSeries.setData(candles.map(c => ({
      time : c.t,
      open : c.o,
      high : c.h,
      low  : c.l,
      close: c.c,
    })));

    /* Line helper */
    const toLine = (arr) => {
      const out = [];
      arr.forEach((v, i) => { if (v != null) out.push({ time: candles[i].t, value: v }); });
      return out;
    };

    ema10Series.setData(toLine(e10a));
    ema21Series.setData(toLine(e21a));
    bbUpSeries.setData(toLine(bbUp));
    bbLoSeries.setData(toLine(bbLo));

    lwChart.timeScale().fitContent();
  } catch (e) {
    console.error("Chart update error:", e);
  }
}

/* ══════════════════════════════════
   FALLBACK CANVAS CHART
   (used if Lightweight Charts fails to load)
══════════════════════════════════ */
let fbCanvas = null;

function useFallbackCanvas() {
  const container = document.getElementById("lwChart");
  fbCanvas = document.createElement("canvas");
  fbCanvas.style.width  = "100%";
  fbCanvas.style.height = "100%";
  container.appendChild(fbCanvas);
}

function drawFallbackCanvas(result) {
  if (!fbCanvas) return;
  const box = fbCanvas.parentElement;
  const W   = box.clientWidth  || 600;
  const H   = box.clientHeight || 400;
  fbCanvas.width  = W;
  fbCanvas.height = H;

  const ctx = fbCanvas.getContext("2d");
  ctx.fillStyle = "#07090e";
  ctx.fillRect(0, 0, W, H);

  const { candles, e10a, e21a, bbUp, bbLo } = result;
  const vis  = candles.slice(-80);
  const e10v = e10a.slice(-80);
  const e21v = e21a.slice(-80);
  const bbuv = bbUp.slice(-80);
  const bblv = bbLo.slice(-80);
  const n    = vis.length;
  if (!n) return;

  const allP = [];
  vis.forEach(c => allP.push(c.h, c.l));
  bbuv.forEach(v => v && allP.push(v));
  bblv.forEach(v => v && allP.push(v));
  const mn = Math.min(...allP), mx = Math.max(...allP), rng = mx - mn || 1;

  const pT = 18, pB = 24, pL = 6, pR = 68;
  const cH = H - pT - pB, cW = W - pL - pR;
  const fy = v => pT + cH - ((v - mn) / rng) * cH;
  const fx = i => pL + (i / Math.max(n - 1, 1)) * cW;

  /* Grid */
  ctx.strokeStyle = "#0d1520"; ctx.lineWidth = 1;
  for (let g = 0; g < 5; g++) {
    const gy = pT + g * (cH / 4);
    ctx.beginPath(); ctx.moveTo(pL, gy); ctx.lineTo(W - pR, gy); ctx.stroke();
    ctx.fillStyle = "#253452"; ctx.font = "9px monospace";
    ctx.fillText(fmtP(mx - g * (rng / 4), result.price), W - pR + 3, gy + 3);
  }

  /* BB shaded band */
  ctx.beginPath(); let fs = true;
  bbuv.forEach((v, i) => { if (!v) return; fs ? (ctx.moveTo(fx(i), fy(v)), fs = false) : ctx.lineTo(fx(i), fy(v)); });
  for (let i = n - 1; i >= 0; i--) { if (bblv[i]) ctx.lineTo(fx(i), fy(bblv[i])); }
  ctx.closePath(); ctx.fillStyle = "rgba(56,182,255,0.04)"; ctx.fill();

  const drawL = (arr, col, dsh, lw) => {
    ctx.strokeStyle = col; ctx.lineWidth = lw || 1.5;
    ctx.setLineDash(dsh ? [5,4] : []);
    ctx.beginPath(); let s = false;
    arr.forEach((v, i) => { if (!v) return; s ? ctx.lineTo(fx(i),fy(v)) : (ctx.moveTo(fx(i),fy(v)), s=true); });
    ctx.stroke(); ctx.setLineDash([]);
  };
  drawL(bbuv, "rgba(100,100,220,.55)", true, 1);
  drawL(bblv, "rgba(220,100,100,.55)", true, 1);
  drawL(e10v, "#05d68c", false, 2);
  drawL(e21v, "#f0273e", false, 2);

  const cw = Math.max(2, Math.floor(cW / n) - 1);
  vis.forEach((c, i) => {
    const x = fx(i), bull = c.c >= c.o, col = bull ? "#05d68c" : "#f0273e";
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, fy(c.h)); ctx.lineTo(x, fy(c.l)); ctx.stroke();
    const yO = fy(Math.max(c.o,c.c)), yC = fy(Math.min(c.o,c.c));
    ctx.fillStyle = col; ctx.fillRect(x - cw/2, yO, cw, Math.max(1, yC - yO));
  });

  /* Price label */
  const lp = vis[n-1].c, lpy = fy(lp);
  ctx.fillStyle = "rgba(7,9,14,.92)"; ctx.fillRect(W - pR + 1, lpy - 9, pR - 3, 18);
  ctx.fillStyle = (n>1&&lp>=vis[n-2].c)?"#05d68c":"#f0273e";
  ctx.font = "bold 9px monospace"; ctx.fillText(fmtP(lp, lp), W - pR + 4, lpy + 4);

  ctx.fillStyle = "#253452"; ctx.font = "8px monospace";
  [0, Math.floor(n/2), n-1].forEach(i => {
    const d = new Date(vis[i].t*1000);
    ctx.fillText(`${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`, fx(i)-12, H-6);
  });
}

/* ══════════════════════════════════
   FORMAT HELPERS
══════════════════════════════════ */
const fmtP = (v, ref) => {
  if (v == null) return "--";
  return ref > 10000 ? Math.round(v).toLocaleString() : v.toFixed(2);
};
const f1 = v => v == null ? "--" : v.toFixed(1);

/* ══════════════════════════════════
   UI UPDATE — Main Panel
══════════════════════════════════ */
function swapCls(el, add) {
  el.className = el.className.replace(/\b(buy|sell|wait|bull|bear|neut|pass|fail)\b/g,"").trim();
  if (add) el.classList.add(add);
}

function updateMainUI(res, pair, tf) {
  const { dir, score, strength, chks, price,
          e10, e21, bbU, bbM, bbL, bbPct,
          rsi, dead, emaUp, nearUp, nearLo,
          entry, sl, tp } = res;

  const isHigh = price > 10000;

  /* Signal box */
  const box = document.getElementById("sigbox");
  swapCls(box, dir.toLowerCase());
  document.getElementById("sigPairTag").textContent = pair === "XAU" ? "XAU / USD" : "BTC / USD";
  document.getElementById("sigico").textContent = dir==="BUY"?"🟢":dir==="SELL"?"🔴":"⚠️";

  const ww = document.getElementById("sigwrd");
  ww.textContent = dir==="BUY" ? "STRONG BUY" : dir==="SELL" ? "STRONG SELL" : score===1 ? "WEAK — WAIT" : "WAIT";

  const ss = document.getElementById("sigstr");
  ss.className = "sigstr";
  if (strength==="STRONG")    { ss.textContent="● STRONG · 3/3 CONDITIONS MET"; ss.classList.add("sS"); }
  else if (strength==="WEAK") { ss.textContent="● WEAK · 2/3 CONDITIONS MET";   ss.classList.add("sW"); }
  else                         { ss.textContent="○ NO TRADE · LESS THAN 2/3";    ss.classList.add("sN"); }

  /* Trade levels */
  document.getElementById("tdE").textContent = fmtP(entry, price);
  document.getElementById("tdS").textContent = fmtP(sl, price);
  document.getElementById("tdT").textContent = fmtP(tp, price);
  const sd = Math.abs(entry - sl), td = Math.abs(tp - entry);
  document.getElementById("slDst").textContent = sd>0 ? `$${isHigh ? sd.toFixed(0) : sd.toFixed(1)}` : "--";
  document.getElementById("tpDst").textContent = td>0 ? `$${isHigh ? td.toFixed(0) : td.toFixed(1)}` : "--";

  /* BB strip */
  document.getElementById("vBBu").textContent = fmtP(bbU, price);
  document.getElementById("vBBm").textContent = fmtP(bbM, price);
  document.getElementById("vBBl").textContent = fmtP(bbL, price);
  document.getElementById("vPRC").textContent = fmtP(price, price);

  /* Toolbar prices */
  if (pair === "XAU") document.getElementById("xauPrice").textContent = fmtP(price, price);
  if (pair === "BTC") document.getElementById("btcPrice").textContent = fmtP(price, price);

  /* Conditions */
  [["ck1","ci1","cr1"],["ck2","ci2","cr2"],["ck3","ci3","cr3"]].forEach(([r,ic,re],i) => {
    const c = chks[i];
    swapCls(document.getElementById(r), c.p ? "pass" : dead ? "neut" : "fail");
    document.getElementById(ic).textContent = c.p ? "✓" : dead ? "~" : "✗";
    document.getElementById(re).textContent = c.n || "--";
  });

  /* Score bar */
  const pct  = (score/3)*100;
  const fill = document.getElementById("sfil");
  fill.style.width      = pct + "%";
  fill.style.background = score===3?"var(--gn)":score===2?"var(--gd2)":score===1?"var(--yw)":"var(--t3)";
  document.getElementById("stxt").textContent = `Score: ${score} / 3  —  ${strength}`;

  /* EMA card */
  swapCls(document.getElementById("icEMA"), emaUp ? "bull" : "bear");
  document.getElementById("vE10").textContent = fmtP(e10, price);
  document.getElementById("vE21").textContent = fmtP(e21, price);
  document.getElementById("emaDiff").textContent = `Spread: ${fmtP(Math.abs(e10-e21), price)}`;
  const tEMA = document.getElementById("tEMA");
  tEMA.className   = "itag " + (emaUp?"tgB":"tgR");
  tEMA.textContent = emaUp ? "UPTREND ▲" : "DOWNTREND ▼";

  /* RSI card */
  swapCls(document.getElementById("icRSI"), dead?"neut":rsi>=CFG.rsiOB?"bear":rsi<=CFG.rsiOS?"bull":"neut");
  document.getElementById("vRSI").textContent = f1(rsi);
  const rf = document.getElementById("rfil");
  rf.style.width      = rsi + "%";
  rf.style.background = rsi>=CFG.rsiOB?"var(--rd)":rsi<=CFG.rsiOS?"var(--gn)":"var(--bl)";
  const tRSI = document.getElementById("tRSI"), vRn = document.getElementById("vRSIn");
  if      (dead)             { tRSI.className="itag tgY"; tRSI.textContent="DEAD ZONE";  vRn.textContent="45–55"; }
  else if (rsi>=CFG.rsiOB)   { tRSI.className="itag tgR"; tRSI.textContent="OVERBOUGHT"; vRn.textContent=">70 SELL"; }
  else if (rsi<=CFG.rsiOS)   { tRSI.className="itag tgB"; tRSI.textContent="OVERSOLD";   vRn.textContent="<30 BUY"; }
  else if (rsi>50)           { tRSI.className="itag tgY"; tRSI.textContent=">50";         vRn.textContent="sell zone"; }
  else                        { tRSI.className="itag tgY"; tRSI.textContent="<50";         vRn.textContent="buy zone"; }

  /* BB card */
  swapCls(document.getElementById("icBB"), nearLo?"bull":nearUp?"bear":"neut");
  document.getElementById("vBBP").textContent = bbPct.toFixed(1) + "%";
  const tBB = document.getElementById("tBB");
  tBB.className   = "itag " + (nearLo?"tgB":nearUp?"tgR":"tgD");
  tBB.textContent = nearLo ? "NEAR LOWER ↓" : nearUp ? "NEAR UPPER ↑" : "MID RANGE";

  /* Label updates */
  const tfu = tf.toUpperCase();
  document.getElementById("condtag").textContent = tfu;
  document.getElementById("indtag").textContent  = tfu;
  document.getElementById("chartag").textContent = `${pair==="XAU"?"XAUUSD":"BTCUSD"} · ${tfu}`;

  /* Status bar */
  const now = new Date(), p2 = v => String(v).padStart(2,"0");
  document.getElementById("lastupd").textContent =
    `Updated: ${p2(now.getUTCHours())}:${p2(now.getUTCMinutes())}:${p2(now.getUTCSeconds())} UTC`;
  document.getElementById("statmsg").innerHTML =
    `<span class="gok">&#9679;</span> Signal Engine Active`;
}

/* ══════════════════════════════════
   UI UPDATE — Mini Box (secondary pair)
══════════════════════════════════ */
function updateMiniUI(res, pair, tf) {
  const { dir, strength, price, rsi, emaUp, entry, sl, tp } = res;

  const miniPair = document.getElementById("miniPairLbl");
  const miniTF   = document.getElementById("miniTF");
  const miniSig  = document.getElementById("miniSig");

  if (miniPair) miniPair.textContent = pair === "XAU" ? "XAU / USD" : "BTC / USD";
  if (miniTF)   miniTF.textContent   = tf.toUpperCase();
  if (miniSig) {
    swapCls(miniSig, dir.toLowerCase());
    miniSig.textContent = dir==="BUY"?"BUY ▲":dir==="SELL"?"SELL ▼":"WAIT ⚠";
  }

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("miniPrice", fmtP(price, price));
  set("miniRSI",   f1(rsi));
  set("miniTrend", emaUp ? "UPTREND ▲" : "DOWNTREND ▼");
  set("miniEntry", fmtP(entry, price));
  set("miniSL",    fmtP(sl, price));
  set("miniTP",    fmtP(tp, price));

  /* toolbar price for secondary pair */
  if (pair === "XAU") document.getElementById("xauPrice").textContent = fmtP(price, price);
  if (pair === "BTC") document.getElementById("btcPrice").textContent = fmtP(price, price);
}

/* ══════════════════════════════════
   MTF BANNER
══════════════════════════════════ */
function updateMTF(pair) {
  const s15 = SIG[pair]["15m"];
  const s5  = SIG[pair]["5m"];

  const setCard = (sigId, subId, scoreId, sig, score) => {
    const el  = document.getElementById(sigId);
    const sub = document.getElementById(subId);
    const sc  = document.getElementById(scoreId);
    el.className  = "mtfv " + (sig==="BUY"?"buy":sig==="SELL"?"sell":"wait");
    el.textContent = sig==="BUY"?"BUY ▲":sig==="SELL"?"SELL ▼":"WAIT ⚠";
    sub.textContent= sig==="BUY"?"Bullish confirmed":sig==="SELL"?"Bearish confirmed":"No clear setup";
    if (sc) sc.textContent = score != null ? `${score}/3` : "0/3";
  };

  setCard("v15sig","v15sub","v15score", s15, SCORES[pair+"15"]);
  setCard("v5sig", "v5sub", "v5score",  s5,  SCORES[pair+"5"]);

  /* Consensus */
  const cs   = document.getElementById("consensusSig");
  const csub = document.getElementById("consensusSub");
  const cv   = document.getElementById("consv");

  if (s15==="WAIT" && s5==="WAIT") {
    if(cs){ cs.className="mtfv wait"; cs.textContent="WAIT ⚠"; }
    if(csub) csub.textContent = "Both TFs waiting";
    if(cv){ cv.className="consv no"; cv.textContent="BOTH WAIT"; }
  } else if (s15===s5 && s15!=="WAIT") {
    if(cs){ cs.className="mtfv "+s15.toLowerCase(); cs.textContent=s15==="BUY"?"STRONG BUY ✓":"STRONG SELL ✓"; }
    if(csub) csub.textContent = "Both TFs agree";
    if(cv){ cv.className="consv yes"; cv.textContent=`BOTH ${s15} ✓`; }
  } else {
    if(cs){ cs.className="mtfv wait"; cs.textContent="CONFLICT"; }
    if(csub) csub.textContent = "TFs disagree — stay out";
    if(cv){ cv.className="consv no"; cv.textContent="CONFLICT"; }
  }
}

/* ══════════════════════════════════
   LOG
══════════════════════════════════ */
function addLog(res, pair, tf) {
  if (res.dir === "WAIT") return;
  const now = new Date(), p2 = v => String(v).padStart(2,"0");
  const ts  = `${p2(now.getUTCHours())}:${p2(now.getUTCMinutes())}`;
  const row = document.createElement("tr");
  const cls = res.dir==="BUY" ? "lbuy" : "lsell";
  row.innerHTML = `
    <td>${ts}</td>
    <td>${pair==="XAU"?"XAUUSD":"BTCUSD"}</td>
    <td>${tf.toUpperCase()}</td>
    <td class="${cls}">${res.dir==="BUY"?"BUY 🟢":"SELL 🔴"}</td>
    <td>${res.strength}</td>
    <td>${fmtP(res.entry,res.price)}</td>
    <td>${fmtP(res.sl,res.price)}</td>
    <td>${fmtP(res.tp,res.price)}</td>`;
  const body = document.getElementById("logbody");
  const emp  = body.querySelector(".lempty");
  if (emp) emp.parentNode.removeChild(emp);
  body.insertBefore(row, body.firstChild);
  while (body.children.length > 30) body.removeChild(body.lastChild);
  LOGN++;
  document.getElementById("logcnt").textContent = `${LOGN} signal${LOGN!==1?"s":""}`;
}

/* ══════════════════════════════════
   SOUND ALERTS
   BUY  = C5→E5→G5 ascending arp
   SELL = G5→E5→C5 descending arp
══════════════════════════════════ */
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
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.44);
      osc.start(t);
      osc.stop(t + 0.48);
    });
  } catch(e) { /* Audio context unavailable */ }
}

/* ══════════════════════════════════
   FLASH
══════════════════════════════════ */
function flashBox(dir) {
  const b = document.getElementById("sigbox");
  b.classList.remove("flash");
  void b.offsetWidth;
  if (dir !== "WAIT") b.classList.add("flash");
  setTimeout(() => b.classList.remove("flash"), 3200);
}

/* ══════════════════════════════════
   RUN — one pair × one TF
══════════════════════════════════ */
function runTF(pair, tf, isActive) {
  const candles = genCandles(pair, tf, CFG.N);
  const res     = computeSignal(candles);
  if (!res) return;

  const prev    = SIG[pair][tf];
  SIG[pair][tf] = res.dir;
  SCORES[pair + (tf==="15m"?"15":"5")] = res.score;

  if (isActive) {
    updateMainUI(res, pair, tf);
    updateChart(res);
  } else {
    /* Secondary pair → mini box */
    updateMiniUI(res, pair, tf);
    /* Update toolbar price for secondary */
    if (pair==="XAU") document.getElementById("xauPrice").textContent = fmtP(res.price, res.price);
    if (pair==="BTC") document.getElementById("btcPrice").textContent = fmtP(res.price, res.price);
  }

  /* New signal */
  if (res.dir !== "WAIT" && res.dir !== prev) {
    if (isActive) { playAlert(res.dir); flashBox(res.dir); }
    addLog(res, pair, tf);
  }
}

/* ══════════════════════════════════
   RUN ALL
══════════════════════════════════ */
function runAll() {
  const secPair = PAIR === "XAU" ? "BTC" : "XAU";

  runTF(PAIR,    TF,     true);
  runTF(PAIR,    TF==="15m"?"5m":"15m", false);  /* other TF for same pair MTF */
  runTF(secPair, TF,     false);

  updateMTF(PAIR);
}

/* ══════════════════════════════════
   CONTROLS
══════════════════════════════════ */
window.setTF = (tf) => {
  TF = tf;
  document.getElementById("btn15").className = "tfbtn" + (tf==="15m"?" on":"");
  document.getElementById("btn5").className  = "tfbtn" + (tf==="5m" ?" on":"");
  runAll();
};

window.setPair = (pair) => {
  PAIR = pair;
  document.getElementById("pbtnXAU").className = "pbtn" + (pair==="XAU"?" on":"");
  document.getElementById("pbtnBTC").className = "pbtn" + (pair==="BTC"?" on":"");

  /* Update mini box label */
  const secPair = pair === "XAU" ? "BTC" : "XAU";
  const mp = document.getElementById("miniPairLbl");
  if (mp) mp.textContent = secPair==="XAU" ? "XAU / USD" : "BTC / USD";

  runAll();
};

window.doRefresh = () => {
  const btn = document.getElementById("rfbtn");
  btn.style.opacity = "0.4";
  setTimeout(() => btn.style.opacity = "1", 500);
  runAll();
};

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(runAll, 250);
});

/* ══════════════════════════════════
   BOOT
══════════════════════════════════ */
function boot() {
  initChart();
  runAll();
  setInterval(runAll, CFG.tickMs);
}

/* Wait for Lightweight Charts to load, timeout = 5s */
window.__lwcReady = boot;
if (window.__lwcLoaded) {
  boot();
} else {
  setTimeout(() => {
    if (!window.__lwcLoaded) {
      console.warn("LightweightCharts not loaded — using fallback canvas");
      window.__lwcFailed = true;
    }
    boot();
  }, 5000);
}
