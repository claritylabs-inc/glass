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


## Broker workspaces

Select a broker org with `spot auth:whoami --set-org <brokerOrgId>` before running broker portfolio queries. `spot query:ask` sends the selected `X-Org-Id` on POST requests, so asking from a broker org can answer across managed client organizations with client-labeled results, for example:

```sh
spot query:ask "Which clients have general liability policies expiring next month?"
```

Use `spot clients:list` to inspect broker-visible clients before asking portfolio-level questions.
