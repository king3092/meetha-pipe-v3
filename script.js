/** * ALPHASIGNAL ENGINE
 * Logic: EMA Cross + RSI Extremes + Bollinger Band Squeeze
 */

const AUDIO_CTX = new (window.AudioContext || window.webkitAudioContext)();

// --- Technical Indicators ---
const Indicators = {
    ema: (data, period) => {
        const k = 2 / (period + 1);
        let emaVal = data[0];
        for (let i = 1; i < data.length; i++) {
            emaVal = (data[i] * k) + (emaVal * (1 - k));
        }
        return emaVal;
    },
    rsi: (data, period = 14) => {
        let gains = 0, losses = 0;
        for (let i = data.length - period; i < data.length; i++) {
            let diff = data[i] - data[i - 1];
            diff >= 0 ? gains += diff : losses -= diff;
        }
        let rs = (gains / period) / (losses / period);
        return 100 - (100 / (1 + rs));
    },
    bollinger: (data, period = 20) => {
        const slice = data.slice(-period);
        const mean = slice.reduce((a, b) => a + b) / period;
        const stdDev = Math.sqrt(slice.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / period);
        return { upper: mean + (stdDev * 2), lower: mean - (stdDev * 2), mid: mean };
    }
};

// --- Sound Alerts ---
function playAlert(type) {
    const osc = AUDIO_CTX.createOscillator();
    const gain = AUDIO_CTX.createGain();
    osc.connect(gain);
    gain.connect(AUDIO_CTX.destination);
    
    const now = AUDIO_CTX.currentTime;
    if (type === 'BUY') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.5);
    } else {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.5);
    }
    
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.start();
    osc.stop(now + 0.5);
}

// --- Signal Core ---
async function fetchAndCalculate(symbol, interval) {
    try {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=100`);
        const candles = await response.json();
        const closes = candles.map(c => parseFloat(c[4]));
        const highs = candles.map(c => parseFloat(c[2]));
        const lows = candles.map(c => parseFloat(c[3]));

        const lastClose = closes[closes.length - 1];
        const ema10 = Indicators.ema(closes, 10);
        const ema21 = Indicators.ema(closes, 21);
        const rsi = Indicators.rsi(closes, 14);
        const bb = Indicators.bollinger(closes, 20);

        let signal = "WAIT";
        if (ema10 > ema21 && rsi < 50 && lastClose <= bb.lower * 1.01) signal = "BUY";
        if (ema10 < ema21 && rsi > 50 && lastClose >= bb.upper * 0.99) signal = "SELL";
        if (rsi > 45 && rsi < 55) signal = "WAIT";

        // Simple SL/TP Logic
        const recentLow = Math.min(...lows.slice(-6));
        const recentHigh = Math.max(...highs.slice(-6));
        let sl = signal === "BUY" ? recentLow : recentHigh;
        let tp = signal === "BUY" ? lastClose + (lastClose - sl) * 2 : lastClose - (sl - lastClose) * 2;

        return { signal, entry: lastClose, sl, tp };
    } catch (e) {
        console.error("Fetch error:", e);
        return null;
    }
}

// --- UI Update Loop ---
async function updateDashboard() {
    const btc15 = await fetchAndCalculate('BTCUSDT', '15m');
    const btc5 = await fetchAndCalculate('BTCUSDT', '5m');

    if (btc15 && btc5) {
        document.getElementById('btc-15m').innerText = btc15.signal;
        document.getElementById('btc-5m').innerText = btc5.signal;
        
        const consensus = (btc15.signal === btc5.signal) ? btc15.signal : "WAIT";
        const badge = document.getElementById('btc-consensus');
        badge.innerText = consensus;
        badge.className = `badge ${consensus}`;
        
        document.getElementById('btc-entry').innerText = btc15.entry.toFixed(2);
        document.getElementById('btc-sl').innerText = btc15.sl.toFixed(2);
        document.getElementById('btc-tp').innerText = btc15.tp.toFixed(2);

        if (consensus !== "WAIT") playAlert(consensus);
    }
}

// Initial Boot
setInterval(updateDashboard, 30000); // 30s refresh
updateDashboard();

// BTC Chart Init (Simplified)
const chart = LightweightCharts.createChart(document.getElementById('btc-chart'), {
    layout: { backgroundColor: '#000', textColor: '#ddd' },
    grid: { vertLines: { color: '#222' }, horzLines: { color: '#222' } }
});
const candleSeries = chart.addCandlestickSeries();
// Note: To populate this chart with data, you'd map the Binance klines to {time, open, high, low, close}
