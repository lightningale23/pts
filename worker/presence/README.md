# pts presence worker

Counts how many people have the site open right now, for the "online" badge in the top bar,
and turns question reports from the site's **Report** button into GitHub issues.
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

## Question reports (once, about 5 minutes)

The site's Report button posts to `/report` on this Worker (`reportApi` in `js/config.js`), which
opens a GitHub issue labeled `question-report` (or comments on the open one for that question).
It needs a GitHub token, kept as a Worker secret, never in the repo:

1. On GitHub: Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
   → Generate new token. Repository access: **Only select repositories → pts**. Permissions →
   Repository permissions → **Issues: Read and write** (nothing else). Pick a long expiration.
2. In this folder:
   ```
   npx wrangler secret put GITHUB_TOKEN
   ```
   and paste the token when asked. Then `npx wrangler deploy`.

Until this is done (or after the token expires), the Report form says it couldn't send and offers
to open the issue on GitHub instead. At most 40 reports an hour (200 a day) are accepted
site-wide; nothing about who sent a report is stored. Another repo: set `REPORT_REPO` under
`[vars]` in `wrangler.toml`.

## Cost

Each open copy of the site holds one WebSocket. Idle connections hibernate and the 30-second
keep-alive is answered by Cloudflare without waking the Worker, so a few dozen people at a
time is far inside the free plan's daily limits.
