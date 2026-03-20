// Mock candlestick data generator
function generateMockCandles(count) {
    const candles = [];
    let price = 2000; // XAUUSD start price
    for (let i = 0; i < count; i++) {
        const open = price;
        const close = open + (Math.random() - 0.5) * 10;
        const high = Math.max(open, close) + Math.random() * 5;
        const low = Math.min(open, close) - Math.random() * 5;
        candles.push({ time: Date.now() / 1000 + i * 60, open, high, low, close });
        price = close;
    }
    return candles;
}

// TradingView Lightweight Chart
const chart = LightweightCharts.createChart(document.getElementById('chart-container'), {
    width: document.getElementById('chart-container').clientWidth,
    height: 400,
    layout: { backgroundColor: '#111', textColor: '#eee' },
    grid: { vertLines: { color: '#333' }, horzLines: { color: '#333' } }
});

const candleSeries = chart.addCandlestickSeries();
const ema10Series = chart.addLineSeries({ color: 'green', lineWidth: 2 });
const ema21Series = chart.addLineSeries({ color: 'red', lineWidth: 2 });

// Simple EMA calculation
function calculateEMA(candles, period) {
    let k = 2 / (period + 1);
    const ema = [];
    ema[0] = candles[0].close;
    for (let i = 1; i < candles.length; i++) {
        ema[i] = candles[i].close * k + ema[i - 1] * (1 - k);
    }
    return ema;
}

// Simple RSI
function calculateRSI(candles, period = 14) {
    const rsi = [];
    for (let i = period; i < candles.length; i++) {
        let gains = 0, losses = 0;
        for (let j = i - period + 1; j <= i; j++) {
            const diff = candles[j].close - candles[j - 1].close;
            if (diff > 0) gains += diff;
            else losses -= diff;
        }
        const rs = gains / (losses || 1);
        rsi.push(100 - 100 / (1 + rs));
    }
    return rsi;
}

// Update chart with mock data
function updateChart() {
    const candles = generateMockCandles(50);
    candleSeries.setData(candles);

    const ema10 = calculateEMA(candles, 10).map((v, i) => ({ time: candles[i].time, value: v }));
    const ema21 = calculateEMA(candles, 21).map((v, i) => ({ time: candles[i].time, value: v }));

    ema10Series.setData(ema10);
    ema21Series.setData(ema21);

    // Update signals
    updateSignals(candles, ema10, ema21, 'xau');
    updateSignals(candles, ema10, ema21, 'btc'); // For BTC mock same data
}

// Simple signal logic
function updateSignals(candles, ema10, ema21, asset) {
    const lastPrice = candles[candles.length - 1].close;
    const lastEma10 = ema10[ema10.length - 1].value;
    const lastEma21 = ema21[ema21.length - 1].value;

    let signal = 'wait';
    if (lastEma10 > lastEma21) signal = 'buy';
    else if (lastEma10 < lastEma21) signal = 'sell';

    // Update HTML
    document.getElementById(`${asset}-15m-signal`).textContent = signal.toUpperCase();
    document.getElementById(`${asset}-15m-signal`).className = signal;
    document.getElementById(`${asset}-5m-signal`).textContent = signal.toUpperCase();
    document.getElementById(`${asset}-5m-signal`).className = signal;
    document.getElementById(`${asset}-consensus`).textContent = signal.toUpperCase();
    document.getElementById(`${asset}-consensus`).className = signal;

    document.getElementById(`${asset}-entry`).textContent = lastPrice.toFixed(2);
    const sl = Math.min(...candles.slice(-6).map(c => c.low));
    const tp = lastPrice + (lastPrice - sl) * 2;
    document.getElementById(`${asset}-sl`).textContent = sl.toFixed(2);
    document.getElementById(`${asset}-tp`).textContent = tp.toFixed(2);

    // Sound alert
    playSignalSound(signal);
}

function playSignalSound(signal) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    if (signal === 'buy') osc.frequency.setValueAtTime(880, ctx.currentTime);
    else if (signal === 'sell') osc.frequency.setValueAtTime(220, ctx.currentTime);
    else return;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
}

// Initial update
updateChart();
// Auto update every 30 sec
setInterval(updateChart, 30000);

// Timeframe buttons (mock demo, just update chart)
document.querySelectorAll('.timeframe-buttons button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.timeframe-buttons button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateChart(); // For demo same data
    });
});
