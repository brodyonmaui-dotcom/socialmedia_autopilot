# Server (~25 min, ~€6/mo)

## 1. SSH key on Windows (once)
Open PowerShell:
```
ssh-keygen -t ed25519 -C "autopilot"
type $env:USERPROFILE\.ssh\id_ed25519.pub
```
Press Enter through the prompts, though a passphrase is better. Copy the line it prints (the **public** key, safe to share).

## 2. Order (`[OK?]`)
- **First choice: Hetzner Cloud** (console.hetzner.cloud): new project → **Add Server**. Location Falkenstein, Nuremberg or Helsinki. Image **Ubuntu 24.04**. Type **CX23** (shared vCPU, x86, ~€5.49 + IPv4). Add your SSH key. Name `autopilot`. New accounts sometimes need an ID check that can take a while.
- **If CX23 can't be ordered or verification stalls: OVHcloud VPS-1** (US East/West), Ubuntu 24.04, ~$5–6.50 with daily backup included. Add your SSH key.

## 3. First login: get the code (the repo is private, so use a read-only deploy key)
```
ssh root@<server-ip>
apt-get update -qq && apt-get install -y -qq git
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```
On GitHub: repo → **Settings → Deploy keys → Add deploy key**, paste it, leave "Allow write access" **off**. Then, still on the server:
```
printf "Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  StrictHostKeyChecking accept-new\n" >> ~/.ssh/config
git clone -b claude/dazzling-dijkstra-6ra0n5 git@github.com:brodyonmaui-dotcom/socialmedia_autopilot.git /opt/autopilot
```

## 4. Bootstrap + secrets file
```
less /opt/autopilot/infra/bootstrap-vps.sh   # read it first (q to quit)
cd /opt/autopilot && cp .env.example .env && chmod 600 .env && openssl rand -hex 24
nano .env
bash /opt/autopilot/infra/bootstrap-vps.sh
```
In `nano`, fill in `POSTGRES_PASSWORD` (paste the random string printed above) and the R2 values. `DOMAIN` comes in step 5. Save with Ctrl+O, exit with Ctrl+X. From now on, log in as `ssh deploy@<server-ip>`; root password login is off.

## 5. DNS + start
- Cloudflare → your domain → **DNS → Add record**: type `A`, name `app`, IPv4 = server IP, proxy status **DNS only** (grey cloud). Set `DOMAIN=app.<yourdomain>` in `.env`.
- `cd /opt/autopilot/infra && docker compose up -d && sleep 20 && curl -s https://app.<yourdomain>/healthz`

Paste back: the `bootstrap ok …` line and the `curl` output (`ok`).
