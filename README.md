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
│               Cron Jobs + Bootstrap                   │
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
- **Event Driven** — Cron-based job scheduling setiap 5 menit
- **AI Feedback Loop** — Hasil trading sebelumnya diinjeksikan ke prompt AI
- **Self-Learning Memory** — MongoDB menyimpan pelajaran dari kesalahan
- **Risk First Trading System** — Risk Manager sebagai penjaga terakhir sebelum eksekusi

---

## 🛠️ Tech Stack

| Kategori | Teknologi |
|----------|-----------|
| **Runtime** | Node.js + TypeScript 6.0 |
| **Web Server** | Fastify 5 |
| **AI Engine** | Ollama + Gemma (2B / 7B-instruct) |
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
│   ├── server.ts                    # Entry point utama (bootstrap + cron + immediate scan)
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

- **Model Configurasi** — Mendukung model Gemma 2B hingga 7B-instruct
- **Parameter Tuning** — Temperature 0.1 (konservatif), Top-K 40, Top-P 0.85
- **Mock Mode** — Mode mock AI (`MOCK_AI=true`) untuk testing tanpa Ollama
- **JSON Extraction** — Mengekstrak dan memvalidasi JSON dari respons LLM
- **Timeout Management** — Timeout 150 detik untuk request yang berat
- **Latency Tracking** — Mencatat latency setiap request ke AI

---

### 3. 📝 Prompt Builder (Konstruktor Prompt Dinamis)

**File:** `src/core/ai/prompt-builder.ts`

Membangun prompt terstruktur dalam Bahasa Indonesia untuk model Gemma:

- **System Instruction** — Persona "Hyper-Gemma Pro" sebagai AI Trading Engine
- **Account Context** — Menyertakan equity, PnL harian, dan loss streak
- **Market Context** — Menyertakan harga, EMA20/50, RSI, trend, dan ATR
- **Memory Injection** — Menyuntikkan pelajaran dari trading sebelumnya
- **Response Schema** — Memaksa output JSON dengan format ketat
- **Prinsip Capital Multiplication** — Mencari peluang profit di seluruh market

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
- **Liquidation Safety Check** — Memblokir pembukaan posisi baru jika posisi existing terlalu dekat dengan harga likuidasi (threshold: 30% distance)
- **Leverage Cap** — Membatasi leverage hingga maksimal 500x
- **Position Sizing** — Kalkulasi ukuran posisi berdasarkan tingkat risiko:
  - `NORMAL` → 100% dari safe margin
  - `REDUCED` → 50% dari safe margin
  - `SMALL` → 25% dari safe margin
- **Active Position Monitor** — Menampilkan detail posisi aktif (PnL, entry price, margin, ROE, liquidation price)
- **Trading Blocked** — Memblokir trade baru jika posisi penuh atau ada safety risk

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
| **Get Ticker 24h** | Mengambil statistik harga 24 jam |
| **Get All Symbols** | Mengambil semua pasangan trading yang aktif |
| **Get Account Balance** | Mengambil saldo akun (USDC/USDT) |
| **Get Positions** | Mengambil posisi-posisi aktif |
| **Place Order** | Membuat order MARKET atau LIMIT |
| **Set Leverage** | Mengatur leverage per simbol |
| **Set Margin Type** | Mengatur tipe margin (CROSSED/ISOLATED) |
| **Get Symbol Precision** | Mengambil presisi kuantitas per simbol |

**Autentikasi:**
- Menggunakan **EIP-712 Typed Data** signing
- Domain: `AsterSignTransaction`, Chain ID: `1666`
- Nonce berbasis microsecond timestamp

---

### 10. 📈 Market Data Provider (Penyedia Data Market)

**File:** `src/exchange/market-data.provider.ts`

Aggregator data market yang menggabungkan raw data dari exchange dengan indikator teknikal:

- **Real-time Market Data** — Mengambil klines dan ticker dari AsterDex
- **Indicator Calculation** — Menghitung EMA20, EMA50, RSI, ATR dari data candlestick
- **Trend Detection** — Menentukan trend (BULLISH/BEARISH/NEUTRAL) dari EMA crossover
- **Account Status** — Mengambil equity, posisi aktif, dan PnL dari akun
- **Fallback to Mock** — Jika API gagal, menggunakan data mock sebagai fallback

---

### 11. 💹 Order Executor (Eksekutor Order)

**File:** `src/exchange/order.executor.ts`

Mengeksekusi order ke exchange AsterDex:

- **Min Notional** — Memastikan nilai order minimal $5.1 (memenuhi minimum exchange $5)
- **Dynamic Quantity** — Menghitung kuantitas berdasarkan harga terkini dan presisi simbol
- **Auto Leverage** — Mengatur leverage sebelum membuat order
- **Auto Margin** — Memaksa CROSSED margin type
- **Precision Handling** — Menggunakan `Math.ceil` untuk memastikan kuantitas selalu ≥ minimum
- **Price Tracking** — Mengembalikan harga eksekusi aktual untuk pencatatan entry price yang akurat

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
| **Trade** | `src/database/models/trade.model.ts` | Menyimpan setiap trade: pair, action, leverage, confidence, regime, risk, PnL, AI reasoning |
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

### 16. ⏰ Scheduled Jobs & Scan Engine (Pekerjaan Terjadwal)

| Job | Jadwal | Deskripsi |
|-----|--------|-----------|
| **Immediate Scan** | Saat startup | Scan market langsung saat server dimulai (tidak menunggu 5 menit) |
| **Full Market Scan** | Setiap 5 menit (`*/5 * * * *`) | Memindai seluruh market, evaluasi setiap pair, eksekusi jika ada peluang |
| **Memory Consolidation** | Setiap hari pukul 00:00 (`0 0 * * *`) | Mengkonsolidasi memori dan pelajaran dari trading sebelumnya |

**Scan Engine Features:**
- **Scan Deduplication** — Cooldown 1 menit antar scan untuk mencegah redundansi (startup vs cron)
- **Pre-Scan Risk Validation** — Cek status posisi dan safety **sebelum** iterasi pair (hemat API calls)
- **Detailed Portfolio Snapshot** — Menampilkan side, size, entry/mark/liq price, margin, PnL, ROE untuk setiap posisi aktif saat scan di-skip

**Market Scan Flow:**
1. Pre-scan: cek posisi aktif & liquidation safety → jika blocked, tampilkan portfolio snapshot dan skip
2. Ambil semua simbol trading aktif dari exchange
3. Evaluasi setiap pair menggunakan AI Decision Engine
4. Jika ditemukan peluang (LONG/SHORT), eksekusi dan berhenti (max positions sesuai `MAX_POSITIONS`)
5. Tampilkan portfolio snapshot setelah scan

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
- `MarketData` — Data market lengkap (harga, indikator, trend)
- `AccountStatus` — Status akun (equity, posisi, PnL, streak)

---

## 🔄 Trading Pipeline (Alur Trading)

```
 0. 🚀 Bootstrap: Connect DB → Start API → Init Session → Immediate Scan
         │
 1. 🔒 Scan Deduplication: Skip jika scan terakhir < 1 menit
         │
 2. 🛡️ Pre-Scan Risk Check: Cek posisi aktif & liquidation safety
         │     └─ Jika blocked → Tampilkan Portfolio Snapshot → SKIP
         │
 3. 📡 Fetch semua trading pairs dari exchange
         │
 4. 🔁 Loop setiap pair:
         │     ├─ 📊 Fetch market data (price, EMA, RSI, ATR)
         │     ├─ 🛡️ Pre-AI Risk Check → Skip AI jika posisi penuh
         │     ├─ 📚 Load memory (5 trade terakhir)
         │     ├─ 📝 Build prompt (market + account + memory)
         │     ├─ 🤖 Kirim ke Ollama/Gemma → terima JSON
         │     ├─ ✅ Validasi JSON terhadap Zod schema
         │     ├─ 🛡️ Final Risk Validation (leverage cap)
         │     └─ 💹 Eksekusi order → Simpan ke DB dengan session ID
         │
 5. 💰 Portfolio Snapshot (jika ada posisi aktif)
         │
 6. 🔁 Loop setiap 5 menit + Memory Consolidation harian
```

---

## 🚀 Cara Menjalankan

### Prerequisites
- **Node.js** LTS
- **MongoDB** (Atlas atau lokal)
- **Ollama** terinstal dan running (`ollama serve`)
- **Model Gemma** terinstal di Ollama (`ollama pull gemma:2b`)

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
| `OLLAMA_MODEL` | Model AI yang digunakan | `gemma:2b` |
| `MOCK_AI` | Gunakan mock AI (tanpa Ollama) | `false` |
| `ASTERDEX_USER_ADDRESS` | Wallet address pengguna | — |
| `ASTERDEX_API_KEY` | API key (signer address) | — |
| `ASTERDEX_SECRET` | Private key untuk signing | — |
| `ASTERDEX_BASE_URL` | Base URL AsterDex API | `https://fapi.asterdex.com` |
| `TRADING_MODE` | Mode trading | `PAPER` |
| `MAX_POSITIONS` | Jumlah maksimal posisi aktif bersamaan | `2` |

---

## 🔮 Roadmap & Scalability

### ✅ Sudah Diimplementasi
- [x] AI Decision Engine dengan Gemma
- [x] Integrasi AsterDex V3 API (EIP-712)
- [x] Indikator teknikal (EMA, RSI, ATR) dengan null-safety
- [x] Risk Management & Leverage Cap
- [x] Dynamic Max Positions (configurable via `MAX_POSITIONS`)
- [x] Liquidation Safety Check (30% threshold)
- [x] Pre-AI Risk Validation (skip AI jika posisi penuh)
- [x] Session Management (lifecycle tracking)
- [x] Immediate Scan on Startup + Scan Deduplication
- [x] Detailed Portfolio Snapshot (margin, ROE, liq price)
- [x] Accurate Entry Price Tracking dari execution
- [x] Self-Learning Memory System
- [x] Full Market Scanning (semua pair)
- [x] Monitoring API (Prometheus + Fastify)
- [x] Backtesting & Simulation
- [x] Comprehensive Type Safety (Zod + TypeScript)

### 🔜 Rencana Pengembangan
- [ ] Multi-agent trading
- [ ] Vector memory embeddings
- [ ] RAG-based market memory
- [ ] Sentiment analysis
- [ ] Portfolio balancing AI
- [ ] Web dashboard
- [ ] Telegram/Discord alert integration
- [ ] Stop-loss & Take-profit auto management

---

## 📄 Lisensi

MIT License © 2026 Silki

---

> **⚠️ Disclaimer:** Sistem ini dibuat untuk tujuan eksperimen dan edukasi. Trading cryptocurrency memiliki risiko tinggi. Gunakan dengan bijak dan pahami risiko yang ada.
