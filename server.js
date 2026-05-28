const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const pino = require('pino')

const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    delay
} = require('@whiskeysockets/baileys')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// Store active pairing sessions
const sessions = new Map()

// Clean up old incomplete sessions every 5 minutes
setInterval(() => {
    const now = Date.now()
    for (const [id, session] of sessions.entries()) {
        if (now - session.createdAt > 6 * 60 * 1000 && !session.paired) {
            try { session.sock?.end?.() } catch (_) {}
            try {
                const sessionDir = path.join(__dirname, 'sessions', id)
                if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true })
                }
            } catch (_) {}
            sessions.delete(id)
        }
    }
}, 5 * 60 * 1000)

// ── GET /code?number=256XXXXXXXXX ────────────────────────────────────────────
app.get('/code', async (req, res) => {
    let number = (req.query.number || '').replace(/[^0-9]/g, '').trim()

    if (!number || number.length < 7 || number.length > 20) {
        return res.status(400).json({
            success: false,
            error: 'Invalid phone number. Include country code e.g. 256700000000'
        })
    }

    // Return cached code if it's still fresh (under 2 minutes old)
    if (sessions.has(number)) {
        const existing = sessions.get(number)
        if (existing.code && !existing.paired && (Date.now() - existing.createdAt) < 2 * 60 * 1000) {
            return res.json({ success: true, code: existing.code })
        }
        // Clean up stale session
        try { existing.sock?.end?.() } catch (_) {}
        sessions.delete(number)
    }

    const sessionDir = path.join(__dirname, 'sessions', number)
    try {
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true })
        }
    } catch (_) {}
    fs.mkdirSync(sessionDir, { recursive: true })

    let sock
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir)

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Safari'),
            generateHighQualityLinkPreview: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            mobile: false,
        })

        // FIX #1: Store BOTH the promise and the resolver separately
        let pairingResolve
        const pairingPromise = new Promise((resolve) => { pairingResolve = resolve })

        sessions.set(number, {
            sock,
            code: null,
            createdAt: Date.now(),
            paired: false,
            pairingPromise,   // ← the actual awaitable promise
            pairingResolve,   // ← the function to call when pairing completes
            sessionDir
        })

        // Save credentials whenever they update
        sock.ev.on('creds.update', saveCreds)

        // FIX #2: Only mark paired when connection is fully OPEN (not on first creds.update)
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update

            if (connection === 'open') {
                const session = sessions.get(number)
                if (session && !session.paired) {
                    session.paired = true
                    console.log(`✅ Pairing successful for ${number}`)
                    // Give baileys a moment to write creds.json fully
                    await delay(1500)
                    session.pairingResolve(true)
                    setTimeout(() => {
                        try { session.sock?.end() } catch (_) {}
                    }, 5000)
                }
            }

            if (connection === 'close') {
                const session = sessions.get(number)
                // If already paired, ignore the close (it's expected cleanup)
                if (session && session.paired) return

                const statusCode = lastDisconnect?.error?.output?.statusCode
                console.log(`[pair] Connection closed for ${number}, status: ${statusCode}`)
            }
        })

        // Wait for initial connection to WhatsApp servers
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout — WhatsApp did not respond in time'))
            }, 30000)

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update

                if (update.qr) {
                    clearTimeout(timeout)
                    resolve()
                }

                if (connection === 'open') {
                    clearTimeout(timeout)
                    resolve()
                }

                if (connection === 'close') {
                    clearTimeout(timeout)
                    const statusCode = lastDisconnect?.error?.output?.statusCode
                    reject(new Error(`Connection closed (status: ${statusCode || 'unknown'})`))
                }
            })
        })

        await delay(500)

        if (sock.authState.creds.registered) {
            sessions.delete(number)
            try { sock?.end() } catch (_) {}
            return res.status(400).json({
                success: false,
                error: 'This number already has an active WhatsApp session linked. Unlink it first in WhatsApp → Linked Devices.'
            })
        }

        const code = await sock.requestPairingCode(number)
        if (!code) {
            throw new Error('WhatsApp returned empty pairing code')
        }

        const formatted = code.match(/.{1,4}/g)?.join('-') || code

        const session = sessions.get(number)
        if (session) session.code = formatted

        // Auto-cleanup after 5 minutes if not paired
        setTimeout(() => {
            const sess = sessions.get(number)
            if (sess && !sess.paired) {
                console.log(`⏰ Pairing timeout for ${number}, cleaning up`)
                try { sess.sock?.end() } catch (_) {}
                try {
                    if (fs.existsSync(sess.sessionDir)) {
                        fs.rmSync(sess.sessionDir, { recursive: true, force: true })
                    }
                } catch (_) {}
                sessions.delete(number)
            }
        }, 5 * 60 * 1000)

        return res.json({ success: true, code: formatted })

    } catch (err) {
        console.error('[pair] Error for', number, ':', err.message)
        try { sock?.end() } catch (_) {}
        try {
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true })
            }
        } catch (_) {}
        sessions.delete(number)

        let userError = 'Failed to generate pairing code. Try again.'
        if (err.message.includes('timeout')) {
            userError = 'Connection timed out. WhatsApp servers may be busy — try again in 30 seconds.'
        } else if (err.message.includes('closed')) {
            userError = 'Connection was rejected by WhatsApp. Check your number and try again.'
        } else if (err.message.includes('empty')) {
            userError = 'WhatsApp did not return a code. Try again.'
        }

        return res.status(500).json({ success: false, error: userError })
    }
})

// ── GET /session?number=256XXXXXXXXX ────────────────────────────────────────────
app.get('/session', async (req, res) => {
    const number = (req.query.number || '').replace(/[^0-9]/g, '').trim()
    if (!number) {
        return res.status(400).json({ success: false, error: 'Number required' })
    }

    const session = sessions.get(number)
    if (!session) {
        return res.status(404).json({
            success: false,
            error: 'No active session. Request a pairing code first using /code?number=...'
        })
    }

    if (!session.paired) {
        try {
            // FIX #1 (cont): await the pairingPromise, NOT pairingResolve (which is just a function)
            await Promise.race([
                session.pairingPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 90000))
            ])
        } catch (err) {
            return res.status(408).json({
                success: false,
                error: 'Pairing not completed yet. Please enter the code on your phone first, then try again.'
            })
        }
    }

    // Wait a brief moment to ensure creds.json is fully written
    await delay(500)

    const credsPath = path.join(session.sessionDir, 'creds.json')
    if (!fs.existsSync(credsPath)) {
        return res.status(404).json({
            success: false,
            error: 'Session credentials not found. Pairing may have failed — please try again.'
        })
    }

    try {
        const creds = fs.readFileSync(credsPath, 'utf8')
        const encoded = Buffer.from(creds).toString('base64')
        const sessionId = `IANENIGMA;;;${encoded}`
        return res.json({ success: true, sessionId })
    } catch (err) {
        return res.status(500).json({ success: false, error: 'Failed to read session.' })
    }
})

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        bot: 'IANENIGMA MD BOT',
        sessions: sessions.size,
        uptime: Math.floor(process.uptime()) + 's'
    })
})

// ── Serve frontend ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
    console.log(`🦇 IANENIGMA Pair Server running on port ${PORT}`)
})
