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

## Deploying from GitHub

The Worker can be connected to this repo in the Cloudflare dashboard (pts-presence → Settings →
Build → Connect; deploy command `npx wrangler deploy`, root directory `worker/presence`). Then every
push to `main` deploys it, and `npx wrangler deploy` by hand isn't needed.

## Dev page password (once, about 2 minutes)

`dev.html` asks for a password, and this Worker checks it (`/dev/login`, `src/devauth.js`), so the
password is never in the repo or the page. The dev tools only load after the Worker accepts it.

1. In this folder:
   ```
   npx wrangler secret put DEV_PASSWORD
   ```
   and type the password you want. Then `npx wrangler deploy`.
2. Open dev.html and sign in. **Password** (top right) changes it from the page; that signs out
   every other device. **Lock** signs out this one.

Forgot it? Run `npx wrangler secret put DEV_PASSWORD` again: a new secret replaces a password
changed on the page. After 10 wrong passwords in 15 minutes, logins pause until the oldest wrong
try is 15 minutes old (counted site-wide; nothing about who tried is kept). Sessions last 12 hours,
or 30 days with "Keep me signed in". For local testing, put `DEV_PASSWORD=...` in `.dev.vars`
(gitignored) and run `npx wrangler dev`.

## Cost

Each open copy of the site holds one WebSocket. Idle connections hibernate and the 30-second
keep-alive is answered by Cloudflare without waking the Worker, so a few dozen people at a
time is far inside the free plan's daily limits.
