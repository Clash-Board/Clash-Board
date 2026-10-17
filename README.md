# Clash Board

## Way 1 — easy (VS Code Live Server, or double-click index.html)
Everything is saved **in your browser**: accounts, chat, videos and photos (videos use the browser's file storage, not the small settings storage, so they are not lost).
Always open the game from the **same address** — a different address (for example file:// vs http://127.0.0.1:5500) is a different storage.
Settings > Download backup / Restore backup keeps a copy of everything.

## Way 2 — with the game server (recommended)
Saves everything on disk and lets everyone who connects share it: accounts, other people's videos and comments, direct messages, servers, invite links, friend requests.
1. Install Node.js
2. In this folder run:  `npm install`  then  `node server.js`
3. Open http://localhost:3000  (the window prints a "Same Wi-Fi" address too)

Your data is in the `data` folder (db.json, auth.json, media/). Copy that folder to back it up. Passwords stay on the server only.
Voice calls need http://localhost or https. If two people change something at the exact same instant, one change can be lost.

## Files
index.html, style.css, app.js (everything), board3d.js (3D board and characters), lib/ (Three.js), server.js (optional server)
Three.js is MIT licensed.
