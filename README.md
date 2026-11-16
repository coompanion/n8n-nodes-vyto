# @vyto/n8n-nodes-vyto

n8n community nodes for [vyto](https://vyto.ai): traffic fines for rental and fleet operators. vyto reads incoming notices,
finds the driver and answers the authority.

- **vyto Trigger** – starts a workflow when a case is created or changed (polling; optional filters for status and license plate)
- **vyto** – *Case → Get Many* (filters: status, license plate, updated since) and *Notice → Upload* / *Notice → Get*

Both nodes can also be used as tools by n8n AI agents.

## Installation

Self-hosted n8n: **Settings → Community Nodes → Install** and enter `@vyto/n8n-nodes-vyto`.
See the [n8n docs on community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

1. In vyto, open **Settings → Integrations → API keys** and create a key.
   Grant *read cases* for the trigger and *Get Many*, *upload notices* for *Upload*.
2. In n8n, create a **Vyto API** credential, paste the key and keep the environment *vyto (app.vyto.ai)*.

## Operations

| Resource | Operation | vyto API |
|---|---|---|
| Case | Get Many | `GET /v1/cases` (cursor paging) |
| Notice | Upload | `POST /v1/documents` (PDF up to 5 MB; same *External Reference* returns the first upload) |
| Notice | Get | `GET /v1/documents/{id}` |
| Trigger | New or updated case | `GET /v1/cases?updated_since=…` |

The trigger starts from the moment it is activated and does not replay older cases. A manual test run returns the most recently
changed case of the last 30 days as sample data.

Driver, bank and portal data are not part of the vyto API.

## Development

```bash
npm install
npm run lint
npm test                 # build + tests against a fake API
npm run dev              # n8n on http://localhost:5678 with these nodes (n8n needs Node.js 24)
```

Live tests against the vyto API: `VYTO_API_KEY=vyto_… VYTO_BASE_URL=<api url> node --test test/*.test.mjs`.

## Compatibility

Built and tested with n8n 2.47 (`n8n-workflow` 2.16).

## Releases

Versions are published to npm by the GitHub workflow `publish.yml` with a provenance statement.
Run `npm run release` locally: it lints, builds, bumps the version, updates the changelog and pushes a tag.

## License

[MIT](LICENSE)
