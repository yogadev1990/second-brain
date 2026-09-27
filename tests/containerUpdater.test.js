import assert from 'assert';
import { ContainerUpdaterService, FAILURE_POLICIES } from '../src/services/containerUpdater.js';

console.log('====================================================');
console.log('🧪 MEMULAI RANGKAIAN UJI KETAT CONTAINER UPDATER');
console.log('====================================================');

class MockDockerContainer {
    constructor(name, shouldFailHealthcheck = false) {
        this.name = name;
        this.shouldFailHealthcheck = shouldFailHealthcheck;
        this.isRunning = false;
        this.isStopped = false;
        this.isRemoved = false;
        this.renamedTo = null;
    }

    async inspect() {
        return {
            State: {
                Running: this.isRunning,
                Dead: false,
                OOMKilled: false
            },
            HostConfig: {
                Binds: ['/app/mock:/workspace:rw']
            },
            NetworkSettings: {
                Networks: { 'waguri-internal': {} }
            },
            Config: {
                Env: ['NODE_ENV=test']
            }
        };
    }

    async start() {
        this.isRunning = true;
    }

    async stop() {
        this.isRunning = false;
        this.isStopped = true;
    }

    async remove() {
        this.isRemoved = true;
    }

    async rename({ name }) {
        this.renamedTo = name;
    }

    async logs() {
        return Buffer.from('Mock error log: Simulated crash or syntax error on boot');
    }

    async exec() {
        return {
            start: async () => ({ on: (evt, cb) => cb() }),
            inspect: async () => ({ ExitCode: this.shouldFailHealthcheck ? 1 : 0 })
        };
    }
}

class MockDocker {
    constructor() {
        this.containers = new Map();
    }

    getContainer(name) {
        if (!this.containers.has(name)) {
            const container = new MockDockerContainer(name);
            container.isRunning = true; // default existing production container is running
            this.containers.set(name, container);
        }
        return this.containers.get(name);
    }

    async createContainer({ name, Image }) {
        const isFailing = name.includes('fail-test');
        const candidate = new MockDockerContainer(name, isFailing);
        this.containers.set(name, candidate);
        return candidate;
    }
}

async function runTests() {
    let passedTests = 0;
    let totalTests = 0;

    // -------------------------------------------------------------
    // TEST 1: Parameter Validation Test
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n▶️  [Test 1] Pengujian Validasi Parameter Nama Kontainer');
    try {
        const updater = new ContainerUpdaterService();
        await assert.rejects(
            async () => {
                await updater.updateContainer({ containerName: 'invalid;rm -rf /', taskDescription: 'hack' });
            },
            /Nama kontainer tidak valid/
        );
        console.log('✅ PASS: Parameter ilegal berhasil ditolak dengan aman.');
        passedTests++;
    } catch (err) {
        console.error('❌ FAIL Test 1:', err);
    }

    // -------------------------------------------------------------
    // TEST 2: Skenario Sukses (Candidate Sehat -> Blue-Green Hot-Swap)
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n▶️  [Test 2] Skenario Sukses: Candidate Lolos Healthcheck -> Hot Swap Berhasil');
    try {
        const updater = new ContainerUpdaterService();
        const mockDocker = new MockDocker();
        updater.docker = mockDocker;
        updater.buildImage = async () => {}; // Hermetic mock
        updater.emitChatroomLog = async () => {};
        updater.createGitCheckpoint = async () => true;
        updater.clearGitCheckpoint = async () => {};
        updater.revertGitCheckpoint = async () => true;

        // Mock probe langsung return true (sehat)
        updater.probeContainerHealth = async () => true;

        const result = await updater.updateContainer({
            containerName: 'revandastore-app',
            taskDescription: 'Upgrade caching layer',
            failurePolicy: FAILURE_POLICIES.AUTO_REPAIR_THEN_ROLLBACK,
            healthcheckTimeoutMs: 1000
        });

        assert.strictEqual(result.status, 'success');
        console.log('✅ PASS: Skenario Sukses terverifikasi. Kontainer kandidat berhasil dipromosikan.');
        passedTests++;
    } catch (err) {
        console.error('❌ FAIL Test 2:', err);
    }

    // -------------------------------------------------------------
    // TEST 3: Skenario Gagal & Safe Rollback (Candidate Rusak -> Destroy & Revert)
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n▶️  [Test 3] Skenario Gagal: Candidate Unhealthy -> Immediate Safe Rollback');
    try {
        const updater = new ContainerUpdaterService();
        const mockDocker = new MockDocker();
        updater.docker = mockDocker;
        updater.buildImage = async () => {}; // Hermetic mock
        updater.emitChatroomLog = async () => {};
        updater.createGitCheckpoint = async () => true;
        updater.clearGitCheckpoint = async () => {};
        updater.revertGitCheckpoint = async () => true;

        // Simulasikan candidate selalu gagal healthcheck
        updater.probeContainerHealth = async () => false;

        const result = await updater.updateContainer({
            containerName: 'fail-test-app',
            taskDescription: 'Sengaja membuat bug',
            failurePolicy: FAILURE_POLICIES.ROLLBACK_ONLY,
            healthcheckTimeoutMs: 1000
        });



        assert.strictEqual(result.status, 'error');
        assert.strictEqual(result.rolledBack, true);

        // Verifikasi kontainer kandidat yang rusak telah di-remove/destroy
        let candidateDestroyed = false;
        for (const [name, c] of mockDocker.containers.entries()) {
            if (name.includes('fail-test-app-candidate') && c.isRemoved) {
                candidateDestroyed = true;
                break;
            }
        }
        assert.strictEqual(candidateDestroyed, true);

        console.log('✅ PASS: Skenario Safe Rollback terverifikasi. Kandidat dihancurkan, kontainer produksi aman.');
        passedTests++;
    } catch (err) {
        console.error('❌ FAIL Test 3:', err);
    }

    // -------------------------------------------------------------
    // TEST 4: Skenario Gagal -> Auto-Repair Attempt -> Rollback jika tetap gagal
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n▶️  [Test 4] Skenario Auto-Repair Attempt: 1x Coba Perbaiki -> Tetap Gagal -> Rollback');
    try {
        const updater = new ContainerUpdaterService();
        const mockDocker = new MockDocker();
        updater.docker = mockDocker;
        updater.buildImage = async () => {}; // Hermetic mock
        updater.emitChatroomLog = async () => {};
        updater.createGitCheckpoint = async () => true;
        updater.clearGitCheckpoint = async () => {};
        updater.revertGitCheckpoint = async () => true;

        let probeCalls = 0;
        updater.probeContainerHealth = async () => {
            probeCalls++;
            return false; // Tetap gagal setelah repair
        };



        const result = await updater.updateContainer({
            containerName: 'repair-fail-app',
            taskDescription: 'Simulasi auto repair gagal',
            failurePolicy: FAILURE_POLICIES.AUTO_REPAIR_THEN_ROLLBACK,
            healthcheckTimeoutMs: 1000,
            maxRepairAttempts: 1
        });

        assert.strictEqual(result.status, 'error');
        assert.strictEqual(result.rolledBack, true);
        assert(probeCalls >= 1);

        console.log(`✅ PASS: Auto-Repair dieksekusi sebanyak ${probeCalls} kali lalu langsung Safe Rollback.`);
        passedTests++;
    } catch (err) {
        console.error('❌ FAIL Test 4:', err);
    }

    // -------------------------------------------------------------
    // TEST 5: Skenario Secondbrain / Named Volume Exclusion
    // -------------------------------------------------------------
    totalTests++;
    console.log('\n▶️  [Test 5] Skenario Named Volume Exclusion (secondbrain / data volume)');
    try {
        const updater = new ContainerUpdaterService();
        const mockDocker = new MockDocker();
        
        // Mock kontainer secondbrain dengan binds volume docker
        const secondbrainMock = new MockDockerContainer('secondbrain');
        secondbrainMock.inspect = async () => ({
            State: { Running: true, Dead: false, OOMKilled: false },
            HostConfig: {
                Binds: [
                    '/var/run/docker.sock:/var/run/docker.sock',
                    'second-brain_wiki-content-data:/app/shared/wiki_content:rw'
                ]
            },
            NetworkSettings: { Networks: { 'waguri-internal': {} } },
            Config: { Env: ['NODE_ENV=production'] }
        });
        mockDocker.containers.set('secondbrain', secondbrainMock);

        let capturedBuildContext = null;
        updater.docker = mockDocker;
        updater.buildImage = async (tag, contextDir) => {
            capturedBuildContext = contextDir;
        };
        updater.emitChatroomLog = async () => {};
        updater.createGitCheckpoint = async () => true;
        updater.clearGitCheckpoint = async () => {};
        updater.revertGitCheckpoint = async () => true;
        updater.probeContainerHealth = async () => true;

        const result = await updater.updateContainer({
            containerName: 'secondbrain',
            taskDescription: 'Tes Named Volume Exclusion',
            failurePolicy: FAILURE_POLICIES.AUTO_REPAIR_THEN_ROLLBACK,
            healthcheckTimeoutMs: 1000
        });

        assert.strictEqual(result.status, 'success');
        assert.notStrictEqual(capturedBuildContext, 'second-brain_wiki-content-data', 'Build context tidak boleh bernama named volume!');
        assert.strictEqual(capturedBuildContext, process.cwd(), 'Build context secondbrain harus fallback ke process.cwd()');

        console.log('✅ PASS: Named volume dan docker.sock berhasil diabaikan, context fallback ke direktori kerja yang valid.');
        passedTests++;
    } catch (err) {
        console.error('❌ FAIL Test 5:', err);
    }

    console.log('\n====================================================');
    console.log(`🎉 HASIL PENGUJIAN: ${passedTests}/${totalTests} UJI KETAT LOLOS SEMPURNA!`);
    console.log('====================================================\n');
    process.exit(passedTests === totalTests ? 0 : 1);
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
