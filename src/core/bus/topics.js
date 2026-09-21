/**
 * Daftar Channel & Topic Redis Pub/Sub untuk komunikasi antar-agen
 */
export const TOPICS = {
    // Alur Master Orchestrator
    MASTER: {
        INCOMING_PROMPT: 'agent.master.incoming_prompt',
        NOTIFY_CLIENT: 'agent.master.notify_client',
        TRIGGER_BRIEFING: 'agent.master.trigger_briefing'
    },
    // The Archivist (Memory)
    MEMORY: {
        SEARCH_HYBRID: 'agent.memory.search_hybrid',
        INGEST_LOG: 'agent.memory.ingest_log',
        INGEST_FACT: 'agent.memory.ingest_fact'
    },
    // The Watchdog (DevOps & Docker)
    DEVOPS: {
        ALERTS: 'agent.alerts',
        HEALTH_CHECK: 'agent.devops.health_check',
        RESTART_CONTAINER: 'agent.devops.restart_container',
        UPDATE_CONTAINER: 'agent.devops.update_container',
        CHATROOM: 'waguri:chatroom'
    },
    // The Caretaker (IoT & Hardware ESP32-S3)
    IOT: {
        COMMAND: 'agent.iot.command',
        TELEMETRY: 'agent.iot.telemetry',
        DISPLAY_RENDER: 'agent.iot.display_render'
    },
    // Content Sync & E-Commerce
    COMMERCE: {
        TRANSACTION_WEBHOOK: 'agent.commerce.transaction_webhook',
        SYNC_MARKDOWN: 'agent.commerce.sync_markdown',
        MARKET_SUMMARY: 'agent.commerce.market_summary'
    }
};
