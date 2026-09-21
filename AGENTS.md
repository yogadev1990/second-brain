# Waguri Master-Subagent Architecture

Sistem ini menerapkan pola **Event-Driven Master-Subagent Architecture** menggunakan **Redis Pub/Sub** sebagai nervous system, **Milvus + MongoDB** sebagai penyimpanan memori jangka panjang, **Eclipse Mosquitto (MQTT)** untuk integrasi IoT ESP32-S3, dan **Docker API (`dockerode`)** untuk pemantauan infrastruktur mandiri.

---

## Direktori Agen & Tanggung Jawab

| Nama Agen | File Utama | Peran Utama | Channel Redis | Integrasi Utama |
| :--- | :--- | :--- | :--- | :--- |
| **Master Orchestrator** | `src/agents/master/masterAgent.js` | Routing pesan, orkestrasi subagen, Smart DND (23:00 - 05:00 WIB), Daily Briefing (07:00 WIB) | `agent.master.*`, `agent.alerts` | Socket.io, Express, Redis RPC |
| **The Archivist** | `src/agents/archivist/archivistAgent.js` | Manajemen memori jangka panjang, Hybrid RRF Search, ekstraksi log obrolan otomatis | `agent.memory.*` | Milvus v3.0, MongoDB Text Index, Gemini Embedding |
| **The Watchdog** | `src/agents/watchdog/watchdogAgent.js` | Pemantau kesehatan container Docker (`revandastore-app`, `wiki-web`, dll), auto-restart mandiri | `agent.devops.*`, `agent.alerts` | Docker Engine API (`/var/run/docker.sock`) |
| **The Caretaker** | `src/agents/caretaker/caretakerAgent.js` | Jembatan IoT dua arah untuk hardware kamar (Lampu meja USB & Layar AMOLED 2.06") | `agent.iot.*` | Eclipse Mosquitto MQTT Broker |
| **Content & E-Commerce** | `src/agents/sync-commerce/syncCommerceAgent.js` | Sinkronisasi catatan ke file Markdown (.md) dan penangkap webhook transaksi toko online | `agent.commerce.*` | Shared Docker Volume, Store Webhook |

---

## Protokol Komunikasi Antar-Agen

1. **Fire & Forget (Broadcast / Alert):**
   - Agen pengirim memanggil `eventBus.publish(channel, payload)`.
   - Contoh: The Watchdog mendeteksi container mati, mengirimkan alert ke `TOPICS.DEVOPS.ALERTS`.

2. **RPC (Request - Response):**
   - Agen pengirim memanggil `eventBus.request(channel, action, payload, sourceAgent)`.
   - Menggunakan `correlationId` unik dan channel balasan temporer `rpc.reply.<sourceAgent>.<uuid>`.
   - Contoh: Master Agent meminta data pencarian ingatan ke The Archivist via `TOPICS.MEMORY.SEARCH_HYBRID`.

3. **Smart DND Mode (23:00 - 05:00 WIB Palembang):**
   - Diatur oleh `DNDManager`. Seluruh notifikasi bertaraf `NORMAL` atau `LOW` pada jam istirahat otomatis dialihkan ke MongoDB Outbox (`OutboxNotification`).
   - Notifikasi bertaraf `CRITICAL` (seperti container crash) diizinkan menembus DND.
   - Pukul 05:01 WIB, antrean Outbox otomatis di-*flush* dan dikirimkan saat bangun tidur.

4. **Dynamic Ephemeral Subagent Spawning (Self-Healing & Auto-Destruct):**
   - Dikelola oleh **The Watchdog** (`spawnEphemeralCoder`).
   - Ketika kontainer target (`revandastore-app`, `wiki-web`, dll) mengalami crash berulang (>= 2x), Watchdog secara dinamis membuat kontainer ephemeral (`waguri-coder-base:latest`) via Dockerode.
   - **Binds & Sharing:** Kontainer ephemeral me-mount folder sumber kode kontainer target ke `/workspace:rw` dan socket Docker secara read-only (`:ro`).
   - **Chatroom Streaming:** Mengirimkan log jurnal real-time ke Redis Pub/Sub channel `waguri:chatroom` (`{ agentName, status: 'thinking'|'working'|'reporting'|'done', message }`).
   - **Clean Self-Destruct:** Saat status `'done'` dipancarkan atau kontainer exit (maks timeout 5 menit), Watchdog otomatis men-destroy (stop & remove) kontainer tersebut untuk membebaskan RAM dan CPU server.

