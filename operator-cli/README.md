# Glass Operator CLI

Private CLI for provisioning Glass broker accounts without using the web app.

## Install

From a private npm publish:

```sh
printf '@claritylabs-inc:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}\n' > ~/.npmrc
npm install -g @claritylabs-inc/glass-operator
```

`GITHUB_PACKAGES_TOKEN` must be a GitHub token with `read:packages` access to
the `claritylabs-inc` organization. Repository agents can also set
`NODE_AUTH_TOKEN` and write the same `.npmrc` entry in their workspace.

From a packed tarball:

```sh
npm pack
npm install -g claritylabs-inc-glass-operator-0.1.0.tgz
```

## Auth

The Convex deployment must have `OPERATOR_PROVISIONING_SECRET` set. The CLI
stores the operator token locally and signs requests with HMAC; the raw token is
not sent to Convex.

```sh
glass-operator auth:login \
  --convex-url https://your-deployment.convex.cloud \
  --token "$OPERATOR_PROVISIONING_SECRET"

glass-operator auth:check
```

For agent runs, environment variables can replace local config:

```sh
export GLASS_CONVEX_URL=https://your-deployment.convex.cloud
export GLASS_OPERATOR_TOKEN=...
glass-operator auth:check
```

This repository's setup uses named profiles:

```sh
glass-operator --profile dev auth:check
glass-operator --profile prod auth:check
```

## Provision Broker

```sh
glass-operator provision-broker \
  --name "Acme Insurance" \
  --slug acme-insurance \
  --admin-email jane@acme.com \
  --admin-name "Jane Smith" \
  --admin-title "Principal" \
  --agent-handle acme \
  --website https://acme.com
```

Seed draft clients:

```sh
glass-operator provision-broker \
  --name "Acme Insurance" \
  --admin-email jane@acme.com \
  --client "Example Co|risk@example.com|https://example.com"
```

JSON input for Codex/Claude Code:

```sh
glass-operator provision-broker --input broker.json --json
```
