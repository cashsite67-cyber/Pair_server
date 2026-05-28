<div align="center">

# 🦇 IANENIGMA MD BOT
### *Pairing Server*

```
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
         𝙄𝘼𝙉 𝙀𝙉𝙄𝙂𝙈𝘼 𝙀𝙈𝙋𝙄𝙍𝙀
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
```

> *"I am vengeance. I am the night. I am IANENIGMA MD BOT."*

![Version](https://img.shields.io/badge/VERSION-1.0.0-yellow?style=for-the-badge&logo=batman)
![Platform](https://img.shields.io/badge/PLATFORM-NODE.JS-green?style=for-the-badge)
![Made In](https://img.shields.io/badge/MADE%20IN-UGANDA%20🇺🇬-red?style=for-the-badge)
![Empire](https://img.shields.io/badge/IAN%20ENIGMA-EMPIRE-black?style=for-the-badge)

</div>

---

## 🦇 WHAT IS THIS?

This is the **official pairing server** for **IANENIGMA MD BOT** — a powerful WhatsApp bot built from scratch by **IAN ENIGMA** under the **IAN ENIGMA EMPIRE** brand, proudly made in **Uganda 🇺🇬**.

This server allows anyone to pair their WhatsApp number and get a SESSION_ID to deploy their own instance of the bot — completely free.

---

## ⚡ FEATURES

```
▸ Beautiful Batman themed pairing website
▸ Instant pairing code generation
▸ Auto session cleanup after pairing
▸ Health check endpoint
▸ Rate limiting per number
▸ Works on any free hosting platform
▸ Built with @whiskeysockets/baileys v7
```

---

## 🚀 DEPLOY YOUR OWN (FREE)

### Step 1 — Fork this repo
Click the **Fork** button at the top right of this page

### Step 2 — Deploy on Render
1. Go to [render.com](https://render.com) and sign up free with GitHub
2. Click **New → Web Service**
3. Connect this repo
4. Set the following:

| Setting | Value |
|---|---|
| Build Command | `npm install` |
| Start Command | `npm start` |
| Environment | `Node` |

5. Click **Deploy** and wait ~3 minutes
6. You get a free URL: `https://your-name.onrender.com`

---

## 📡 API ENDPOINTS

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Beautiful pairing website |
| `/code?number=256XXXXXXX` | GET | Generate pairing code |
| `/health` | GET | Server status & uptime |

---

## 🔗 CONNECT TO YOUR BOT

In your bot's `commands/pair.js` replace the old URL with yours:

```js
// OLD (someone else's server)
const response = await axios.get(`https://knight-bot-paircode.onrender.com/code?number=${number}`)

// NEW (your own server 🦇)
const response = await axios.get(`https://your-render-url.onrender.com/code?number=${number}`)
```

---

## 🦇 ABOUT IANENIGMA MD BOT

```
┌──⌈ IANENIGMA MD BOT ⌋──────────────────────────
│ 🦇 Name      : IANENIGMA MD BOT
│ 👑 Developer : IAN ENIGMA  
│ 🌍 Country   : Uganda 🇺🇬
│ 🏢 Brand     : IAN ENIGMA EMPIRE
│ ⚡ Commands  : 135+
│ 🎨 Themes    : 10 DC Superhero themes
│ 🛡️ Anti-Ban  : 9 measures built in
│ 📦 Version   : v1.0.0
└─────────────────────────────────────────────────
```

---

## ⚠️ DISCLAIMER

This project is for **educational purposes only**. Use responsibly. The **IAN ENIGMA EMPIRE** is not responsible for any misuse of this software. WhatsApp is a trademark of Meta Platforms Inc.

---

<div align="center">

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    🦇 IAN ENIGMA EMPIRE · UGANDA 🇺🇬 · 2025
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Built with 🖤 by IAN ENIGMA**

*"Gotham needs a hero. Your groups need a bot."*

</div>
