import mqtt from 'mqtt';
import { eventBus } from '../../core/bus/eventBus.js';
import { TOPICS } from '../../core/bus/topics.js';
import { createAgentLogger } from '../../core/logger/index.js';

const logger = createAgentLogger('TheCaretaker');

export class CaretakerAgent {
    constructor() {
        const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
        this.client = mqtt.connect(brokerUrl, {
            reconnectPeriod: 5000,
            connectTimeout: 10000
        });
        this.isConnected = false;
    }

    async init() {
        logger.info('Menginisialisasi Subagen The Caretaker (IoT Gateway ESP32-S3)...');

        this.client.on('connect', () => {
            this.isConnected = true;
            logger.info('✅ Terhubung ke Eclipse Mosquitto MQTT Broker.');
            // Dengarkan pembacaan status/sensor dari ESP32-S3
            this.client.subscribe('esp32/telemetry/#');
            this.client.subscribe('esp32/sensors/#');
        });

        this.client.on('error', (err) => {
            logger.warn({ err: err.message }, 'MQTT Broker belum siap atau koneksi terputus.');
        });

        this.client.on('message', async (topic, message) => {
            try {
                const payload = JSON.parse(message.toString());
                logger.debug({ topic, payload }, 'Menerima telemetry dari hardware ESP32-S3');
                
                // Teruskan telemetry sensor ke bus Redis
                await eventBus.publish(TOPICS.IOT.TELEMETRY, {
                    sourceAgent: 'TheCaretaker',
                    action: 'SENSOR_UPDATE',
                    payload: { topic, data: payload }
                });
            } catch (_) {
                // Ignore non-json raw ping
            }
        });

        // Dengarkan perintah dari Master Agent via Redis Pub/Sub
        await eventBus.subscribe(TOPICS.IOT.COMMAND, async (event) => {
            const { device, action, value } = event.payload || {};
            logger.info({ device, action }, 'Menerima perintah IoT dari Redis Bus.');

            if (device === 'lampu_usb') {
                // Kontrol relay / saklar daya lampu USB meja
                const state = action === 'ON' || action === 'NYALA' ? 1 : 0;
                this.publishMqtt('esp32/actuators/lamp', { power: state, timestamp: Date.now() });
            } else if (device === 'desk_display') {
                // Render teks/widget ke layar AMOLED 2.06"
                this.renderDisplay(value || {});
            }
        });

        // Dengarkan perintah render layar langsung
        await eventBus.subscribe(TOPICS.IOT.DISPLAY_RENDER, async (event) => {
            this.renderDisplay(event.payload || {});
        });

        logger.info('✅ The Caretaker aktif dan siap menjembatani hardware kamar.');
    }

    /**
     * Kirim data frame ke layar AMOLED 2.06" ESP32-S3
     * @param {Object} displayData
     * @param {string} displayData.title - Judul ringkas di status bar
     * @param {string} displayData.body - Teks utama
     * @param {string} [displayData.icon] - Ikon (heart, weather, alert, work)
     */
    renderDisplay(displayData) {
        const payload = {
            title: displayData.title || 'WAGURI AI',
            body: displayData.body || '',
            icon: displayData.icon || 'smile',
            updatedAt: new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })
        };
        this.publishMqtt('esp32/screen/render', payload);
        logger.info({ payload }, 'Frame tampilan dikirimkan ke Layar Meja AMOLED 2.06".');
    }

    publishMqtt(topic, payload) {
        if (!this.isConnected) {
            logger.warn({ topic }, 'Gagal mengirim MQTT: Broker belum terhubung.');
            return;
        }
        this.client.publish(topic, JSON.stringify(payload));
    }
}

export const caretakerAgent = new CaretakerAgent();
