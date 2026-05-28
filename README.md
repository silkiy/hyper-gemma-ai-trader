# 🤖 Hyper-Gemma AI Trader

> **Production-ready Autonomous AI Trading System**
> Menggunakan AsterDex, Ollama, Gemma, MongoDB, Node.js, dan TypeScript

[![Version](https://img.shields.io/badge/version-2.1.0-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](#)
[![Node.js](https://img.shields.io/badge/Node.js-LTS-green)](#)

---

## 📖 Deskripsi Project

**Hyper-Gemma AI Trader** adalah sistem trading cryptocurrency **otonom sepenuhnya** (fully autonomous) yang menggunakan kecerdasan buatan (AI) berbasis model **Gemma** melalui **Ollama** untuk mengambil keputusan trading pada exchange **AsterDex** secara real-time.

Sistem ini dirancang dengan prinsip **"Risk First"** — melindungi modal terlebih dahulu, baru kemudian mencari profit. Seluruh keputusan trading diambil oleh AI yang menganalisis data market secara teknikal (RSI, EMA, ATR), memvalidasi risiko, dan mengeksekusi order secara otomatis tanpa intervensi manusia.

### 🎯 Filosofi Inti

| Prinsip | Penjelasan |
|---------|------------|
| **Capital Preservation** | Lindungi modal kecil ($1-$2) agar sistem bisa survive long-term |
| **Probabilistic Thinking** | AI bertindak sebagai analis probabilistik, bukan peramal harga |
| **Self-Learning** | Sistem belajar dari kesalahan trading sebelumnya |
| **Risk Override** | Risk Manager dapat meng-override keputusan AI |
| **No Emotion** | AI tidak terpengaruh emosi — tidak FOMO, tidak revenge trade |

---

## 🏗️ Arsitektur Sistem

Sistem ini menggunakan **Clean Architecture** dengan pemisahan layer yang jelas:

```
┌─────────────────────────────────────────────────────┐
│                    SERVER (Entry Point)               │
│      Dual-Engine Architecture + Strategy Router        │
├──────────┬──────────┬──────────┬────────────────────┤
│   API    │  CORE    │ EXCHANGE │    SERVICES         │
│ (Fastify)│ (AI/Risk)│(AsterDex)│  (Trade Orchestr.)  │
├──────────┴──────────┴──────────┴────────────────────┤
│                   DATABASE (MongoDB)                  │
│            Models → Repositories → Mongoose           │
├─────────────────────────────────────────────────────┤
│              MONITORING & UTILITIES                   │
│      Prometheus │ Health Check │ Alert Manager         │
└─────────────────────────────────────────────────────┘
```

### Arsitektur Detail:

- **Clean Architecture** — Pemisahan antara Core, Services, Database, dan Exchange
- **Infinite Scan Loop** — Continuous trading engine untuk SCALPING (infinite loop)
- **Scheduled Scan** — Cron-based engine untuk INTRADAY (15m) dan SWING (1h)
- **Strategy-Driven** — Engine otomatis dipilih berdasarkan `TRADING_STRATEGY`
- **AI Feedback Loop** — Hasil trading sebelumnya diinjeksikan ke prompt AI
- **Self-Learning Memory** — MongoDB menyimpan pelajaran dari kesalahan
- **Risk First Trading System** — Risk Manager sebagai penjaga terakhir sebelum eksekusi

---

## 🛠️ Tech Stack

| Kategori | Teknologi |
|----------|-----------|
| **Runtime** | Node.js + TypeScript 6.0 |
| **Web Server** | Fastify 5 |
| **AI Engine** | Ollama + Gemma 4 (gemma4:latest) |
| **Database** | MongoDB Atlas + Mongoose 9 |
| **Exchange** | AsterDex Futures API (V3) |
| **Validation** | Zod 4 |
| **Monitoring** | Prometheus (prom-client) |
| **Logger** | Pino + pino-pretty |
| **Scheduler** | node-cron |
| **Crypto** | ethers.js (EIP-712 signing) |
| **Math** | Decimal.js (precision) |
| **HTTP** | Axios |

---

## 📁 Struktur Folder Project

```
hyper-gemma-ai-trader/
├── src/
│   ├── server.ts                    # Entry point utama (bootstrap + dual-engine + strategy router)
│   ├── core/                        # Logika inti (AI, Market, Risk)
│   │   ├── ai/
│   │   │   ├── decision-engine.ts   # Orkestrator keputusan trading AI
│   │   │   ├── ollama-client.ts     # HTTP client untuk Ollama API
│   │   │   ├── prompt-builder.ts    # Builder prompt dinamis untuk Gemma
│   │   │   └── learning-engine.ts   # Engine pembelajaran dari kesalahan
│   │   ├── market/
│   │   │   ├── indicator-engine.ts  # Kalkulator indikator teknikal (EMA, RSI, ATR)
│   │   │   └── market-regime.ts     # Deteksi regime market (Trending/Ranging/Volatile)
│   │   └── risk/
│   │       ├── risk-manager.ts      # Validasi risiko & leverage cap
│   │       └── cooldown-manager.ts  # Sistem cooldown setelah loss
│   ├── exchange/
│   │   ├── asterdex.client.ts       # Client API AsterDex (V3 + EIP-712 signature)
│   │   ├── market-data.provider.ts  # Provider data market real-time
│   │   └── order.executor.ts        # Eksekutor order ke exchange
│   ├── database/
│   │   ├── mongo.ts                 # Koneksi MongoDB
│   │   ├── models/
│   │   │   ├── trade.model.ts       # Schema trade (Mongoose)
│   │   │   ├── memory.model.ts      # Schema memory/pelajaran
│   │   │   └── session.model.ts     # Schema sesi trading
│   │   └── repositories/
│   │       ├── trade.repository.ts  # Repository akses data trade
│   │       ├── memory.repository.ts # Repository akses data memory
│   │       └── session.repository.ts # Repository akses data session
│   ├── services/
│   │   ├── trade.service.ts         # Orchestrator eksekusi trade
│   │   └── session.service.ts       # Manajemen sesi trading (lifecycle)
│   ├── api/
│   │   ├── monitoring-api.ts        # Setup Fastify server
│   │   └── routes/
│   │       ├── health.route.ts      # Endpoint /health
│   │       ├── metrics.route.ts     # Endpoint /metrics (Prometheus)
│   │       └── trade.route.ts       # Endpoint /trades & /trades/stats
│   ├── jobs/
│   │   └── memory-consolidation.job.ts  # Job konsolidasi memori harian
│   ├── monitoring/
│   │   ├── metrics.ts               # Prometheus counters & gauges
│   │   ├── health-check.ts          # System health check (DB, uptime, memory)
│   │   └── alert-manager.ts         # Alert system (logging-based)
│   ├── types/
│   │   ├── ai.types.ts              # Type definitions untuk AI decision
│   │   ├── market.types.ts          # Type definitions untuk market data
│   │   └── enum.types.ts            # Enum definitions (TradeAction, MarketRegime, dll.)
│   ├── config/
│   │   ├── env.ts                   # Environment variables (Zod validated)
│   │   └── constants.ts             # Konstanta trading & market
│   ├── utils/
│   │   ├── logger.ts                # Pino logger instance
│   │   ├── helpers.ts               # Utility functions (currency, sleep, percentage)
│   │   ├── retry.ts                 # Generic retry dengan backoff
│   │   ├── json-validator.ts        # Validator JSON response AI (Zod schema)
│   │   └── time.ts                  # Utility waktu
│   ├── scripts/
│   │   ├── backtest.ts              # Script backtesting dengan mock AI
│   │   ├── simulate-live.ts         # Simulasi live trading $1
│   │   ├── verify-all.ts            # Verifikasi final semua fitur
│   │   ├── check-balance.ts         # Script cek saldo AsterDex
│   │   ├── test-ollama.ts           # Test koneksi Ollama
│   │   ├── test-real-time.ts        # Test data real-time
│   │   └── test-v3-realtime.ts      # Test AsterDex V3 API
│   └── tests/
│       ├── unit/
│       │   └── risk-manager.spec.ts # Unit test Risk Manager
│       └── integration/             # (Placeholder untuk integration test)
├── etc/
│   ├── ai-promt.json                # Blueprint arsitektur & prompt AI lengkap
│   ├── BACKTEST_RESULTS.md          # Hasil backtesting
│   ├── SIMULATION_RESULTS.md        # Hasil simulasi live
│   ├── FINAL_VERIFICATION.md        # Report verifikasi final
│   └── GEMINI.md                    # Catatan konfigurasi Gemma
├── .env                             # Environment variables
├── package.json                     # Dependencies & scripts
├── tsconfig.json                    # TypeScript configuration
└── LICENSE                          # MIT License
```

---

## ⚡ Daftar Fitur Lengkap

### 1. 🧠 AI Decision Engine (Mesin Keputusan AI)

**File:** `src/core/ai/decision-engine.ts`

Orkestrator utama yang mengoordinasikan seluruh proses pengambilan keputusan trading:

- **Fetch Market Data** — Mengambil data market real-time dari AsterDex (harga, volume, indikator)
- **Pre-AI Risk Check** — Memvalidasi risiko **sebelum** memanggil AI untuk menghemat resource (skip jika posisi penuh atau ada safety risk)
- **Continuous Learning** — Mengambil 5 trade terakhir dari database sebagai konteks pembelajaran
- **Build Prompt** — Menyusun prompt dinamis yang berisi data market, status akun, dan memori
- **Get AI Decision** — Mengirim prompt ke Ollama/Gemma dan mendapatkan keputusan terstruktur
- **Final Risk Validation** — Memvalidasi keputusan AI melalui Risk Manager sebelum eksekusi
- **Fallback Safety** — Jika terjadi error, mengembalikan keputusan SKIP sebagai fallback

**Output AI Decision:**
```json
{
  "decision": "LONG | SHORT | WAIT | SKIP",
  "confidence_score": 0-100,
  "market_regime": "TRENDING | RANGING | VOLATILE | UNCLEAR",
  "risk_level": "LOW | MEDIUM | HIGH",
  "leverage_suggestion": 1-500,
  "position_size": "SMALL | NORMAL | REDUCED",
  "entry_reason": "string",
  "risk_factors": ["string"],
  "stop_loss_logic": "string",
  "take_profit_logic": "string",
  "self_reflection": "string",
  "final_summary": "string"
}
```

---

### 2. 🔗 Ollama Client (Integrasi AI Lokal)

**File:** `src/core/ai/ollama-client.ts`

Client HTTP yang terhubung ke Ollama API untuk inference model Gemma secara lokal:

- **Model Configurasi** — Mendukung model Gemma 4 (gemma4:latest) dan varian lainnya
- **Parameter Tuning** — Temperature 0.1 (konservatif), Top-K 40, Top-P 0.85
- **Mock Mode** — Mode mock AI (`MOCK_AI=true`) untuk testing tanpa Ollama
- **JSON Extraction** — Mengekstrak dan memvalidasi JSON dari respons LLM
- **Timeout Management** — Timeout 150 detik untuk request yang berat
- **Latency Tracking** — Mencatat latency setiap request ke AI

---

### 3. 📝 Prompt Builder (Konstruktor Prompt Dinamis)

**File:** `src/core/ai/prompt-builder.ts`

Membangun prompt terstruktur dalam Bahasa Indonesia untuk model Gemma:

- **Strategy-Adaptive Prompt** — Instruksi berbeda berdasarkan `TRADING_STRATEGY`:
  - `SCALPING` → **Aggressive Scalping** — fokus Volatility Bursts, Volume Spikes, Price Anomalies, profit instan
  - `INTRADAY/SWING` → Konfirmasi trend solid, ruang nafas untuk SL, target profit lebar
- **System Instruction** — Persona **"Hyper-Gemma Ultra"** sebagai AI Scalping Engine agresif
- **Small Account Optimization** — Instruksi leverage 50x-200x khusus akun $1 agar memenuhi minimum order $5
- **Tight SL/TP Instruction** — Wajib memberikan target SL/TP dalam % pergerakan harga yang ketat
- **Account Context** — Menyertakan equity, PnL harian, dan loss streak
- **Market Context** — Menyertakan harga, EMA20/50, RSI, trend, ATR, dan 24h change
- **Memory Injection** — Menyuntikkan pelajaran dari trading sebelumnya
- **Response Schema** — Memaksa output JSON dengan format ketat
- **Prinsip Capital Multiplication** — Eksekusi peluang dengan probabilitas profit tertinggi

---

### 4. 📚 Learning Engine (Mesin Pembelajaran)

**File:** `src/core/ai/learning-engine.ts`

Sistem self-learning yang menyimpan dan mengkonsolidasi pelajaran:

- **Memory Consolidation** — Konsolidasi memori dari trade sebelumnya
- **Record Lesson** — Mencatat pelajaran baru ke koleksi Memory di MongoDB
- **Upsert Pattern** — Update jika pelajaran serupa sudah ada, buat baru jika belum
- **Occurrence Tracking** — Melacak frekuensi kesalahan yang sama terulang
- **Kategori Memory** — ENTRY, EXIT, RISK, PSYCHOLOGY

---

### 5. 📊 Indicator Engine (Mesin Indikator Teknikal)

**File:** `src/core/market/indicator-engine.ts`

Kalkulator indikator teknikal menggunakan presisi tinggi (Decimal.js):

| Indikator | Deskripsi | Parameter |
|-----------|-----------|-----------|
| **EMA** | Exponential Moving Average | Period 20 & 50 |
| **RSI** | Relative Strength Index | Period 14 |
| **ATR** | Average True Range | Period 14 |

- Semua kalkulasi menggunakan `Decimal.js` untuk presisi hingga 2 desimal
- Handling edge case saat data kurang dari period yang dibutuhkan
- Deteksi trend: BULLISH (Price > EMA20 > EMA50), BEARISH (Price < EMA20 < EMA50), NEUTRAL

---

### 6. 🌍 Market Regime Detector (Deteksi Kondisi Market)

**File:** `src/core/market/market-regime.ts`

Mengklasifikasikan kondisi market saat ini berdasarkan indikator:

| Regime | Kondisi |
|--------|---------|
| **VOLATILE** | RSI > 70 atau RSI < 30 |
| **TRENDING** | ADX > 25 |
| **RANGING** | ADX < 20 |
| **UNCLEAR** | Kondisi lainnya |

---

### 7. 🛡️ Risk Manager (Manajemen Risiko)

**File:** `src/core/risk/risk-manager.ts`

Layer perlindungan modal yang dapat meng-override keputusan AI:

- **Dynamic Max Positions** — Membatasi jumlah posisi aktif berdasarkan `MAX_POSITIONS` di environment (default: 2, configurable)
- **Duplicate Position Block** — Memblokir pembukaan posisi baru pada koin yang sudah dipegang (cegah double exposure)
- **Strategy-Dynamic Liquidation Safety** — Threshold likuidasi berbeda per strategi:
  - `SCALPING` → 15% jarak minimum ke harga likuidasi (lebih toleran karena leverage tinggi)
  - `INTRADAY/SWING` → 30% jarak minimum (lebih konservatif)
- **Leverage Cap** — Membatasi leverage hingga maksimal 500x
- **Position Sizing** — Kalkulasi ukuran posisi berdasarkan tingkat risiko:
  - `NORMAL` → 100% dari safe margin
  - `REDUCED` → 50% dari safe margin
  - `SMALL` → 25% dari safe margin
- **Active Position Monitor** — Menampilkan detail posisi aktif (PnL, entry price, margin, ROE, liquidation price)
- **Trading Blocked** — Memblokir trade baru jika posisi penuh, ada safety risk, atau duplicate coin

---

### 8. ⏳ Cooldown Manager (Sistem Pendinginan)

**File:** `src/core/risk/cooldown-manager.ts`

Mengelola periode cooldown setelah kerugian beruntun:

- **Start Cooldown** — Mengaktifkan cooldown selama N menit (default: 30 menit)
- **Check Active** — Mengecek apakah cooldown masih aktif
- **Auto Reset** — Otomatis reset ketika waktu cooldown berakhir
- **Remaining Time** — Menampilkan sisa waktu cooldown dalam menit

---

### 9. 🔌 AsterDex Client (Koneksi Exchange)

**File:** `src/exchange/asterdex.client.ts`

Client lengkap untuk AsterDex Futures API V3 dengan autentikasi Web3:

| Fitur | Deskripsi |
|-------|-----------|
| **EIP-712 Signing** | Tanda tangan kriptografis menggunakan `ethers.js` Wallet |
| **Get Candles** | Mengambil data candlestick (klines) untuk analisis |
| **Get Ticker 24h** | Mengambil statistik harga 24 jam per simbol |
| **Get All Tickers** | Mengambil semua 24h ticker sekaligus (untuk hot pair filtering) |
| **Get Exchange Info** | Mengambil informasi exchange (symbols, precision, status) |
| **Get All Symbols** | Mengambil semua pasangan trading yang aktif |
| **Get Symbol Info** | Mengambil `quantityPrecision` dan `pricePrecision` per simbol (baru) |
| **Get Account Balance** | Mengambil saldo akun (USDC/USDT) |
| **Get Account Info** | Mengambil informasi akun lengkap (future-proof V3) |
| **Get Positions** | Mengambil posisi-posisi aktif |
| **Place Order** | Membuat order MARKET, LIMIT, STOP_MARKET, atau TAKE_PROFIT_MARKET (dengan stopPrice & reduceOnly) |
| **Set Leverage** | Mengatur leverage per simbol (smart error handling: ignore -4028, throw -2027) |
| **Set Margin Type** | Mengatur tipe margin (CROSSED/ISOLATED) |
| **Get Symbol Precision** | Shortcut ke `getSymbolInfo().quantityPrecision` |

**Autentikasi:**
- Menggunakan **EIP-712 Typed Data** signing
- Domain: `AsterSignTransaction`, Chain ID: `1666`
- Nonce berbasis microsecond timestamp

---

### 10. 📈 Market Data Provider (Penyedia Data Market)

**File:** `src/exchange/market-data.provider.ts`

Aggregator data market yang menggabungkan raw data dari exchange dengan indikator teknikal:

- **Strategy-Adaptive Interval** — Menggunakan timeframe `5m` untuk SCALPING dan `1h` untuk INTRADAY/SWING
- **Real-time Market Data** — Mengambil klines dan ticker dari AsterDex
- **Indicator Calculation** — Menghitung EMA20, EMA50, RSI, ATR dari data candlestick
- **Trend Detection** — Menentukan trend (BULLISH/BEARISH/NEUTRAL) dari EMA crossover
- **Aggregated Account Metrics** — Menghitung equity, available balance, margin ratio, maintenance margin, margin balance, dan total wallet balance dari raw API data
- **Active Position Filtering** — Filter posisi dengan `positionAmt ≠ 0` dari semua posisi
- **Unrealized PnL Aggregation** — Menghitung total unrealized PnL dari seluruh posisi aktif
- **Safety Block Pattern** — Jika API gagal, mengembalikan dummy position `SAFETY_BLOCK` untuk mencegah trade yang tidak diinginkan
- **Fallback to Mock** — Jika API market data gagal, menggunakan data mock sebagai fallback

---

### 11. 💹 Order Executor (Eksekutor Order)

**File:** `src/exchange/order.executor.ts`

Mengeksekusi order ke exchange AsterDex dengan proteksi otomatis dan optimisasi leverage:

- **Min Notional** — Memastikan nilai order minimal $5.1 (memenuhi minimum exchange $5)
- **Dynamic Quantity** — Menghitung kuantitas berdasarkan harga terkini dan presisi simbol
- **Dual Precision** — Menggunakan `quantityPrecision` untuk kuantitas dan `pricePrecision` untuk harga SL/TP
- **Auto-Leverage Optimization** — Sistem otomatis menaikkan leverage jika saran AI terlalu rendah untuk memenuhi margin minimum:
  - Menghitung leverage minimum yang dibutuhkan: `ceil(minNotional / (available * 0.9))`
  - Auto-increase jika leverage AI < minimum yang dibutuhkan
- **Asset-Class Leverage Cap** — Membatasi leverage berdasarkan jenis aset:
  - BTC/ETH (major) → max 200x
  - Altcoins → max 50x
- **20% Margin Buffer** — Menambahkan 20% buffer pada kalkulasi margin untuk fees, slippage, dan minimum wallet
- **Auto Margin** — Memaksa CROSSED margin type
- **Precision Handling** — Menggunakan `Math.ceil` untuk memastikan kuantitas selalu ≥ minimum
- **Price Tracking** — Mengembalikan harga eksekusi aktual untuk pencatatan entry price yang akurat
- **Strategy-Dynamic Stop Loss & Take Profit** — Setelah order utama tereksekusi, otomatis memasang SL/TP berdasarkan strategi:
  - `SCALPING` → SL 0.5%, TP 0.75% (RR 1:1.5)
  - `INTRADAY` → SL 1%, TP 1.5% (RR 1:1.5)
  - `SWING` → SL 3%, TP 10% (RR 1:3.3)
  - Graceful fallback jika SL/TP gagal (warning log, posisi tetap terbuka)

---

### 12. 🔄 Trade Service (Layanan Trading)

**File:** `src/services/trade.service.ts`

Orkestrator yang menghubungkan keputusan AI dengan eksekusi order:

- **Decision Handling** — Memfilter keputusan SKIP/WAIT dan hanya mengeksekusi LONG/SHORT
- **Order Execution** — Meneruskan order ke Order Executor
- **Session Linking** — Menghubungkan setiap trade ke session aktif via `SessionService`
- **Accurate Entry Price** — Menyimpan harga eksekusi aktual dari Order Executor
- **Database Logging** — Menyimpan setiap trade ke MongoDB dengan detail lengkap
- **Error Handling** — Menangkap dan mencatat error eksekusi

---

### 13. 🗄️ Database Layer (Lapisan Database)

#### MongoDB Connection
**File:** `src/database/mongo.ts`
- Koneksi ke MongoDB Atlas dengan reconnect handling
- Event listener untuk disconnect dan error

#### Models (Skema Data)

| Model | File | Deskripsi |
|-------|------|-----------|
| **Trade** | `src/database/models/trade.model.ts` | Menyimpan setiap trade: session_id (ref Session), pair, action, entry/exit price, exit_reason, mistake_analysis, leverage, confidence, regime, risk, PnL, AI reasoning |
| **Memory** | `src/database/models/memory.model.ts` | Menyimpan pelajaran: kategori, kesalahan, pelajaran, kondisi market, frekuensi |
| **Session** | `src/database/models/session.model.ts` | Menyimpan sesi: PnL harian, equity puncak, drawdown, streak, mode |

**Index yang Dioptimasi:**
- Trade: `created_at DESC`, `result + confidence_score`, `market_regime + result`
- Memory: `category + effectiveness_score`, `last_triggered_at DESC`
- Session: `started_at DESC`, `current_mode + cooldown_until`

#### Repositories (Akses Data)

| Repository | Fitur |
|------------|-------|
| **TradeRepository** | `create()`, `findRecent(limit)`, `getStats()` (aggregation pipeline) |
| **MemoryRepository** | `saveLesson()` (upsert), `findTopMistakes(limit)` |
| **SessionRepository** | `create()`, `findLatest()`, `update(id, data)` |

---

### 14. 🌐 Monitoring API (API Pemantauan)

**File:** `src/api/monitoring-api.ts`

Server Fastify 5 yang menyediakan endpoint monitoring:

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/health` | GET | Status kesehatan sistem (uptime, memory, DB status) |
| `/metrics` | GET | Prometheus metrics (format text/plain) |
| `/trades` | GET | 20 trade terbaru dari database |
| `/trades/stats` | GET | Statistik trading (aggregation per hasil) |

---

### 15. 📊 Monitoring & Alerting

#### Prometheus Metrics
**File:** `src/monitoring/metrics.ts`

| Metric | Tipe | Deskripsi |
|--------|------|-----------|
| `trader_trades_total` | Counter | Total trade yang dieksekusi (per pair, action, result) |
| `trader_pnl_total` | Gauge | Total Profit and Loss |
| Default Metrics | Auto | CPU, memory, event loop, dll. |

#### Health Check
**File:** `src/monitoring/health-check.ts`
- System uptime
- Memory usage (heap, RSS, external)
- Database connection status
- Timestamp

#### Alert Manager
**File:** `src/monitoring/alert-manager.ts`
- Alert dengan 3 level severity: LOW, MEDIUM, HIGH
- Balance threshold alert (jika saldo < $1)
- Console error untuk alert CRITICAL
- Placeholder untuk integrasi Telegram/Discord/Slack

---

### 16. ♾️ Dual-Engine Trading Architecture & Background Jobs

**Arsitektur dual-engine:** Engine otomatis dipilih berdasarkan `TRADING_STRATEGY` yang dikonfigurasi.

| Komponen | Tipe | Strategi | Deskripsi |
|----------|------|----------|-----------|
| **Infinite Loop** | `while(true)` | SCALPING | Scan market non-stop dengan hot pair filtering |
| **Scheduled Scan** | Cron `*/15 * * * *` | INTRADAY | Scan setiap 15 menit + initial scan on startup |
| **Scheduled Scan** | Cron `0 * * * *` | SWING | Scan setiap 1 jam + initial scan on startup |
| **Memory Consolidation** | Cron `0 0 * * *` | Semua | Mengkonsolidasi memori dan pelajaran harian |

**Reusable `runMarketScan(mode)`** — Fungsi scan terpisah yang dapat dipanggil dari infinite loop maupun cron:
```
runMarketScan(mode) {
  1. Cek Account & Risk Status
  2. Jika Blocked → Portfolio Snapshot → return false
  3. Fetch All Tickers → Filter Hot Pairs:
     - SCALPING: |priceChange| > 2% ATAU volume > $1M, sorted by volume
     - INTRADAY/SWING: Semua pair, sorted by volume
  4. Loop setiap pair:
     - Evaluate via AI Decision Engine
     - Jika peluang → Execute
       - Sukses? → return true (stop scanning)
       - Gagal? → Lanjut ke pair berikutnya
     - Micro-delay 100ms antar pair
  5. return true (scan selesai)
}
```

**Engine Features:**
- **Hot Pair Filtering (SCALPING)** — Hanya scan koin dengan volatilitas tinggi (>2% change) atau volume besar (>$1M)
- **Volume-Sorted Scanning** — Semua strategi memproses pair dari volume tertinggi ke terendah
- **Smart Execution Continue** — Jika eksekusi gagal (misal margin kurang), lanjut scan pair berikutnya
- **Smart Blocking** — Saat posisi penuh atau ada safety risk, return false (bukan spam API)
- **Conditional Break** — Hanya break dari loop scan jika trade benar-benar berhasil dieksekusi
- **API-Friendly** — Micro-delay 100ms antar pair evaluation untuk menghindari rate limit
- **Reusable Portfolio Snapshot** — Fungsi `displayPortfolioSnapshot(status?)` yang menerima optional parameter:
  - 📊 **Account Summary** — Equity, available balance, margin balance
  - 💰 **Position Details** — Side, size, entry/mark/liq price, margin, PnL, ROE per posisi
  - Graceful handling jika tidak ada posisi aktif

---

### 17. ✅ Validasi & Safety

#### Environment Validation
**File:** `src/config/env.ts`
- Validasi semua environment variable menggunakan Zod
- Fail-fast jika konfigurasi tidak valid

#### JSON Validator
**File:** `src/utils/json-validator.ts`
- Validasi respons AI terhadap schema Zod yang ketat
- Ekstraksi JSON dari respons LLM yang mungkin mengandung teks tambahan
- Error messages yang informatif per field

---

### 18. 🧰 Utilities (Fungsi Utilitas)

| Utility | File | Fitur |
|---------|------|-------|
| **Logger** | `src/utils/logger.ts` | Pino logger dengan format pretty |
| **Retry** | `src/utils/retry.ts` | Generic retry function dengan configurable attempts & delay |
| **Helpers** | `src/utils/helpers.ts` | `formatCurrency()`, `sleep()`, `calculatePercentageChange()` |
| **Time** | `src/utils/time.ts` | `getTimestamp()`, `isSameDay()`, `minutesToMs()` |

---

### 19. 🧪 Scripts & Testing

| Script | File | Deskripsi |
|--------|------|-----------|
| **Backtest** | `src/scripts/backtest.ts` | Backtesting dengan 5 iterasi pada pair berbeda (BTC, SOL, LINK, DOGE, AVAX) |
| **Simulate Live** | `src/scripts/simulate-live.ts` | Simulasi high-fidelity trading $1 dengan kalkulasi PnL |
| **Verify All** | `src/scripts/verify-all.ts` | Verifikasi komprehensif semua fitur (Indicator, Risk, Cooldown, Trade, Alert) |
| **Check Balance** | `src/scripts/check-balance.ts` | Mengecek saldo akun AsterDex |
| **Test Ollama** | `src/scripts/test-ollama.ts` | Test koneksi dan respons Ollama |
| **Test Real-time** | `src/scripts/test-real-time.ts` | Test data market real-time |
| **Test V3 Realtime** | `src/scripts/test-v3-realtime.ts` | Test AsterDex V3 API endpoints |

**Unit Tests:**
- `src/tests/unit/risk-manager.spec.ts` — Test Risk Manager menggunakan Vitest

---

### 20. 🔄 Session Service (Manajemen Sesi)

**File:** `src/services/session.service.ts`

Mengelola lifecycle sesi trading:

- **Start New Session** — Membuat sesi baru di database saat bootstrap (dengan mode NORMAL/SAFE_MODE/COOLDOWN)
- **Get Current Session ID** — Menyediakan session ID untuk dihubungkan ke setiap trade
- **Update Stats** — Memperbarui statistik sesi (total trades, PnL harian)
- **Fail-Safe** — Throw error jika belum ada session aktif saat trade dieksekusi

---

### 21. 📋 Type System (Sistem Tipe)

#### Enum Types (`src/types/enum.types.ts`)

| Enum | Values |
|------|--------|
| `TradingStrategy` | `SCALPING`, `INTRADAY`, `SWING` |
| `TradingMode` | `PAPER`, `LIVE` |
| `TradeAction` | `LONG`, `SHORT`, `WAIT`, `SKIP` |
| `MarketRegime` | `TRENDING`, `RANGING`, `VOLATILE`, `UNCLEAR` |
| `RiskLevel` | `LOW`, `MEDIUM`, `HIGH` |
| `SessionMode` | `NORMAL`, `SAFE_MODE`, `COOLDOWN` |
| `MemoryCategory` | `ENTRY`, `EXIT`, `RISK`, `PSYCHOLOGY` |
| `PositionSize` | `SMALL`, `NORMAL`, `REDUCED` |
| `TradeResult` | `WIN`, `LOSS`, `BREAKEVEN` |

#### AI Types (`src/types/ai.types.ts`)
- `AIDecision` — Struktur keputusan trading AI (12 field)
- `OllamaRequest` — Format request ke Ollama API
- `OllamaResponse` — Format respons dari Ollama (termasuk metrics)

#### Market Types (`src/types/market.types.ts`)
- `MarketData` — Data market lengkap (harga, indikator, trend, price_change_24h)
- `AccountStatus` — Status akun lengkap:
  - Core: `current_equity`, `open_positions`, `daily_pnl`, `loss_streak`
  - Extended: `available_balance`, `margin_ratio`, `maintenance_margin`, `margin_balance`, `total_wallet_balance`

---

## 🔄 Trading Pipeline (Alur Trading)

```
 0. 🚀 Bootstrap: Connect DB → Start API → Init Session
         │
 1. 🎯 Strategy Router:
         ├─ SCALPING → startInfiniteLoop() [while(true)]
         ├─ INTRADAY → startScheduledTasks() [cron */15 * * * *]
         └─ SWING    → startScheduledTasks() [cron 0 * * * *]
         │
 ┌───────┤ runMarketScan(mode)
 │       │
 │  2. 🛡️ Account & Risk Check
 │       │     └─ Jika blocked → Portfolio Snapshot → return false
 │       │
 │  3. 📡 Fetch All Tickers → Filter Hot Pairs (strategy-based)
 │       │     SCALPING: |change| > 2% OR volume > $1M
 │       │     INTRADAY/SWING: Semua, sorted by volume
 │       │
 │  4. 🔁 Loop hot pairs:
 │       │     ├─ 📊 Fetch market data (price, EMA, RSI, ATR)
 │       │     ├─ 🛡️ Pre-AI Risk Check (posisi penuh / duplicate coin)
 │       │     ├─ 📚 Load memory (5 trade terakhir)
 │       │     ├─ 📝 Build strategy-adaptive prompt (Ultra Scalping/Standard)
 │       │     ├─ 🤖 Kirim ke Ollama/Gemma4 → terima JSON
 │       │     ├─ ✅ Validasi JSON terhadap Zod schema
 │       │     ├─ 🛡️ Final Risk Validation (leverage cap)
 │       │     ├─ 💹 Auto-Leverage Optimization → Asset-Class Cap
 │       │     ├─ 💹 Eksekusi order → Auto SL/TP → Simpan ke DB
 │       │     ├─ ✅ Sukses? → return true (stop scanning)
 │       │     ├─ ❌ Gagal? → Lanjut ke pair berikutnya
 │       │     └─ ⏱️ Micro-delay 100ms (API friendly)
 │       │
 └───────┘

 📅 Background: Memory Consolidation (Daily at 00:00)
```

---

## 🚀 Cara Menjalankan

### Prerequisites
- **Node.js** LTS
- **MongoDB** (Atlas atau lokal)
- **Ollama** terinstal dan running (`ollama serve`)
- **Model Gemma 4** terinstal di Ollama (`ollama pull gemma4:latest`)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Konfigurasi environment
cp .env.example .env
# Edit .env sesuai konfigurasi Anda

# 3. Jalankan development mode
npm run dev

# 4. Jalankan production mode
npm run build
npm start
```

### Scripts Tersedia

```bash
npm run dev          # Development mode (hot-reload dengan tsx)
npm run build        # Build TypeScript ke JavaScript
npm start            # Jalankan production build
npm test             # Jalankan unit tests (Vitest)
npm run backtest     # Jalankan backtesting
```

---

## 🔧 Konfigurasi Environment

| Variable | Deskripsi | Default |
|----------|-----------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `LOG_LEVEL` | Level logging Pino | `info` |
| `MONGODB_URI` | URI koneksi MongoDB Atlas | — |
| `OLLAMA_BASE_URL` | URL server Ollama | `http://localhost:11434` |
| `OLLAMA_MODEL` | Model AI yang digunakan | `gemma4:latest` |
| `MOCK_AI` | Gunakan mock AI (tanpa Ollama) | `false` |
| `ASTERDEX_USER_ADDRESS` | Wallet address pengguna | — |
| `ASTERDEX_API_KEY` | API key (signer address) | — |
| `ASTERDEX_SECRET` | Private key untuk signing | — |
| `ASTERDEX_BASE_URL` | Base URL AsterDex API | `https://fapi.asterdex.com` |
| `TRADING_MODE` | Mode trading | `PAPER` |
| `MAX_POSITIONS` | Jumlah maksimal posisi aktif bersamaan | `2` |
| `TRADING_STRATEGY` | Strategi trading AI | `SCALPING` |
| `BACKTEST_ITERATIONS` | Jumlah iterasi backtesting | `5` |

---

## 🔮 Roadmap & Scalability

### ✅ Sudah Diimplementasi
- [x] AI Decision Engine dengan Gemma 4
- [x] **Dual-Engine Architecture** (Infinite Loop SCALPING / Cron INTRADAY 15m / Cron SWING 1h)
- [x] **Hot Pair Filtering** (volatilitas >2% atau volume >$1M untuk SCALPING)
- [x] **Trading Strategy System** (SCALPING / INTRADAY / SWING)
- [x] **Smart Execution Continue** (lanjut scan jika eksekusi gagal)
- [x] **Auto-Leverage Optimization** (auto-increase leverage untuk memenuhi margin minimum)
- [x] **Asset-Class Leverage Cap** (BTC/ETH max 200x, altcoins max 50x)
- [x] **Strategy-Dynamic SL/TP** (SCALPING 0.5%/0.75%, INTRADAY 1%/1.5%, SWING 3%/10%)
- [x] **Duplicate Position Block** (cegah double exposure pada koin yang sama)
- [x] **Dynamic Liquidation Threshold** (SCALPING 15%, INTRADAY/SWING 30%)
- [x] **Smart Blocking & Crash Recovery** (30s wait / 10s retry)
- [x] Integrasi AsterDex V3 API (EIP-712)
- [x] Indikator teknikal (EMA, RSI, ATR) dengan null-safety
- [x] Risk Management & Leverage Cap
- [x] Dynamic Max Positions (configurable via `MAX_POSITIONS`)
- [x] Pre-AI Risk Validation (skip AI jika posisi penuh)
- [x] Session Management (lifecycle tracking)
- [x] Reusable Portfolio Snapshot (equity, margin, ROE, liq price)
- [x] Aggregated Account Metrics (margin ratio, maintenance margin, wallet balance)
- [x] Safety Block Pattern (mencegah trade saat API gagal)
- [x] Accurate Entry Price Tracking dari execution
- [x] Trade History dengan exit_reason & mistake_analysis
- [x] Self-Learning Memory System
- [x] Full Market Scanning (semua pair)
- [x] Monitoring API (Prometheus + Fastify)
- [x] Backtesting & Simulation
- [x] Comprehensive Type Safety (Zod + TypeScript)
- [x] **Pre-Check Margin Validation** (20% buffer untuk fees & slippage)
- [x] **Strategy-Adaptive Timeframe** (5m SCALPING, 1h INTRADAY/SWING)
- [x] **Dual Precision** (quantityPrecision + pricePrecision dari exchange)

### 🔜 Rencana Pengembangan
- [ ] Multi-agent trading
- [ ] Vector memory embeddings
- [ ] RAG-based market memory
- [ ] Sentiment analysis
- [ ] Portfolio balancing AI
- [ ] Web dashboard
- [ ] Telegram/Discord alert integration

---

## 📄 Lisensi

MIT License © 2026 Silki

---

> **⚠️ Disclaimer:** Sistem ini dibuat untuk tujuan eksperimen dan edukasi. Trading cryptocurrency memiliki risiko tinggi. Gunakan dengan bijak dan pahami risiko yang ada.
