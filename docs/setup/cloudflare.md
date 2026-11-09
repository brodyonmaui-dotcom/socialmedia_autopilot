# Cloudflare: domain + R2 media storage (~15 min, ~$10/yr)

1. Create a free account at dash.cloudflare.com (use a strong password + 2FA: **My Profile → Authentication**).
2. **Buy a domain** (approved, ~$10–11/yr for .com, at cost): **Domain Registration → Register Domains**. Pick a neutral name with no city, gym or school in it, e.g. `<yourhandle>-hq.com`. Turn on auto-renew.
3. **R2:** sidebar **R2 Object Storage**. Enabling it asks for a card, but the free tier (10 GB) covers us. Create two buckets: `autopilot-media` and `autopilot-backups`. Both stay private for now.
4. Bucket `autopilot-media` → **Settings → Custom Domains → Connect** `media.<yourdomain>`. This gives platforms a public HTTPS URL to fetch videos from. Files are only reachable by exact URL, and the app uses unguessable names.
5. Bucket `autopilot-backups` → **Settings → Object lifecycle rules → Add**: delete objects older than 30 days.
6. **R2 → Manage API tokens → Create API token:** permission "Object Read & Write", limited to those two buckets. Copy the Access Key ID, Secret and Account ID **straight into the server's `.env`** (step 2 of the runbook). Don't paste them anywhere else.

Paste back: your domain name.
