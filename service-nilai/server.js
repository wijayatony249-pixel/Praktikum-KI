require('dotenv').config();
const express = require('express');
const { verifyGatewayAndToken } = require('./middleware');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT_NILAI || 3001;

app.use(express.json());

// Logging setiap request yang masuk ke Service Nilai
app.use((req, res, next) => {
    console.log(`[SERVICE NILAI] ${req.method} ${req.url} | Gateway Secret Present: ${Boolean(req.headers['x-gateway-secret'])}`);
    next();
});

// Verifikasi ganda: Gateway Secret + Token JWT (Prinsip Assume Breach / Defense in Depth)
app.use(verifyGatewayAndToken);

// Mount routing Nilai & Kelas
app.use('/', routes);

app.listen(PORT, () => {
    console.log(`[SERVICE NILAI] Berjalan di port ${PORT} (Resource Service: Nilai & Kelas)`);
});

