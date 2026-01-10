# Settings Management

rcat persists runtime settings in `savedata/settings.json` next to the app executable. The file is created/updated by the in-app **Settings** view.

## Provider Configuration

- Providers: **DeepSeek**, **OpenAI**, **OpenAI-compatible**
- Base URL normalization:
  - **OpenAI**: ensures the URL ends with `/v1`
  - **DeepSeek**: expects no `/v1` suffix (use `https://api.deepseek.com` or `https://api.deepseek.com/beta`)
  - **OpenAI-compatible**: left as-is (depends on vendor)

Each provider has its own profile (Base URL / API key / selected model / model list).

## VRM Preferences

When `skinMode=vrm`, rcat persists VRM view preferences in the same `savedata/settings.json`:

- `vrm.fpsMode`: `"auto"` / `"30"` / `"60"`
- `vrm.viewStates[url]`: per-VRM URL camera position + target

See `docs/VRM.md` for interaction details and the VRM subsystem overview.

## API Key Security

The API key is stored as plain text in `savedata/settings.json`. Treat that file as a secret and do not commit or share it.

## Custom Models

In **Settings → Models**, you can add/edit model entries:

- `id`: model name sent to the provider
- `maxContext` / `maxOutput`: optional UI hints
- `supportsVision`: enables vision tooling (VLM) affordances in the UI
- `supportsThink`: enables reasoning display for models that stream `reasoning_content`
- `special`: optional reserved string for future use

## Token Usage Tracking

The context indicator uses a lightweight heuristic estimator:

- CJK characters ≈ 1 token
- other characters ≈ 4 chars/token

It is an estimate and may differ from provider-reported usage.

## Troubleshooting

### Connection test failures

- Verify the **Base URL** matches the provider (OpenAI needs `/v1`; DeepSeek should not).
- Verify the API key.
- For DeepSeek strict tool calling, use `https://api.deepseek.com/beta` or set `AI_TOOL_STRICT=1`.

### History storage not syncing

- Ensure `TURSO_DATABASE_URL` (or `LIBSQL_DATABASE_URL`) and the matching auth token env var are set.
