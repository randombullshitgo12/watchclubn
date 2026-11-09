# Olfrens Watch Club

One screen. This week's pick, up next, and your friends.

We pick one movie a week, watch it separately at our own pace, and talk it over on Sunday.

- Sign in with your name + the club password (no Google)
- Add titles to your list, check them off when finished
- Finished titles drop out — the group's next-shared title becomes the pick
- Tap a friend to see their list

## Run it

```bash
npm install
npm start
# http://localhost:3000
```

Demo: name `maya`, password `crew123`. Log in as `owner` to add more names (bottom of the home screen).

Set `SHARED_PASSWORD=...` and `OWNER_NAME=owner` before sharing. Keep the password to yourselves.

## Deploying with Vercel

For the quickest share link, run `server.js` on Render / Railway / Fly (one service). To use Vercel, host `public/` there and the Node server elsewhere, or split the API into Vercel Functions + a real DB (KV/Supabase) since Vercel's filesystem isn't persistent.

Files: `server.js` (API), `public/` (site), `data/db.json` (local lists — back it up).
