const fs = require('fs');
const axios = require('axios');
const express = require('express');
const bonjour = require('bonjour')(); // CORRECT: Import and initialize the 'bonjour' package
const cors = require('cors');
const app = express();
const port = 3000;

const bindip = "127.0.0.1";
let dirigeraip; // Will be set by Bonjour discovery
let token;

// --- Token Reading ---
try {
    token = fs.readFileSync('token.txt', 'utf8').trim();
    console.log("Successfully read token.");
} catch (error) {
    console.error("FATAL: Could not read token.txt. Please make sure the file exists in the same directory.");
    process.exit(1);
}

////////////////////////////////////////////////////////////////////////////////////

// --- Bonjour Service Discovery (with the 'bonjour' package) ---
async function bonjourLookup() {
    return new Promise((resolve, reject) => {
        console.log("Looking for DIRIGERA device via Bonjour/mDNS...");
        const browser = bonjour.find({ type: 'ihsp', protocol: 'tcp' });
        
        const timeout = setTimeout(() => {
            browser.stop();
            bonjour.destroy();
            reject(new Error("Dirigera discovery timed out after 30 seconds."));
        }, 30000);

        browser.on('up', (service) => {
            clearTimeout(timeout);
            console.log("Found DIRIGERA device at:", service.addresses[0]);
            resolve(service.addresses[0]);
            browser.stop();
            bonjour.destroy();
        });
    });
}

// --- API Functions (Unchanged) ---
const apiClient = axios.create({
    baseURL: `https://dummy:8443/v1`,
    headers: { 'Authorization': `Bearer ${token}` },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
});

async function getDevices() {
    const response = await apiClient.get('/devices');
    return response.data;
}

async function patchDevice(deviceId, attributes) {
    const payload = [{ "attributes": attributes }];
    const response = await apiClient.patch(`/devices/${deviceId}`, payload);
    return response.data;
}

// --- Express App Setup (Unchanged) ---
app.use(express.static('public'));
app.use(express.json());
app.use(cors({ origin: '*' }));

// --- API Endpoints (Unchanged) ---
app.get('/devices', (req, res) => {
    getDevices()
        .then(data => res.json(data))
        .catch(error => {
            console.error(error);
            res.status(500).send("Error fetching devices");
        });
});

app.patch('/devices/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const attributes = req.body.attributes;

    if (!attributes || Object.keys(attributes).length === 0) {
        return res.status(400).send("Bad Request: 'attributes' payload is missing or empty.");
    }

    console.log(`PATCHing device ${deviceId} with attributes:`, attributes);

    patchDevice(deviceId, attributes)
        .then(() => res.status(204).send())
        .catch(error => {
            console.error(error.response ? error.response.data : error.message);
            res.status(500).send("Error updating device");
        });
});

// --- Server Start (Unchanged) ---
async function startServer() {
    try {
        dirigeraip = await bonjourLookup();
        apiClient.defaults.baseURL = `https://${dirigeraip}:8443/v1`;

        app.listen(port, bindip, () => {
            console.log(`IKEA Dirigera Proxy Server running on ${bindip}:${port}`);
            console.log(`Proxying requests to Dirigera hub at ${dirigeraip}`);
        });
    } catch (error) {
        console.error("Could not discover Dirigera hub. Please ensure it's on the same network.", error);
        process.exit(1);
    }
}

startServer();
