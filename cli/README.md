# Glass CLI

Command line access to Glass for terminal workflows, scripts, and local automation.

## Install

```sh
npm install -g @claritylabs/glass-cli
```

## Authenticate

```sh
glass auth:login
glass auth:whoami
glass auth:whoami --set-org <orgId>
```

The CLI targets production by default. For preview or local environments, set `GLASS_BASE_URL`:

```sh
GLASS_BASE_URL=http://localhost:8080 glass auth:login
```

## Examples

```sh
glass me
glass org
glass policies:list
glass policies:get <policyId>
glass query:ask "What policies expire next month?"
```
