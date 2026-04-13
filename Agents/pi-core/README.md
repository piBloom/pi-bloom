# NixPI Pi Core

A small always-on local API service that owns Pi SDK session prompting for other local services such as `pi-gateway`, exposed over a local Unix socket.

By default NixPI exposes the service over a Unix socket such as:

```text
/run/nixpi-pi-core/pi-core.sock
```

## API

- `GET /api/v1/health`
- `POST /api/v1/prompt`

Request body for `POST /api/v1/prompt`:

```json
{
  "prompt": "hello",
  "sessionPath": "/optional/existing/session.jsonl"
}
```

Response:

```json
{
  "text": "assistant reply",
  "sessionPath": "/path/to/session.jsonl"
}
```
