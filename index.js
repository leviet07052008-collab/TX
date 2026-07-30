const WebSocket = require('ws');
const axios = require('axios');
const puppeteer = require('puppeteer');
const fs = require('fs');

// ===== CẤU HÌNH =====
const CONFIG = {
    url: 'https://web.sunwin.today',
    historyLength: 100,
    predictThreshold: 0.55,
    checkInterval: 5000,
    wsReconnect: 5000
};

let historyData = [];
let ws = null;
let browser = null;
let page = null;

// ===== LƯU TRỮ =====
function loadHistory() {
    try {
        if (fs.existsSync('history.json')) {
            const data = fs.readFileSync('history.json', 'utf8');
            historyData = JSON.parse(data);
            console.log(`[LOAD] Đã load ${historyData.length} phiên`);
        }
    } catch(e) {}
}

function saveHistory() {
    try {
        fs.writeFileSync('history.json', JSON.stringify(historyData, null, 2));
    } catch(e) {}
}

function addResult(sessionId, result) {
    if (!sessionId || sessionId <= 0) return;
    if (result !== 'Tài' && result !== 'Xỉu') return;
    
    const exists = historyData.some(item => item.session === sessionId);
    if (!exists) {
        historyData.push({ session: sessionId, result: result, time: Date.now() });
        historyData.sort((a, b) => a.session - b.session);
        if (historyData.length > CONFIG.historyLength) {
            historyData = historyData.slice(-CONFIG.historyLength);
        }
        saveHistory();
        console.log(`[+] PHIÊN MỚI: ${sessionId} -> ${result}`);
        
        const prediction = analyzeData();
        if (prediction.canPredict) {
            console.log(`[PREDICT] Dự đoán: ${prediction.predict} (độ tin cậy: ${(prediction.confidence*100).toFixed(1)}%)`);
        }
        return true;
    }
    return false;
}

// ===== PHÂN TÍCH DỰ ĐOÁN =====
function analyzeData() {
    if (historyData.length < 3) {
        return { canPredict: false, reason: 'Cần ít nhất 3 phiên', dataCount: historyData.length };
    }

    const binary = historyData.map(item => item.result === 'Tài' ? 1 : 0);
    const n = binary.length;
    const taiCount = binary.filter(b => b === 1).length;
    const taiRatio = taiCount / n;

    // Markov chain bậc 2
    const transitions = {};
    for (let i = 0; i < n - 2; i++) {
        const key = `${binary[i]},${binary[i+1]}`;
        const next = binary[i+2];
        if (!transitions[key]) transitions[key] = { 0: 0, 1: 0 };
        transitions[key][next]++;
    }

    const lastKey = `${binary[n-2]},${binary[n-1]}`;
    let predict = null;
    let confidence = 0;
    let method = 'Markov';

    if (transitions[lastKey]) {
        const counts = transitions[lastKey];
        const total = counts[0] + counts[1];
        if (total > 0) {
            const nextVal = counts[1] >= counts[0] ? 1 : 0;
            confidence = Math.max(counts[0], counts[1]) / total;
            if (confidence >= CONFIG.predictThreshold) {
                predict = nextVal === 1 ? 'Tài' : 'Xỉu';
                method = 'Markov chain';
            }
        }
    }

    if (!predict && n > 5) {
        const lastThree = binary.slice(-3);
        const avgLast = lastThree.reduce((a,b) => a+b, 0) / 3;
        if (avgLast > 0.6) {
            predict = 'Tài';
            confidence = avgLast;
            method = 'Xu hướng 3 phiên';
        } else if (avgLast < 0.4) {
            predict = 'Xỉu';
            confidence = 1 - avgLast;
            method = 'Xu hướng 3 phiên';
        }
    }

    if (!predict && n > 10) {
        if (taiRatio > 0.55) {
            predict = 'Tài';
            confidence = taiRatio;
            method = 'Tỉ lệ chung';
        } else if (taiRatio < 0.45) {
            predict = 'Xỉu';
            confidence = 1 - taiRatio;
            method = 'Tỉ lệ chung';
        }
    }

    return {
        canPredict: predict !== null,
        predict: predict,
        confidence: confidence || 0,
        dataCount: n,
        taiRatio: taiRatio,
        lastSession: historyData.length > 0 ? historyData[historyData.length-1].session : 0,
        method: method || 'Không xác định'
    };
}

// ===== KẾT NỐI WEBSOCKET =====
function connectWebSocket() {
    console.log('[WS] Đang kết nối...');
    const wsUrl = 'wss://web.sunwin.today/ws';
    
    ws = new WebSocket(wsUrl);
    
    ws.on('open', function() {
        console.log('[WS] ✅ Đã kết nối');
        ws.send(JSON.stringify({ type: 'login', data: { token: 'guest' } }));
    });
    
    ws.on('message', function(data) {
        try {
            const parsed = JSON.parse(data);
            
            if (parsed && typeof parsed === 'object') {
                let sid = parsed.session || parsed.id || parsed.phiên || parsed.code || parsed.ma || parsed.roomId;
                let res = parsed.result || parsed.ketqua || parsed.kq || parsed.value || parsed.type || parsed.status;
                
                if (!sid || !res) {
                    const body = parsed.body || parsed.payload || parsed.data || parsed.msg;
                    if (body && typeof body === 'object') {
                        sid = body.session || body.id || body.phiên || body.code || body.ma || body.roomId;
                        res = body.result || body.ketqua || body.kq || body.value || body.type || body.status;
                    }
                }
                
                if (!sid || !res) {
                    if (Array.isArray(parsed)) {
                        for (const item of parsed) {
                            if (item && typeof item === 'object') {
                                const tsid = item.session || item.id || item.phiên || item.code || item.ma;
                                const tres = item.result || item.ketqua || item.kq || item.value || item.type;
                                if (tsid && tres) {
                                    addResult(parseInt(tsid), tres);
                                }
                            }
                        }
                    }
                }
                
                if (!sid || !res) {
                    for (const key of Object.keys(parsed)) {
                        const val = parsed[key];
                        if (val === 'Tài' || val === 'Xỉu') {
                            const sidCandidate = parseInt(key);
                            if (!isNaN(sidCandidate) && sidCandidate > 0) {
                                addResult(sidCandidate, val);
                            }
                        }
                    }
                }
                
                if (sid && res) {
                    addResult(parseInt(sid), res);
                }
            }
        } catch(e) {
            try {
                const text = data.toString();
                const pattern = /(?:Phiên|phiên|PHIÊN|Session|session|Mã|ma|Room|room)\s*[:：]?\s*(\d+)\s*[:：]?\s*(Tài|Xỉu)/gi;
                let match;
                while ((match = pattern.exec(text)) !== null) {
                    if (match[1] && match[2]) {
                        addResult(parseInt(match[1]), match[2]);
                    }
                }
            } catch(e2) {}
        }
    });
    
    ws.on('close', function() {
        console.log('[WS] ❌ Mất kết nối, thử lại sau...');
        setTimeout(connectWebSocket, CONFIG.wsReconnect);
    });
    
    ws.on('error', function(err) {
        console.log('[WS] Lỗi:', err.message);
    });
}

// ===== SCRAPE VỚI PUPPETEER =====
async function scrapeWithPuppeteer() {
    try {
        if (!browser) {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            page = await browser.newPage();
            await page.goto(CONFIG.url, { waitUntil: 'networkidle2' });
            console.log('[PUPPETEER] Đã load trang');
        }
        
        const data = await page.evaluate(() => {
            const results = [];
            const text = document.body.innerText;
            const pattern = /(?:Phiên|phiên|PHIÊN|Session|session|Mã|ma)\s*[:：]?\s*(\d+)\s*[:：]?\s*(Tài|Xỉu)/gi;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                if (match[1] && match[2]) {
                    results.push({ session: parseInt(match[1]), result: match[2] });
                }
            }
            return results;
        });
        
        if (data && data.length > 0) {
            for (const item of data) {
                addResult(item.session, item.result);
            }
        }
    } catch(e) {
        console.log('[PUPPETEER] Lỗi:', e.message);
    }
}

// ===== FETCH VỚI AXIOS =====
async function fetchWithAxios() {
    try {
        const urls = ['/api/result', '/api/session', '/api/history', '/result', '/history'];
        for (const url of urls) {
            try {
                const response = await axios.get(CONFIG.url + url, {
                    timeout: 5000,
                    headers: { 'Accept': 'application/json' }
                });
                if (response.data) {
                    let data = response.data;
                    if (Array.isArray(data)) {
                        for (const item of data) {
                            const sid = item.session || item.id || item.phiên || item.ma;
                            const res = item.result || item.ketqua || item.kq || item.value;
                            if (sid && res) {
                                addResult(parseInt(sid), res);
                            }
                        }
                    }
                }
            } catch(e) {}
        }
    } catch(e) {}
}

// ===== HIỂN THỊ TRẠNG THÁI =====
function showStatus() {
    const prediction = analyzeData();
    console.log('\n========== TRẠNG THÁI ==========');
    console.log(`📊 Tổng phiên: ${historyData.length}`);
    if (historyData.length > 0) {
        const last = historyData[historyData.length-1];
        console.log(`📌 Phiên cuối: ${last.session} -> ${last.result}`);
        console.log(`📈 Tỉ lệ Tài: ${(prediction.taiRatio*100).toFixed(1)}%`);
    }
    if (prediction.canPredict) {
        console.log(`🎯 DỰ ĐOÁN: ${prediction.predict}`);
        console.log(`📊 Độ tin cậy: ${(prediction.confidence*100).toFixed(1)}%`);
        console.log(`📐 Phương pháp: ${prediction.method}`);
    } else {
        console.log(`⏳ ${prediction.reason}`);
    }
    console.log('================================\n');
}

// ===== MAIN =====
async function main() {
    console.log('🎯 TÀI XỈU PREDICTOR v1.0');
    console.log('===========================\n');
    
    loadHistory();
    showStatus();
    
    connectWebSocket();
    
    await scrapeWithPuppeteer();
    await fetchWithAxios();
    
    setInterval(async () => {
        await scrapeWithPuppeteer();
        await fetchWithAxios();
        showStatus();
    }, CONFIG.checkInterval);
    
    setInterval(showStatus, 10000);
    
    console.log('[SYSTEM] ✅ Đang chạy...');
}

process.on('SIGINT', async () => {
    console.log('\n[SYSTEM] Đang dừng...');
    if (browser) await browser.close();
    if (ws) ws.close();
    process.exit(0);
});

main().catch(console.error);
