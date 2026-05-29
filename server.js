const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const pino = require('pino')

const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    delay
} = require('@whiskeysockets/baileys')

const app = express()
const PORT = process.env.PORT || 3000

// Extend Render's default timeout — keep connections alive
app.use((req, res, next) => {
    res.setTimeout(0) // disable express timeout
    req.setTimeout(0)
    next()
})

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// Keep-alive ping so Render doesn't sleep mid-pairing
setInterval(() => {}, 1000 * 60 * 4)

const sessions = new Map()

// Clean up stale sessions every 5 minutes
setInterval(() => {
    const now = Date.now()
    for (const [id, session] of sessions.entries()) {
        if (now - session.createdAt > 8 * 60 * 1000 && !session.paired) {
            try { session.sock?.end?.() } catch (_) {}
            try {
                if (fs.existsSync(session.sessionDir))
                    fs.rmSync(session.sessionDir, { recursive: true, force: true })
            } catch (_) {}
            sessions.delete(id)
        }
    }
}, 5 * 60 * 1000)

// ── GET /code ────────────────────────────────────────────────────────────────
app.get('/code', async (req, res) => {
    let number = (req.query.number || '').replace(/[^0-9]/g, '').trim()

    if (!number || number.length < 7 || number.length > 20) {
        return res.status(400).json({ success: false, error: 'Invalid phone number. Include country code e.g. 256700000000' })
    }

    // Return cached code if fresh
    if (sessions.has(number)) {
        const existing = sessions.get(number)
        if (existing.code && !existing.paired && (Date.now() - existing.createdAt) < 3 * 60 * 1000) {
            return res.json({ success: true, code: existing.code })
        }
        try { existing.sock?.end?.() } catch (_) {}
        try {
            if (fs.existsSync(existing.sessionDir))
                fs.rmSync(existing.sessionDir, { recursive: true, force: true })
        } catch (_) {}
        sessions.delete(number)
    }

    const sessionDir = path.join(__dirname, 'sessions', number)
    try {
        if (fs.existsSync(sessionDir))
            fs.rmSync(sessionDir, { recursive: true, force: true })
    } catch (_) {}
    fs.mkdirSync(sessionDir, { recursive: true })

    let sock
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir)

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            // Raw browser fingerprint — avoids WhatsApp blocking Browsers.* helpers
            browser: ['IANENIGMA-MD', 'Chrome', '120.0.0'],
            generateHighQualityLinkPreview: false,
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: 120000,
            keepAliveIntervalMs: 15000,  // ping WhatsApp every 15s to keep socket alive
            retryRequestDelayMs: 2000,
            mobile: false,
            syncFullHistory: false,
        })

        let pairingResolve
        const pairingPromise = new Promise((resolve) => { pairingResolve = resolve })

        sessions.set(number, {
            sock,
            code: null,
            createdAt: Date.now(),
            paired: false,
            pairingPromise,
            pairingResolve,
            sessionDir
        })

        sock.ev.on('creds.update', saveCreds)

        // Mark paired ONLY when connection is truly open
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update

            if (connection === 'open') {
                const session = sessions.get(number)
                if (session && !session.paired) {
                    session.paired = true
                    console.log(`✅ Paired: ${number}`)
                    await delay(2000) // wait for creds.json to be fully written
                    session.pairingResolve(true)
                    // Close socket cleanly after a few seconds
                    setTimeout(() => {
                        try { session.sock?.end() } catch (_) {}
                    }, 8000)
                }
            }

            if (connection === 'close') {
                const session = sessions.get(number)
                if (session?.paired) return // expected close after pairing

                const statusCode = lastDisconnect?.error?.output?.statusCode
                const reason = DisconnectReason
                console.log(`[pair] Closed for ${number} — code: ${statusCode}`)

                // 401 = logged out, 403 = banned, 515 = restart required
                if (statusCode === 515) {
                    // WhatsApp asking us to restart — reconnect automatically
                    console.log(`[pair] Restart requested for ${number}, reconnecting...`)
                }
            }
        })

        // Wait for socket to connect to WhatsApp servers
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout — WhatsApp did not respond'))
            }, 40000)

            const handler = (update) => {
                if (update.qr || update.connection === 'open') {
                    clearTimeout(timeout)
                    sock.ev.off('connection.update', handler)
                    resolve()
                }
                if (update.connection === 'close') {
                    clearTimeout(timeout)
                    sock.ev.off('connection.update', handler)
                    const code = update.lastDisconnect?.error?.output?.statusCode
                    reject(new Error(`Connection closed (${code || 'unknown'})`))
                }
            }
            sock.ev.on('connection.update', handler)
        })

        await delay(800)

        if (sock.authState.creds.registered) {
            sessions.delete(number)
            try { sock?.end() } catch (_) {}
            return res.status(400).json({
                success: false,
                error: 'Number already linked. Go to WhatsApp → Linked Devices and remove the old session first.'
            })
        }

        // Request pairing code from WhatsApp
        const code = await sock.requestPairingCode(number)
        if (!code) throw new Error('WhatsApp returned empty pairing code')

        const formatted = code.match(/.{1,4}/g)?.join('-') || code
        const session = sessions.get(number)
        if (session) session.code = formatted

        console.log(`📱 Code for ${number}: ${formatted}`)

        // Auto-cleanup after 6 minutes if not paired
        setTimeout(() => {
            const sess = sessions.get(number)
            if (sess && !sess.paired) {
                console.log(`⏰ Timeout cleanup for ${number}`)
                try { sess.sock?.end() } catch (_) {}
                try {
                    if (fs.existsSync(sess.sessionDir))
                        fs.rmSync(sess.sessionDir, { recursive: true, force: true })
                } catch (_) {}
                sessions.delete(number)
            }
        }, 6 * 60 * 1000)

        return res.json({ success: true, code: formatted })

    } catch (err) {
        console.error(`[pair] Error for ${number}:`, err.message)
        try { sock?.end() } catch (_) {}
        try {
            if (fs.existsSync(sessionDir))
                fs.rmSync(sessionDir, { recursive: true, force: true })
        } catch (_) {}
        sessions.delete(number)

        let userError = 'Failed to generate pairing code. Try again.'
        if (err.message.includes('timeout'))
            userError = 'Connection timed out. Try again in 30 seconds.'
        else if (err.message.includes('closed') || err.message.includes('403'))
            userError = 'WhatsApp rejected the connection. Make sure your number is active and try again.'
        else if (err.message.includes('401'))
            userError = 'Unauthorized. Your number may be banned from linking devices.'

        return res.status(500).json({ success: false, error: userError })
    }
})

// ── GET /session ─────────────────────────────────────────────────────────────
app.get('/session', async (req, res) => {
    const number = (req.query.number || '').replace(/[^0-9]/g, '').trim()
    if (!number) return res.status(400).json({ success: false, error: 'Number required' })

    const session = sessions.get(number)
    if (!session) {
        return res.status(404).json({
            success: false,
            error: 'No active session found. Request a code first.'
        })
    }

    if (!session.paired) {
        try {
            await Promise.race([
                session.pairingPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 120000))
            ])
        } catch (_) {
            return res.status(408).json({
                success: false,
                error: 'Pairing timed out. Make sure you entered the code in WhatsApp within 5 minutes, then try again.'
            })
        }
    }

    await delay(1000)

    const credsPath = path.join(session.sessionDir, 'creds.json')
    if (!fs.existsSync(credsPath)) {
        return res.status(404).json({ success: false, error: 'Credentials not found. Please pair again.' })
    }

    try {
        const creds = fs.readFileSync(credsPath, 'utf8')
        const encoded = Buffer.from(creds).toString('base64')
        return res.json({ success: true, sessionId: `IANENIGMA;;;${encoded}` })
    } catch (_) {
        return res.status(500).json({ success: false, error: 'Failed to read session.' })
    }
})

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'online', bot: 'IANENIGMA MD', sessions: sessions.size, uptime: Math.floor(process.uptime()) + 's' })
})

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

const server = app.listen(PORT, () => {
    console.log(`🦇 IANENIGMA Pair Server on port ${PORT}`)
})

// Critical: disable Node's built-in socket timeout so Render doesn't cut connections
server.keepAliveTimeout = 0
server.headersTimeout = 0
server.timeout = 0
