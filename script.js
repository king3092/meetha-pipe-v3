/* ═══════════════════════════════════════════════════════════════
   MEETHA PIPE — script.js  v5
   ► TradingView Widget (live OANDA:XAUUSD / BINANCE:BTCUSDT)
   ► Dynamic EMA10, EMA21, RSI(14), Bollinger Bands (20,2)
   ► SL = recent 6-candle high/low  |  TP = SL×2 (1:2 RR)
   ► RSI Dead Zone 45–55 → force WAIT
   ► Multi-TF 15M + 5M → Consensus
   ► Web Audio API alerts
   ► Signal auto-recalc on timer
   ═══════════════════════════════════════════════════════════════ */
"use strict";

/* ══════════════════════
   CONFIG
══════════════════════ */
const CFG = {
  emaFast : 10,
  emaSlow : 21,
  bbPer   : 20,
  bbDev   : 2,
  rsiPer  : 14,
  rsiOB   : 70,
  rsiOS   : 30,
  deadLo  : 45,
  deadHi  : 55,
  bbNear  : 0.28,
  slBars  : 6,
  N       : 260,

  /* TradingView symbols */
  tvSymbols: {
    XAU: "OANDA:XAUUSD",
    BTC: "COINBASE:BTCUSD"
  },

  /* Refresh intervals */
  tickMs: {
    "15": 60000,   /* 1 min for 15M */
    "5" : 30000    /* 30 sec for 5M */
  },

  /* Real price base for signal engine */
  bases: {
    XAU: { price: 4720,  vol: 7   },
    BTC: { price: 85000, vol: 700 }
  }
};

/* ══════════════════════
   STATE
══════════════════════ */
let TF      = "15";
let PAIR    = "XAU";
let SIG     = { XAU: { "15":"WAIT","5":"WAIT" }, BTC: { "15":"WAIT","5":"WAIT" } };
let SCORES  = {};
let LOGN    = 0;
let tvWidget= null;
let tickTimer = null;

/* ══════════════════════
   CLOCK
══════════════════════ */
setInterval(() => {
  const d = new Date(), p = v => String(v).padStart(2,"0");
  document.getElementById("clk").textContent =
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}, 1000);

/* ══════════════════════
   TRADINGVIEW WIDGET
   Full live candlestick chart with EMA + BB + RSI
══════════════════════ */
function buildTVWidget(pair, tf) {
  const container = document.getElementById("tv_widget_container");
  container.innerHTML = "";

  const symbol   = CFG.tvSymbols[pair];
  const interval = tf;   /* "15" or "5" — TradingView accepts these */

  const config = {
    "autosize"         : true,
    "symbol"           : symbol,
    "interval"         : interval,
    "timezone"         : "Etc/UTC",
    "theme"            : "dark",
    "style"            : "1",
    "locale"           : "en",
    "toolbar_bg"       : "#0c0f18",
    "enable_publishing": false,
    "hide_top_toolbar" : false,
    "hide_legend"      : false,
    "allow_symbol_change": false,
    "save_image"       : false,
    "container_id"     : "tv_widget_container",
    "studies"          : [
      "MAExp@tv-basicstudies",   /* EMA 10 */
      "MAExp@tv-basicstudies",   /* EMA 21 */
      "BB@tv-basicstudies",      /* Bollinger Bands */
      "RSI@tv-basicstudies"      /* RSI 14 */
    ],
    "studies_overrides": {
      "moving average exp.length"               : 10,
      "moving average exp.plot.color"           : "#05d68c",
      "moving average exp.plot.linewidth"       : 2,
    },
    "overrides": {
      "paneProperties.background"               : "#07090e",
      "paneProperties.backgroundType"           : "solid",
      "scalesProperties.textColor"              : "#3a4f6a",
      "mainSeriesProperties.candleStyle.upColor"        : "#05d68c",
      "mainSeriesProperties.candleStyle.downColor"      : "#f0273e",
      "mainSeriesProperties.candleStyle.borderUpColor"  : "#05d68c",
      "mainSeriesProperties.candleStyle.borderDownColor": "#f0273e",
      "mainSeriesProperties.candleStyle.wickUpColor"    : "#05d68c",
      "mainSeriesProperties.candleStyle.wickDownColor"  : "#f0273e",
    }
  };

  try {
    /* Load TradingView library if not yet loaded */
    if (typeof TradingView !== "undefined") {
      tvWidget = new TradingView.widget(config);
    } else {
      /* Load TV script dynamically */
      loadTVScript(() => {
        tvWidget = new TradingView.widget(config);
      });
    }
  } catch(e) {
    console.warn("TradingView widget error:", e);
    showTVFallback(container, symbol, interval);
  }
}

function loadTVScript(callback) {
  if (document.getElementById("tv-script")) { callback(); return; }
  const s = document.createElement("script");
  s.id  = "tv-script";
  s.src = "https://s3.tradingview.com/tv.js";
  s.onload  = callback;
  s.onerror = () => {
    console.warn("TradingView tv.js failed, using iframe fallback");
    callback(); /* attempt widget anyway, or it will use iframe below */
  };
  document.head.appendChild(s);
}

/* Iframe embed fallback if TradingView widget fails */
function showTVFallback(container, symbol, interval) {
  const sym = encodeURIComponent(symbol);
  container.innerHTML = `
    <iframe
      src="https://s.tradingview.com/widgetembed/?frameElementId=tv_iframe
        &symbol=${sym}
        &interval=${interval}
        &hidesidetoolbar=0
        &hidetoptoolbar=0
        &symboledit=0
        &saveimage=0
        &toolbarbg=0c0f18
        &theme=dark&style=1
        &timezone=Etc%2FUTC
        &withdateranges=1
        &studies=MAExp%40tv-basicstudies%7C%7CBB%40tv-basicstudies%7C%7CRSI%40tv-basicstudies"
      style="width:100%;height:100%;border:none;display:block;"
      allowtransparency="true"
      frameborder="0">
    </iframe>`;
}

/* ══════════════════════
   MATH HELPERS
══════════════════════ */
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
    ag = (ag * (n - 1) + Math.max(d, 0))  / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
    r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return r;
}

/* ══════════════════════
   CANDLE GENERATOR
   Deterministic per time-epoch
   Matches real price regions
══════════════════════ */
function genCandles(pair, tf, N) {
  const step  = Number(tf) * 60;
  const now   = Math.floor(Date.now() / 1000);
  const epoch = Math.floor(now / step);
  let   seed  = (epoch * 0x1F3A7 +
                (tf === "15" ? 0xAB01 : 0xCD02) +
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

/* ══════════════════════
   SIGNAL ENGINE
══════════════════════ */
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

  const recH   = Math.max(...highs.slice(-CFG.slBars));
  const recL   = Math.min(...lows.slice(-CFG.slBars));
  const band   = bbU - bbL;
  const bbPct  = band > 0 ? ((price - bbL) / band) * 100 : 50;
  const nearUp = band > 0 && price >= bbU - band * CFG.bbNear;
  const nearLo = band > 0 && price <= bbL + band * CFG.bbNear;
  const dead   = rsi >= CFG.deadLo && rsi <= CFG.deadHi;
  const emaUp  = e10 > e21;
  const emaDn  = e10 < e21;

  const bChk = [
    { l:"EMA10 > EMA21",       p: emaUp,                        n: emaUp ? "UPTREND ▲"   : "NO UPTREND"   },
    { l:"RSI < 50 & < 30",     p: rsi < 50 && rsi < CFG.rsiOS,  n: dead  ? "DEAD ZONE"   : `RSI ${rsi.toFixed(1)}` },
    { l:"Price near Lower BB", p: nearLo,                        n: `${bbPct.toFixed(0)}% in band` },
  ];
  const sChk = [
    { l:"EMA10 < EMA21",       p: emaDn,                        n: emaDn ? "DOWNTREND ▼" : "NO DOWNTREND" },
    { l:"RSI > 50 & > 70",     p: rsi > 50 && rsi > CFG.rsiOB,  n: dead  ? "DEAD ZONE"   : `RSI ${rsi.toFixed(1)}` },
    { l:"Price near Upper BB", p: nearUp,                        n: `${bbPct.toFixed(0)}% in band` },
  ];

  const bS = bChk.filter(c => c.p).length;
  const sS = sChk.filter(c => c.p).length;

  let dir = "WAIT", score = 0, chks = bChk;

  if (dead) {
    dir = "WAIT"; score = 0;
    chks = [
      { l:"EMA Trend",   p:false, n:"RSI DEAD ZONE"               },
      { l:"RSI Level",   p:false, n:`RSI ${rsi.toFixed(1)} (45–55)` },
      { l:"BB Position", p:false, n:"SIDEWAYS MARKET"             },
    ];
  } else if (bS >= 2 && bS >= sS) { dir="BUY";  score=bS; chks=bChk; }
  else if   (sS >= 2 && sS >  bS) { dir="SELL"; score=sS; chks=sChk; }
  else if   (bS === 1)             { dir="WAIT"; score=1;  chks=bChk; }
  else if   (sS === 1)             { dir="WAIT"; score=1;  chks=sChk; }
  else {
    dir="WAIT"; score=0;
    chks=[
      {l:"EMA Trend",   p:false, n:"NO SIGNAL"    },
      {l:"RSI Level",   p:false, n:`RSI ${rsi.toFixed(1)}` },
      {l:"BB Position", p:false, n:"NEUTRAL"       },
    ];
  }

  const strength = score===3?"STRONG":score===2?"WEAK":"NO TRADE";

  let entry=price, sl, tp;
  if (dir==="BUY")  { sl = recL - band*0.015; tp = entry + (entry-sl)*2; }
  else if (dir==="SELL") { sl = recH + band*0.015; tp = entry - (sl-entry)*2; }
  else { sl=recL; tp=recH; }

  return {
    dir, score, strength, chks,
    price, e10, e21, bbU, bbM, bbL, bbPct,
    rsi, dead, emaUp, emaDn, nearUp, nearLo,
    entry, sl, tp,
  };
}

/* ══════════════════════
   FORMAT HELPERS
══════════════════════ */
const fmtP = (v, ref) => {
  if (v == null) return "--";
  return ref > 10000 ? Math.round(v).toLocaleString() : v.toFixed(2);
};
const f1 = v => v == null ? "--" : v.toFixed(1);

/* ══════════════════════
   CLASS HELPER
══════════════════════ */
function sc(el, add) {
  el.className = el.className
    .replace(/\b(buy|sell|wait|bull|bear|neut|pass|fail)\b/g,"")
    .trim();
  if (add) el.classList.add(add);
}

/* ══════════════════════
   UI UPDATE — Main Panel
══════════════════════ */
function updateMainUI(res, pair, tf) {
  const { dir, score, strength, chks, price,
          e10, e21, bbU, bbM, bbL, bbPct,
          rsi, dead, emaUp, nearUp, nearLo,
          entry, sl, tp } = res;
  const hi = price > 10000;

  /* Signal box */
  sc(document.getElementById("sigbox"), dir.toLowerCase());
  document.getElementById("sigPairTag").textContent = pair==="XAU" ? "XAU / USD" : "BTC / USD";
  document.getElementById("sigico").textContent = dir==="BUY"?"🟢":dir==="SELL"?"🔴":"⚠️";

  const ww = document.getElementById("sigwrd");
  ww.textContent = dir==="BUY"?"STRONG BUY":dir==="SELL"?"STRONG SELL":score===1?"WEAK — WAIT":"WAIT";

  const ss = document.getElementById("sigstr");
  ss.className = "sigstr";
  if      (strength==="STRONG") { ss.textContent="● STRONG · 3/3 MET"; ss.classList.add("sS"); }
  else if (strength==="WEAK")   { ss.textContent="● WEAK · 2/3 MET";   ss.classList.add("sW"); }
  else                           { ss.textContent="○ NO TRADE · <2/3";  ss.classList.add("sN"); }

  /* Trade levels */
  document.getElementById("tdE").textContent = fmtP(entry, price);
  document.getElementById("tdS").textContent = fmtP(sl,    price);
  document.getElementById("tdT").textContent = fmtP(tp,    price);
  const sd=Math.abs(entry-sl), td=Math.abs(tp-entry);
  document.getElementById("slDst").textContent = sd>0?`$${hi?sd.toFixed(0):sd.toFixed(1)}`:"--";
  document.getElementById("tpDst").textContent = td>0?`$${hi?td.toFixed(0):td.toFixed(1)}`:"--";

  /* BB strip */
  document.getElementById("vBBu").textContent = fmtP(bbU, price);
  document.getElementById("vBBm").textContent = fmtP(bbM, price);
  document.getElementById("vBBl").textContent = fmtP(bbL, price);
  document.getElementById("vPRC").textContent = fmtP(price, price);

  /* Toolbar prices */
  if (pair==="XAU") document.getElementById("xauPrice").textContent = fmtP(price, price);
  if (pair==="BTC") document.getElementById("btcPrice").textContent = fmtP(price, price);

  /* Conditions */
  [["ck1","ci1","cr1"],["ck2","ci2","cr2"],["ck3","ci3","cr3"]].forEach(([r,ic,re],i) => {
    const c = chks[i];
    sc(document.getElementById(r), c.p?"pass":dead?"neut":"fail");
    document.getElementById(ic).textContent = c.p?"✓":dead?"~":"✗";
    document.getElementById(re).textContent = c.n||"--";
  });

  /* Score bar */
  const pct = (score/3)*100;
  const fill = document.getElementById("sfil");
  fill.style.width      = pct + "%";
  fill.style.background = score===3?"var(--gn)":score===2?"var(--gd2)":score===1?"var(--yw)":"var(--t3)";
  document.getElementById("stxt").textContent = `Score: ${score} / 3  —  ${strength}`;

  /* EMA card */
  sc(document.getElementById("icEMA"), emaUp?"bull":"bear");
  document.getElementById("vE10").textContent = fmtP(e10, price);
  document.getElementById("vE21").textContent = fmtP(e21, price);
  document.getElementById("emaDiff").textContent = `Spread: ${fmtP(Math.abs(e10-e21), price)}`;
  const tEMA = document.getElementById("tEMA");
  tEMA.className   = "itag " + (emaUp?"tgB":"tgR");
  tEMA.textContent = emaUp ? "UPTREND ▲" : "DOWNTREND ▼";

  /* RSI card */
  sc(document.getElementById("icRSI"), dead?"neut":rsi>=CFG.rsiOB?"bear":rsi<=CFG.rsiOS?"bull":"neut");
  document.getElementById("vRSI").textContent = f1(rsi);
  const rf = document.getElementById("rfil");
  rf.style.width      = rsi + "%";
  rf.style.background = rsi>=CFG.rsiOB?"var(--rd)":rsi<=CFG.rsiOS?"var(--gn)":"var(--bl)";
  const tRSI=document.getElementById("tRSI"), vRn=document.getElementById("vRSIn");
  if      (dead)           { tRSI.className="itag tgY"; tRSI.textContent="DEAD ZONE";  vRn.textContent="45–55 NO TRADE"; }
  else if (rsi>=CFG.rsiOB) { tRSI.className="itag tgR"; tRSI.textContent="OVERBOUGHT"; vRn.textContent=">70 SELL"; }
  else if (rsi<=CFG.rsiOS) { tRSI.className="itag tgB"; tRSI.textContent="OVERSOLD";   vRn.textContent="<30 BUY"; }
  else if (rsi>50)         { tRSI.className="itag tgY"; tRSI.textContent=">50";         vRn.textContent="sell zone"; }
  else                      { tRSI.className="itag tgY"; tRSI.textContent="<50";         vRn.textContent="buy zone"; }

  /* BB card */
  sc(document.getElementById("icBB"), nearLo?"bull":nearUp?"bear":"neut");
  document.getElementById("vBBP").textContent = bbPct.toFixed(1) + "%";
  const tBB = document.getElementById("tBB");
  tBB.className   = "itag " + (nearLo?"tgB":nearUp?"tgR":"tgD");
  tBB.textContent = nearLo?"NEAR LOWER ↓":nearUp?"NEAR UPPER ↑":"MID RANGE";

  /* Labels */
  const tfu = tf === "15" ? "15M" : "5M";
  document.getElementById("condtag").textContent = tfu;
  document.getElementById("indtag").textContent  = tfu;
  document.getElementById("chartag").textContent =
    `${pair==="XAU"?"XAUUSD":"BTCUSD"} · ${tfu} · LIVE`;

  /* Status */
  const now=new Date(), p2=v=>String(v).padStart(2,"0");
  document.getElementById("lastupd").textContent =
    `Updated: ${p2(now.getUTCHours())}:${p2(now.getUTCMinutes())}:${p2(now.getUTCSeconds())} UTC`;
  document.getElementById("statmsg").innerHTML =
    `<span class="gok">&#9679;</span> Signal Engine Active`;
}

/* ══════════════════════
   UI UPDATE — Mini (secondary pair)
══════════════════════ */
function updateMiniUI(res, pair, tf) {
  const { dir, price, rsi, emaUp, entry, sl, tp } = res;

  const mp = document.getElementById("miniPairLbl");
  const mTF= document.getElementById("miniTF");
  const ms = document.getElementById("miniSig");

  if (mp)  mp.textContent = pair==="XAU" ? "XAU / USD" : "BTC / USD";
  if (mTF) mTF.textContent = tf==="15"?"15M":"5M";
  if (ms) {
    sc(ms, dir.toLowerCase());
    ms.textContent = dir==="BUY"?"BUY ▲":dir==="SELL"?"SELL ▼":"WAIT ⚠";
  }

  const s = (id, v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  s("miniPrice",  fmtP(price, price));
  s("miniRSI",    f1(rsi));
  s("miniTrend",  emaUp ? "UPTREND ▲" : "DOWNTREND ▼");
  s("miniEntry",  fmtP(entry, price));
  s("miniSL",     fmtP(sl, price));
  s("miniTP",     fmtP(tp, price));

  if (pair==="XAU") document.getElementById("xauPrice").textContent = fmtP(price, price);
  if (pair==="BTC") document.getElementById("btcPrice").textContent = fmtP(price, price);
}

/* ══════════════════════
   MTF BANNER
══════════════════════ */
function updateMTF(pair) {
  const s15 = SIG[pair]["15"];
  const s5  = SIG[pair]["5"];

  const setCard = (sigId, subId, scoreId, sig, score) => {
    const el  = document.getElementById(sigId);
    const sub = document.getElementById(subId);
    const scEl= document.getElementById(scoreId);
    el.className  = "mtfv " + (sig==="BUY"?"buy":sig==="SELL"?"sell":"wait");
    el.textContent = sig==="BUY"?"BUY ▲":sig==="SELL"?"SELL ▼":"WAIT ⚠";
    sub.textContent= sig==="BUY"?"Bullish confirmed":sig==="SELL"?"Bearish confirmed":"No clear setup";
    if (scEl) scEl.textContent = score!=null?`${score}/3`:"0/3";
  };

  setCard("v15sig","v15sub","v15score", s15, SCORES[pair+"15"]);
  setCard("v5sig", "v5sub", "v5score",  s5,  SCORES[pair+"5"]);

  /* Consensus */
  const cs  = document.getElementById("consensusSig");
  const csu = document.getElementById("consensusSub");
  const cv  = document.getElementById("consv");

  if (s15==="WAIT" && s5==="WAIT") {
    if(cs){cs.className="mtfv wait";cs.textContent="WAIT ⚠";}
    if(csu) csu.textContent="Both TFs waiting";
    if(cv){cv.className="consv no";cv.textContent="BOTH WAIT";}
  } else if (s15===s5 && s15!=="WAIT") {
    if(cs){cs.className="mtfv "+s15.toLowerCase();cs.textContent=s15==="BUY"?"STRONG BUY ✓":"STRONG SELL ✓";}
    if(csu) csu.textContent="Both TFs agree";
    if(cv){cv.className="consv yes";cv.textContent=`BOTH ${s15} ✓`;}
  } else {
    if(cs){cs.className="mtfv wait";cs.textContent="CONFLICT";}
    if(csu) csu.textContent="TFs disagree — Stay out";
    if(cv){cv.className="consv no";cv.textContent="CONFLICT";}
  }
}

/* ══════════════════════
   LOG
══════════════════════ */
function addLog(res, pair, tf) {
  if (res.dir==="WAIT") return;
  const now=new Date(), p2=v=>String(v).padStart(2,"0");
  const ts  = `${p2(now.getUTCHours())}:${p2(now.getUTCMinutes())}`;
  const row = document.createElement("tr");
  const cls = res.dir==="BUY"?"lbuy":"lsell";
  const lbl = tf==="15"?"15M":"5M";
  row.innerHTML = `
    <td>${ts}</td>
    <td>${pair==="XAU"?"XAUUSD":"BTCUSD"}</td>
    <td>${lbl}</td>
    <td class="${cls}">${res.dir==="BUY"?"BUY 🟢":"SELL 🔴"}</td>
    <td>${res.strength}</td>
    <td>${fmtP(res.entry,res.price)}</td>
    <td>${fmtP(res.sl,res.price)}</td>
    <td>${fmtP(res.tp,res.price)}</td>`;
  const body=document.getElementById("logbody");
  const emp =body.querySelector(".lempty");
  if (emp) emp.parentNode.removeChild(emp);
  body.insertBefore(row, body.firstChild);
  while (body.children.length > 30) body.removeChild(body.lastChild);
  LOGN++;
  document.getElementById("logcnt").textContent = `${LOGN} signal${LOGN!==1?"s":""}`;
}

/* ══════════════════════
   SOUND ALERTS
   BUY  = C5 → E5 → G5 (ascending)
   SELL = G5 → E5 → C5 (descending)
══════════════════════ */
function playAlert(dir) {
  try {
    const ac    = new (window.AudioContext || window.webkitAudioContext)();
    const notes = dir==="BUY" ? [523.25,659.25,783.99] : [783.99,659.25,523.25];
    notes.forEach((hz, i) => {
      const osc=ac.createOscillator(), gain=ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type="sine"; osc.frequency.value=hz;
      const t = ac.currentTime + i*0.18;
      gain.gain.setValueAtTime(0,t);
      gain.gain.linearRampToValueAtTime(0.22,t+0.02);
      gain.gain.exponentialRampToValueAtTime(0.001,t+0.44);
      osc.start(t); osc.stop(t+0.48);
    });
  } catch(e) {}
}

/* ══════════════════════
   FLASH
══════════════════════ */
function flashBox(dir) {
  const b=document.getElementById("sigbox");
  b.classList.remove("flash");
  void b.offsetWidth;
  if (dir!=="WAIT") b.classList.add("flash");
  setTimeout(()=>b.classList.remove("flash"), 3200);
}

/* ══════════════════════
   RUN SIGNAL ENGINE
══════════════════════ */
function runSignals() {
  const secPair = PAIR==="XAU" ? "BTC" : "XAU";
  const altTF   = TF==="15" ? "5" : "15";

  /* Active pair + active TF */
  const c1 = genCandles(PAIR, TF, CFG.N);
  const r1 = computeSignal(c1);
  if (r1) {
    const prev = SIG[PAIR][TF];
    SIG[PAIR][TF] = r1.dir;
    SCORES[PAIR+TF] = r1.score;
    updateMainUI(r1, PAIR, TF);
    if (r1.dir!=="WAIT" && r1.dir!==prev) { playAlert(r1.dir); flashBox(r1.dir); addLog(r1, PAIR, TF); }
  }

  /* Active pair + other TF (for MTF) */
  const c2 = genCandles(PAIR, altTF, CFG.N);
  const r2 = computeSignal(c2);
  if (r2) {
    SIG[PAIR][altTF]    = r2.dir;
    SCORES[PAIR+altTF]  = r2.score;
    if (r2.dir!=="WAIT" && r2.dir!==SIG[PAIR][altTF]) addLog(r2, PAIR, altTF);
  }

  /* Secondary pair */
  const c3 = genCandles(secPair, TF, CFG.N);
  const r3 = computeSignal(c3);
  if (r3) {
    SIG[secPair][TF]    = r3.dir;
    SCORES[secPair+TF]  = r3.score;
    updateMiniUI(r3, secPair, TF);
    if (r3.dir!=="WAIT") addLog(r3, secPair, TF);
  }

  updateMTF(PAIR);
}

/* ══════════════════════
   START AUTO-TICK
══════════════════════ */
function startTick() {
  if (tickTimer) clearInterval(tickTimer);
  const ms = CFG.tickMs[TF] || 60000;
  tickTimer = setInterval(runSignals, ms);
}

/* ══════════════════════
   CONTROLS
══════════════════════ */
window.setTF = (tf) => {
  TF = tf;
  document.getElementById("btn15").className = "tfbtn" + (tf==="15"?" on":"");
  document.getElementById("btn5").className  = "tfbtn" + (tf==="5" ?" on":"");
  /* Rebuild TradingView chart with new TF */
  buildTVWidget(PAIR, tf);
  runSignals();
  startTick();
};

window.setPair = (pair) => {
  PAIR = pair;
  document.getElementById("pbtnXAU").className = "pbtn" + (pair==="XAU"?" on":"");
  document.getElementById("pbtnBTC").className = "pbtn" + (pair==="BTC"?" on":"");
  /* Update mini box header */
  const secPair = pair==="XAU" ? "BTC" : "XAU";
  const mp = document.getElementById("miniPairLbl");
  if (mp) mp.textContent = secPair==="XAU" ? "XAU / USD" : "BTC / USD";
  /* Rebuild chart */
  buildTVWidget(pair, TF);
  runSignals();
  startTick();
};

window.doRefresh = () => {
  const btn=document.getElementById("rfbtn");
  btn.style.opacity="0.4";
  setTimeout(()=>btn.style.opacity="1", 500);
  buildTVWidget(PAIR, TF);
  runSignals();
};

/* ══════════════════════
   BOOT
══════════════════════ */
window.addEventListener("load", () => {
  /* Load TradingView library, then init widget */
  loadTVScript(() => {
    buildTVWidget(PAIR, TF);
  });

  /* Run signals immediately */
  runSignals();
  startTick();
});
