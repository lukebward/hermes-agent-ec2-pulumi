export interface TelegramArgs {
    botToken: string;
    allowedUsers: string;
}

export interface UserDataArgs {
    googleApiKey: string;
    googleModel: string;
    telegram?: TelegramArgs;
}

const KEY_HEREDOC = "HERMES_KEY_EOF_a8f3";
const UNIT_HEREDOC = "HERMES_UNIT_EOF_b2a1";
const TG_TOKEN_HEREDOC = "HERMES_TG_TOKEN_EOF_c3d4";
const TG_USERS_HEREDOC = "HERMES_TG_USERS_EOF_e5f6";
const GATEWAY_UNIT_HEREDOC = "HERMES_GATEWAY_UNIT_EOF_g7h8";

export function renderUserData(args: UserDataArgs): string {
    assertNoMarker(args.googleApiKey, KEY_HEREDOC, "Google API key");
    if (args.telegram) {
        assertNoMarker(args.telegram.botToken, TG_TOKEN_HEREDOC, "Telegram bot token");
        assertNoMarker(args.telegram.allowedUsers, TG_USERS_HEREDOC, "Telegram allowed users");
    }

    return `#!/bin/bash
set -euo pipefail
exec > >(tee -a /var/log/hermes-bootstrap.log) 2>&1

echo "[hermes-bootstrap] starting at $(date -Is)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates

echo "[hermes-bootstrap] running Hermes installer as ubuntu user"
sudo -u ubuntu -H bash -lc 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash'

echo "[hermes-bootstrap] setting Google API key in hermes config"
sudo -u ubuntu -H bash -lc 'hermes config set GOOGLE_API_KEY "$(cat)"' <<'${KEY_HEREDOC}'
${args.googleApiKey}
${KEY_HEREDOC}

echo "[hermes-bootstrap] pointing hermes at Gemini"
sudo -u ubuntu -H bash -lc 'hermes config set model.provider gemini'
sudo -u ubuntu -H bash -lc 'hermes config set model.default ${args.googleModel}'
# Hermes ships with base_url=https://openrouter.ai/api/v1 by default; clear it so Gemini provider uses its own endpoint.
sudo -u ubuntu -H bash -lc 'hermes config unset model.base_url' || sed -i '/^  base_url:/d' /home/ubuntu/.hermes/config.yaml
${args.telegram ? renderTelegramConfig(args.telegram) : ""}
echo "[hermes-bootstrap] installing hermes-dashboard systemd unit"
cat > /etc/systemd/system/hermes-dashboard.service <<'${UNIT_HEREDOC}'
[Unit]
Description=Hermes Agent Web Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu
Environment=HOME=/home/ubuntu
ExecStart=/usr/bin/env bash -lc 'exec hermes dashboard --no-open --host 127.0.0.1'
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
${UNIT_HEREDOC}

systemctl daemon-reload
systemctl enable hermes-dashboard.service
systemctl start hermes-dashboard.service
${args.telegram ? renderGatewayUnit() : ""}
echo "[hermes-bootstrap] done at $(date -Is)"
`;
}

function renderTelegramConfig(tg: TelegramArgs): string {
    return `
echo "[hermes-bootstrap] setting Telegram bot token"
sudo -u ubuntu -H bash -lc 'hermes config set TELEGRAM_BOT_TOKEN "$(cat)"' <<'${TG_TOKEN_HEREDOC}'
${tg.botToken}
${TG_TOKEN_HEREDOC}

echo "[hermes-bootstrap] setting Telegram allowed users"
sudo -u ubuntu -H bash -lc 'hermes config set TELEGRAM_ALLOWED_USERS "$(cat)"' <<'${TG_USERS_HEREDOC}'
${tg.allowedUsers}
${TG_USERS_HEREDOC}
`;
}

function renderGatewayUnit(): string {
    return `
echo "[hermes-bootstrap] installing hermes-gateway systemd unit"
cat > /etc/systemd/system/hermes-gateway.service <<'${GATEWAY_UNIT_HEREDOC}'
[Unit]
Description=Hermes Agent Messaging Gateway
After=network-online.target hermes-dashboard.service
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu
Environment=HOME=/home/ubuntu
ExecStart=/usr/bin/env bash -lc 'exec hermes gateway'
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
${GATEWAY_UNIT_HEREDOC}

systemctl daemon-reload
systemctl enable hermes-gateway.service
systemctl start hermes-gateway.service
`;
}

function assertNoMarker(value: string, marker: string, label: string): void {
    if (value.split("\n").includes(marker)) {
        throw new Error(`${label} contains the heredoc marker; cannot embed safely`);
    }
}
