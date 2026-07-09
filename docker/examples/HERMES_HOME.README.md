# Hermes Docker Setup

This directory is mounted into the container as `HERMES_HOME`.

## Default profile

- `config.yaml`: `/home/agent/.hermes/config.yaml`
- `auth.json`: `/home/agent/.hermes/auth.json`

## Named profile

If you set `HERMES_ACTIVE_PROFILE=<name>`, the active profile files move to:

- `profiles/<name>/config.yaml`
- `profiles/<name>/auth.json`

## Recommended flow

1. Run `docker compose run --rm hermes-webui prepare-hermes-home`
2. Copy `config.yaml.example` to `config.yaml`
3. Fill in the provider, model, base URL, and credentials you actually use
4. Start the service with `docker compose up -d`

`auth.json` is optional at bootstrap time because some providers use inline
config, while others populate credentials through Hermes/UI auth flows.
