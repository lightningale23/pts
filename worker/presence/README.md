# pts presence worker

Counts how many people have the site open right now, for the "online" badge in the top bar.
It runs on Cloudflare Workers' free plan (a Worker plus one Durable Object).

## Deploy (once, about 10 minutes)

1. Make a free Cloudflare account at dash.cloudflare.com.
2. On a computer with Node.js, open a terminal in this folder (`worker/presence`) and run:
   ```
   npx wrangler login
   npx wrangler deploy
   ```
   The first command opens a browser to sign in. The second prints the Worker's address,
   like `https://pts-presence.YOURNAME.workers.dev`.
3. In `js/config.js`, set `presenceUrl` to that address with `/online` on the end, using
   `wss://` instead of `https://`:
   ```
   presenceUrl: 'wss://pts-presence.YOURNAME.workers.dev/online',
   ```
4. Push. The badge appears in the top bar once the site connects.

If the site moves to another address, add it to `ALLOWED_ORIGINS` in `wrangler.toml` and
deploy again.

## Cost

Each open copy of the site holds one WebSocket. Idle connections hibernate and the 30-second
keep-alive is answered by Cloudflare without waking the Worker, so a few dozen people at a
time is far inside the free plan's daily limits.
