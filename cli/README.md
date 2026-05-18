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


## Broker workspaces

Select a broker org with `glass auth:whoami --set-org <brokerOrgId>` before running broker portfolio queries. `glass query:ask` sends the selected `X-Org-Id` on POST requests, so asking from a broker org can answer across managed client organizations with client-labeled results, for example:

```sh
glass query:ask "Which clients have general liability policies expiring next month?"
```

Use `glass clients:list` to inspect broker-visible clients before asking portfolio-level questions.
