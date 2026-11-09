#!/usr/bin/env bash
# Run once on a fresh Ubuntu 24.04 VPS as root:  bash bootstrap-vps.sh
# Installs Docker, firewall, unattended upgrades, a non-root deploy user; disables SSH password login.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl git ufw unattended-upgrades fail2ban
curl -fsSL https://get.docker.com | sh >/dev/null
id deploy >/dev/null 2>&1 || { adduser --disabled-password --gecos "" deploy; usermod -aG docker deploy; }
mkdir -p /home/deploy/.ssh && cp /root/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd
ufw default deny incoming && ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
mkdir -p /opt/autopilot && chown -R deploy:deploy /opt/autopilot
# let deploy run `git pull` with the read-only deploy key
for f in github_deploy github_deploy.pub config; do [ -f /root/.ssh/$f ] && cp /root/.ssh/$f /home/deploy/.ssh/; done
chown -R deploy:deploy /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/* 2>/dev/null || true
echo "bootstrap ok: docker $(docker --version | cut -d' ' -f3) · ufw on · user deploy · /opt/autopilot"
