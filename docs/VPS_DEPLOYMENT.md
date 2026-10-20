# VPS deployment

The VPS deployment runs the production Docker image behind the server's Nginx reverse proxy. The container listens only on `127.0.0.1:18081`; Nginx handles public HTTP and HTTPS. This deployment needs no database.

The assessment is hosted at **https://weather.srv1848938.hstgr.cloud/** using the hostname provided with the Hostinger VPS. HTTP redirects to HTTPS. The public UI, live route analysis, and all nine browser checks have been verified against this deployment.

## Initial application setup

Requires Docker with the Compose plugin, Git, Nginx, and Certbot. Inspect existing sites and port assignments before configuring a shared server.

```bash
git clone https://github.com/shahan-strategisthub/spotter-weather-routing.git /opt/spotter-weather-routing
cd /opt/spotter-weather-routing
```

Create `.env.vps` on the server, with permissions `600`. This file is excluded from Git. Generate a unique secret, for example with `python3 -c 'import secrets; print(secrets.token_urlsafe(64))'`.

```dotenv
DJANGO_SECRET_KEY=YOUR_GENERATED_SECRET
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,weather.example.com
```

Replace `weather.example.com` with the actual public hostname. Then build and start the app:

```bash
docker compose --env-file .env.vps -f deploy/compose.vps.yaml up -d --build
curl --fail http://127.0.0.1:18081/api/health/
```

## Public hostname and HTTPS

Point the chosen hostname to the VPS. A Hostinger-provided hostname that already resolves to the server can also be used.

Add a separate Nginx virtual host for that exact hostname, forwarding application requests to `http://127.0.0.1:18081`. Forward `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto`; allow at least 180 seconds for route analysis responses. Test with `nginx -t` before reloading Nginx.

Use Certbot's webroot authenticator with a dedicated `/.well-known/acme-challenge/` location to obtain a certificate. Configure the HTTPS virtual host with that certificate, redirect application HTTP requests to HTTPS, and configure a renewal deploy hook that reloads Nginx. Keep the challenge location reachable for automatic renewals.

The deployed server uses `/etc/nginx/sites-available/corridor-weather-routing`, the ACME webroot `/var/www/corridor-acme`, and the Certbot certificate name `corridor-weather-routing`.

## Updates and verification

```bash
cd /opt/spotter-weather-routing
git pull --ff-only
docker compose --env-file .env.vps -f deploy/compose.vps.yaml up -d --build
docker compose --env-file .env.vps -f deploy/compose.vps.yaml ps
docker logs --tail 50 corridor-weather-routing
```

Verify the public `/api/health/` endpoint, load the UI, and run a live trip after deployment. The production browser suite can target the hosted URL:

```bash
cd frontend
PLAYWRIGHT_BASE_URL=https://YOUR_PUBLIC_HOSTNAME npm test
```

Check certificate renewal with `certbot renew --cert-name corridor-weather-routing --dry-run`. Docker restarts the app after a server reboot; the server's Certbot timer manages certificate renewal. Container logs rotate at 10 MB, retaining three files.
