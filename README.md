# trek-website

Landing page for [Trek](../trek). Plain static HTML/CSS/JS, no build step.

```sh
python3 -m http.server 4321   # then open http://localhost:4321
```

- `index.html`: the page. The app screenshots are HTML/CSS mockups, not images.
- `styles.css`: design tokens are on `:root` at the top.
- `main.js`: copy buttons, scroll reveal, and `DOWNLOAD_URL`. Set it to the
  published `.dmg` and every "Download for macOS" link picks it up.
- `assets/`: the app icon, resized from `trek/resources/icon.png`.

Deploys as-is to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3).

## Docker

The site ships as an `nginx:alpine` image (`Dockerfile`, `nginx.conf`):

The container joins the external `proxy` Docker network, where cloudflared reaches
it at `http://trek-website:80` for https://gettrek.app. It also listens on
`127.0.0.1:8091` on the host for checks; it is never published publicly.

```sh
docker network create proxy             # once, if the host doesn't have it yet
docker compose up -d --build            # http://127.0.0.1:8091
TREK_WEB_PORT=3000 docker compose up -d # or another localhost port
```

### Mobile waitlist

The waitlist form on the homepage posts to `/api/waitlist`. nginx proxies that to
the `waitlist` container (`waitlist/`, a small Node service), which stores the
email and platform in the `db` container (Postgres 17, `trek-db` volume).

- `waitlist` and `db` sit on an `internal` network with no internet access. Only
  `web` joins `proxy`, so neither is reachable from outside.
- nginx allows 5 sign-ups a minute per visitor (keyed on `CF-Connecting-IP`).
  The service only accepts JSON, ignores honeypot submissions, and gives the same
  response for an address that's already on the list.
- The service creates the table on startup. Signing up again only changes the
  platform.
- If `waitlist` is down, the site still serves and the form asks people to retry.

Compose needs a database password. On the server, once:

```sh
echo "WAITLIST_DB_PASSWORD=$(openssl rand -hex 24)" > .env
```

To read or export the list:

```sh
docker exec trek-db psql -U trek -d trek -c 'select email, platform, created_at from waitlist order by id'
docker exec trek-db psql -U trek -d trek -c "\copy (select email, platform, created_at from waitlist order by id) to stdout csv header" > waitlist.csv
```

To close the waitlist, set `WAITLIST_URL` to `""` in `main.js`.

### Deploying to the server

```sh
rsync -az --delete --exclude .git --exclude .DS_Store --exclude .env --exclude node_modules ./ digitalocean:~/trek-website/
ssh digitalocean 'cd ~/trek-website && docker compose up -d --build'
```

After editing the site, run `docker compose up -d --build` again to redeploy.

- The container runs read-only with `no-new-privileges`, restarts unless stopped,
  and has a health check at `/healthz`.
- HTML, CSS and JS are sent with `Cache-Control: no-cache`, so a redeploy shows up
  on the next load. `assets/` is cached for 7 days.
- It serves plain HTTP. TLS and the domain are handled by the cloudflared tunnel
  on the `proxy` network.
