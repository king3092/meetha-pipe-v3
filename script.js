const chart = LightweightCharts.createChart(document.getElementById('chart-container'), {
    width: document.getElementById('chart-container').clientWidth,
    height:400,
    layout:{backgroundColor:'#111', textColor:'#eee'},
    grid:{vertLines:{color:'#333'}, horzLines:{color:'#333'}}
});
const candleSeries = chart.addCandlestickSeries();
const ema10Series = chart.addLineSeries({color:'green', lineWidth:2});
const ema21Series = chart.addLineSeries({color:'red', lineWidth:2});

let timeframe = '15'; // default 15M

document.querySelectorAll('.timeframe-buttons button').forEach(btn=>{
    btn.addEventListener('click',()=>{
        document.querySelectorAll('.timeframe-buttons button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        timeframe = btn.dataset.timeframe;
        updateChart();
    });
});

// Fetch Binance API candles
async function fetchCandles(symbol, interval='15m', limit=50){
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.map(c=>({
        time: c[0]/1000,
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4])
    }));
}

// EMA Calculation
function calculateEMA(candles, period){
    const k = 2/(period+1);
    const ema = [];
    ema[0] = candles[0].close;
    for(let i=1;i<candles.length;i++){
        ema[i] = candles[i].close*k + ema[i-1]*(1-k);
    }
    return ema;
}

// Signal calculation & panel update
function updateSignals(candles){
    const ema10 = calculateEMA(candles,10);
    const ema21 = calculateEMA(candles,21);
    const lastPrice = candles[candles.length-1].close;

    let signal='wait';
    if(ema10[ema10.length-1]>ema21[ema21.length-1]) signal='buy';
    else if(ema10[ema10.length-1]<ema21[ema21.length-1]) signal='sell';

    // Multi-timeframe mock same signal for demo
    document.getElementById('btc-15m-signal').textContent=signal.toUpperCase();
    document.getElementById('btc-15m-signal').className=signal;
    document.getElementById('btc-5m-signal').textContent=signal.toUpperCase();
    document.getElementById('btc-5m-signal').className=signal;
    document.getElementById('btc-consensus').textContent=signal.toUpperCase();
    document.getElementById('btc-consensus').className=signal;

    document.getElementById('btc-entry').textContent=lastPrice.toFixed(2);
    const sl = Math.min(...candles.slice(-6).map(c=>c.low));
    const tp = lastPrice + (lastPrice-sl)*2;
    document.getElementById('btc-sl').textContent=sl.toFixed(2);
    document.getElementById('btc-tp').textContent=tp.toFixed(2);

    playSignalSound(signal);
}

// Sound alerts
function playSignalSound(signal){
    if(signal==='wait') return;
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type='sine';
    osc.frequency.setValueAtTime(signal==='buy'?880:220, ctx.currentTime);
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime+0.2);
}

// Main chart + signals update
async function updateChart(){
    const candles = await fetchCandles('BTCUSDT', timeframe+'m', 50);
    candleSeries.setData(candles);
    ema10Series.setData(calculateEMA(candles,10).map((v,i)=>({time:candles[i].time,value:v})));
    ema21Series.setData(calculateEMA(candles,21).map((v,i)=>({time:candles[i].time,value:v})));
    updateSignals(candles);
}

// Initial load + interval
updateChart();
setInterval(updateChart, 30000);
