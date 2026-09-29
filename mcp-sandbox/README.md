# 🧪 Waguri MCP Sandbox Server

Service kontainer modular eksekutor dan sandbox untuk asisten AI **Waguri (`second-brain`)**.

## Fitur Utama
1. **Model Context Protocol (MCP) Standard:** Mendukung protokol resmi MCP melalui HTTP/SSE (`/sse` dan `/message`) serta direct REST fallback (`/tools` dan `/tools/call`).
2. **Dynamic Dependency Download:** AI bebas menginstal paket `npm` dan `pip` secara dinamis di dalam folder `/workspace` tanpa menyentuh container otak utama.
3. **Arbitrary Code Execution:** Menjalankan script Python, JavaScript (Node), dan Bash dengan isolasi direktori dan batas timeout otomatis (default 30 detik).
4. **Git Sync:** Terhubung ke Git untuk auto-pull repositori tools eksternal.
5. **Nervous System Integration:** Memancarkan status progres langsung ke Redis Pub/Sub topic `waguri:chatroom`.

## Environment Variables
- `PORT`: Port server (default: `4000`)
- `REDIS_HOST`: Host Redis (default: `redis`)
- `REDIS_PORT`: Port Redis (default: `6379`)
- `WORKSPACE_DIR`: Direktori kerja eksekusi (default: `/workspace`)
- `TOOLS_GIT_REPO`: (Opsional) URL Git repository khusus tools
- `GIT_BRANCH`: (Opsional) Branch git (default: `main`)
