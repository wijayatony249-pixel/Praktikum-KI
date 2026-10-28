const { fork } = require('child_process');
const path = require('path');

console.log('================================================================');
console.log('  MEMULAI SISTEM NILAI ZERO TRUST (NIST SP 800-207)');
console.log('  Keamanan Informasi - Universitas Siliwangi');
console.log('================================================================\n');

const services = [
    { name: 'GATEWAY    ', script: path.join(__dirname, 'gateway', 'server.js'), port: 3000 },
    { name: 'NILAI      ', script: path.join(__dirname, 'service-nilai', 'server.js'), port: 3001 },
    { name: 'TRANSKRIP  ', script: path.join(__dirname, 'service-transkrip', 'server.js'), port: 3002 },
];

const processes = [];

services.forEach((srv) => {
    const child = fork(srv.script, [], {
        stdio: ['inherit', 'pipe', 'pipe', 'ipc']
    });

    child.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) console.log(`[${srv.name}] ${line}`);
        });
    });

    child.stderr.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) console.error(`[${srv.name} ERR] ${line}`);
        });
    });

    child.on('exit', (code) => {
        console.log(`[${srv.name}] Proses berhenti dengan kode: ${code}`);
    });

    processes.push(child);
});

// Tangani Ctrl+C (SIGINT) dan SIGTERM untuk mematikan semua sub-proses secara bersih
function cleanup() {
    console.log('\n[RUNNER] Menghentikan seluruh service...');
    processes.forEach(p => p.kill());
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

