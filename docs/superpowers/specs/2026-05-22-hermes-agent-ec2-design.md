# Hermes Agent on AWS EC2 — Pulumi Design

Date: 2026-05-22
Status: Draft, awaiting user review

## Goal

A single-stack Pulumi TypeScript program that provisions an inexpensive AWS
EC2 instance, installs Nous Research's Hermes Agent on it, pre-configures an
OpenAI API key from Pulumi secret config, and outputs the SSH command needed
to use it.

Target use case: a single user experimenting with Hermes. Not a production
deployment.

## Non-goals

- Multi-AZ / high availability
- Autoscaling, load balancing, DNS
- Backups, monitoring, alerting
- Multi-tenant access controls
- Exposing the Hermes dashboard publicly (reached via SSH local port
  forwarding when needed)

## Resources

| Resource | Type | Notes |
|---|---|---|
| Security group | `aws.ec2.SecurityGroup` | Inbound: SSH (22) from `sshCidr`. Outbound: all. |
| Key pair | `aws.ec2.KeyPair` | Built from the `publicKey` Pulumi config value. |
| AMI lookup | `aws.ssm.getParameter` | `/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id` — gives the current Ubuntu 24.04 LTS arm64 AMI in-region. |
| EC2 instance | `aws.ec2.Instance` | `t4g.medium` (2 vCPU / 4GB, ARM Graviton). Root: 30GB gp3. User-data runs Hermes installer. |
| Elastic IP | `aws.ec2.Eip` | Stable public IPv4. |
| EIP association | `aws.ec2.EipAssociation` | Binds EIP to the instance. |

Region default: `us-west-2` (set in `Pulumi.dev.yaml`).

## Configuration

| Key | Type | Required | Description |
|---|---|---|---|
| `aws:region` | string | no (default `us-west-2` via `Pulumi.dev.yaml`) | AWS region. |
| `publicKey` | string | yes | Contents of your `~/.ssh/id_*.pub`. |
| `sshCidr` | string | yes | CIDR allowed to reach SSH. No default — program throws if unset. |
| `openaiApiKey` | secret string | yes | Pre-seeded into Hermes via `hermes config set OPENAI_API_KEY`. |
| `instanceType` | string | no (default `t4g.medium`) | Override instance type if needed. |

The program reads `openaiApiKey` with `requireSecret()` so it stays encrypted
in the Pulumi state file.

## File layout

```
demo/
├── Pulumi.yaml
├── Pulumi.dev.yaml          # committed; secrets stored encrypted by Pulumi
├── package.json
├── tsconfig.json
├── index.ts                 # entry; wires modules and exports outputs
├── network.ts               # security group
├── instance.ts              # AMI lookup, KeyPair, Instance, EIP
└── userdata.ts              # renders the bootstrap shell script
```

Each module exports one factory function. Splitting keeps files small and
focused — `index.ts` should be readable in one screen.

## User-data bootstrap

The user-data script runs as root on first boot via cloud-init. It must:

1. `apt-get update` and install `curl` and `ca-certificates`. The Hermes
   installer brings its own `uv`, Python 3.11, Node.js 22, ripgrep, and
   ffmpeg, so we don't pre-install language runtimes.
2. Run the official Hermes installer as the `ubuntu` user (not root) so
   files land in `/home/ubuntu/.local`:
   ```
   sudo -u ubuntu bash -lc 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash'
   ```
3. Write the OpenAI key into Hermes' config as the `ubuntu` user:
   ```
   sudo -u ubuntu bash -lc 'hermes config set OPENAI_API_KEY <key>'
   ```
4. Log progress to `/var/log/hermes-bootstrap.log` so `cloud-init` failures
   are debuggable from `journalctl -u cloud-final` or by tailing that file
   after SSH.

The script is rendered in `userdata.ts` with the API key interpolated. The
key is sensitive but acceptable in user-data for a single-user demo — see
Security notes.

## Outputs

| Name | Source |
|---|---|
| `publicIp` | EIP address |
| `instanceId` | EC2 instance id |
| `sshCommand` | Formatted string: `ssh ubuntu@<publicIp>` |
| `tunnelHint` | Comment string showing `ssh -L 3000:localhost:3000 ubuntu@<publicIp>` so the user knows how to reach the dashboard. The exact port comes from Hermes once started; 3000 is a hint, not authoritative. |

## Security notes

- **SSH access**: gated by `sshCidr`. No default — program throws if unset
  so the box is never accidentally world-reachable.
- **API key in user-data**: cloud-init stores user-data on the instance at
  `/var/lib/cloud/instance/user-data.txt` (root-readable). For a single
  user this is acceptable. If we ever multi-tenant this, move to AWS
  Secrets Manager + IAM role.
- **State file**: `openaiApiKey` is read via `requireSecret()` so it is
  encrypted at rest in Pulumi state.
- **No HTTP ingress**: the dashboard, if used, is reached via SSH local
  port forwarding (`ssh -L`). No public ports beyond SSH.

## Failure modes considered

| Failure | Behavior |
|---|---|
| `sshCidr` not set | Program throws at startup, no resources created. |
| `publicKey` not set | Program throws at startup. |
| `openaiApiKey` not set | Program throws at startup (`requireSecret`). |
| Hermes installer fails on first boot | Instance comes up, install fails; user sees error in `/var/log/hermes-bootstrap.log` via SSH. Pulumi up still succeeds — we don't gate on cloud-init completion. |
| AMI lookup returns nothing (bad region) | Pulumi fails the AMI resource with a clear AWS error. |

## Testing / verification

Manual, no automated tests. After `pulumi up`:

1. `pulumi stack output sshCommand` → copy + run → confirm we land on the box.
2. On the box, `tail -f /var/log/hermes-bootstrap.log` until "bootstrap done".
3. Run `hermes` interactively, confirm it can reach OpenAI by asking a
   simple prompt.
4. `pulumi destroy` cleans up everything.

## Cost estimate

| Item | Monthly |
|---|---|
| `t4g.medium` on-demand, us-west-2 | ~$24.60 |
| 30GB gp3 EBS | ~$2.40 |
| Elastic IP (attached, running) | $0 |
| Data egress (light experimentation) | a few cents |
| **Total** | **~$27/mo running** |

Stopped instance: ~$2.40/mo EBS + $3.60/mo EIP (charged only when EIP is
unattached or instance is stopped). Worth `pulumi destroy` between sessions
for true zero-cost.
