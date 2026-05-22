# Hermes Agent on AWS EC2

Pulumi (TypeScript) program that brings up a single `t4g.medium` EC2 instance, installs Nous Research's [Hermes Agent](https://hermes-agent.nousresearch.com/), and auto-starts the web dashboard plus an optional Telegram messaging gateway as systemd services.

LLM: routes to OpenAI via Hermes' `custom` provider with `base_url=https://api.openai.com/v1`. Hermes' built-in "OpenAI Codex" provider is OAuth-only and not usable here; the `custom` path uses your API key directly. A reasoning model (`gpt-5`, `o3-mini`, `o1`, …) is required — see [Troubleshooting](#troubleshooting).

## Prerequisites

- Pulumi CLI logged in (`pulumi login`)
- AWS credentials in your shell (`aws sso login --profile <yours>`, then `export AWS_PROFILE=<yours>`)
- An OpenAI API key with a billing limit set: <https://platform.openai.com/api-keys>
- An SSH key at `~/.ssh/id_ed25519.pub` (or any other public key)

## Deploy

```bash
npm install
pulumi stack init dev
pulumi config set publicKey "$(cat ~/.ssh/id_ed25519.pub)"
pulumi config set sshCidr "$(curl -s ifconfig.me)/32"
pulumi config set --secret openaiApiKey 'sk-...'

# optional — see "Add Telegram" below
# pulumi config set --secret telegramBotToken '123456789:ABCdef...'
# pulumi config set telegramAllowedUsers '987654321'

pulumi up
ssh ubuntu@$(pulumi stack output publicIp) 'cloud-init status --wait'
```

`cloud-init status --wait` blocks until the Hermes installer (~5–10 min on first boot) finishes. When it returns `status: done`, both systemd services are running.

## Use the web dashboard

From your laptop:
```bash
ssh -L 9119:localhost:9119 ubuntu@$(pulumi stack output publicIp)
```
Open <http://localhost:9119>. The dashboard binds to `127.0.0.1` on the box, so it's only reachable through the SSH tunnel.

## Add Telegram

1. In Telegram, message [@BotFather](https://t.me/BotFather), `/newbot`, follow prompts, copy the token.
2. Message [@userinfobot](https://t.me/userinfobot) to get your numeric user ID.
3. Set config and redeploy:
   ```bash
   pulumi config set --secret telegramBotToken '123456789:ABCdef...'
   pulumi config set telegramAllowedUsers '987654321'   # comma-separated for multiple users
   pulumi up
   ssh ubuntu@$(pulumi stack output publicIp) 'cloud-init status --wait'
   ```
4. Message your bot in Telegram. Hermes replies.

To remove Telegram later: `pulumi config rm telegramBotToken && pulumi config rm telegramAllowedUsers && pulumi up`.

## Verify

```bash
ssh ubuntu@$(pulumi stack output publicIp) '
  systemctl is-active hermes-dashboard
  systemctl is-active hermes-gateway 2>/dev/null || echo "gateway: not configured"
  sudo journalctl -u hermes-dashboard -n 5 --no-pager
'
```

If something looks wrong, the bootstrap log is at `/var/log/hermes-bootstrap.log` on the box.

Live-tail the gateway as you message the bot (best for debugging chat issues):
```bash
ssh ubuntu@$(pulumi stack output publicIp) 'sudo journalctl -u hermes-gateway -f --no-pager'
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `REMOTE HOST IDENTIFICATION HAS CHANGED!` on SSH | The EC2 was replaced (e.g. user-data changed) and is a different machine | `ssh-keygen -R $(pulumi stack output publicIp)` |
| Bot replies `Provider authentication failed. Check the configured credentials` | Wrong provider config in `~/.hermes/config.yaml` — likely `provider: codex` or `provider: openrouter` left over | Run the live fix from `userdata.ts` (or just `pulumi up` to redeploy) |
| Gateway log says `HTTP 400: Encrypted content is not supported with this model` | You chose a non-reasoning OpenAI model (`gpt-4o`, `gpt-4`) | Switch to a reasoning model: `pulumi config set openaiModel gpt-5` and `pulumi up`, or live-patch with `hermes config set model.default gpt-5 && sudo systemctl restart hermes-gateway` |
| Gateway log says `Primary provider auth failed: Unknown provider 'X'` | `model.provider` in `config.yaml` isn't one Hermes recognizes (see `hermes model` for the list) | Set it back to `custom` |
| Gateway log says `No Codex credentials stored. Run hermes auth` | `provider: codex` was set; Codex requires OAuth, not an API key | Switch back to `provider: custom` with `base_url: https://api.openai.com/v1` |
| `pulumi up` says it's replacing the instance | Any user-data change forces a replace (intentional) | Wait ~5–10 min for `cloud-init status --wait` after `up` |
| `sudo hermes: command not found` | `hermes` is in `/home/ubuntu/.local/bin`, not on root's PATH | Use `bash -lc 'hermes …'` over SSH, or full path `/home/ubuntu/.hermes/hermes-agent/venv/bin/hermes` |

## Tear down

```bash
pulumi destroy
```

Releases the Elastic IP and the instance. Cloud-init / Hermes state on the disk is gone. `pulumi up` again starts fresh.

## Cost

~$27/mo while running (instance + EBS). ~$0 after `pulumi destroy`.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Entry; reads config, exports outputs |
| `network.ts` | Security group (SSH from `sshCidr`) |
| `instance.ts` | AMI lookup, KeyPair, EC2, Elastic IP |
| `userdata.ts` | Renders the cloud-init bootstrap script |

## License

MIT — see [LICENSE](LICENSE).

## Config reference

| Key | Required | Notes |
|---|---|---|
| `aws:region` | no (default `us-west-2`) | |
| `publicKey` | yes | Your SSH public key, single line |
| `sshCidr` | yes | CIDR allowed to SSH in, e.g. `1.2.3.4/32` |
| `openaiApiKey` | yes (secret) | Hermes' LLM provider key |
| `openaiModel` | no (default `gpt-5`) | Must be a reasoning model — `gpt-5`, `o3-mini`, `o1`, etc. Hermes requires encrypted-reasoning support, so non-reasoning models like `gpt-4o` won't work. |
| `instanceType` | no (default `t4g.medium`) | Any ARM Graviton type that meets 4 GB RAM |
| `telegramBotToken` | optional (secret) | If set, `telegramAllowedUsers` must also be set |
| `telegramAllowedUsers` | optional | Comma-separated Telegram numeric user IDs |
