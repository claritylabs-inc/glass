# Spot CLI

Command line access to Spot for terminal workflows, scripts, and local automation.

## Install

```sh
npm install -g @claritylabs/spot-cli
```

## Authenticate

```sh
spot auth:login
spot auth:whoami
spot auth:whoami --set-org <orgId>
```

The CLI targets production by default. For preview or local environments, set `SPOT_BASE_URL`:

```sh
SPOT_BASE_URL=http://localhost:8080 spot auth:login
```

## Examples

```sh
spot me
spot org
spot policies:list
spot policies:get <policyId>
spot query:ask "What policies expire next month?"
```

The CLI is client-side and policy-focused. Broker organizations are maintained by operators in the private operator CLI and used as suppliers in procurement requests; the tenant CLI does not expose broker portfolios or client-management commands.
