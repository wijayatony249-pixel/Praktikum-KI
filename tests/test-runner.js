const { spawn } = require('child_process');
const path = require('path');

console.log('[TEST RUNNER] Menyalakan Gateway (3000), Service Nilai (3001), dan Service Transkrip (3002)...');

const gatewayProc = spawn('node', [path.join(__dirname, '..', 'gateway', 'server.js')], { stdio: 'pipe' });
const nilaiProc = spawn('node', [path.join(__dirname, '..', 'service-nilai', 'server.js')], { stdio: 'pipe' });
const transkripProc = spawn('node', [path.join(__dirname, '..', 'service-transkrip', 'server.js')], { stdio: 'pipe' });

gatewayProc.stdout.on('data', d => process.stdout.write(`[GW] ${d}`));
gatewayProc.stderr.on('data', d => process.stderr.write(`[GW ERR] ${d}`));
nilaiProc.stdout.on('data', d => process.stdout.write(`[NILAI] ${d}`));
nilaiProc.stderr.on('data', d => process.stderr.write(`[NILAI ERR] ${d}`));
transkripProc.stdout.on('data', d => process.stdout.write(`[TRANS] ${d}`));
transkripProc.stderr.on('data', d => process.stderr.write(`[TRANS ERR] ${d}`));

function terminateAll() {
    gatewayProc.kill();
    nilaiProc.kill();
    transkripProc.kill();
}

// Tunggu 2 detik hingga semua service online
setTimeout(() => {
    console.log('[TEST RUNNER] Semua service online. Memulai eksekusi tes...\n');
    const testProc = spawn('node', [path.join(__dirname, 'run-tests.js')], { stdio: 'inherit' });

    testProc.on('exit', (code) => {
        terminateAll();
        console.log(`[TEST RUNNER] Selesai dengan kode: ${code}`);
        process.exit(code);
    });
}, 2500);

process.on('SIGINT', terminateAll);
process.on('SIGTERM', terminateAll);
