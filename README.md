# Gong MCP 

An MCP that exposes Gong call data to Claude Desktop. Part of the PM Signal Intelligence system.

## What it does

Exposes five tools to Claude:

1. **list_calls** — List calls by date range (auto-paginates across Gong's cursor). Returns call IDs, titles, dates, durations.
2. **get_call_details** — Get participants with names, titles, emails, and internal/external classification, plus topics and trackers.
3. **get_transcripts** — Get full transcripts segmented by speaker with timestamps. Match `speakerId` against participants from `get_call_details`.
4. **search_calls** — Search for keywords across transcripts in a date range. Returns matching segments with speaker and timestamp context. Optional `maxCalls` (default 50, max 200) bounds how many calls are scanned.
5. **get_users** — List Gong users (id, name, email, title). Use to map speaker IDs to people.

## Prerequisites

- Node.js 18+
- A Gong API key (access key + secret key). Get this from your Gong admin: Gong > Settings > Technical > API.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Test locally (optional)

```bash
GONG_ACCESS_KEY=your-access-key GONG_SECRET_KEY=your-secret-key npm start
```

The server communicates over stdio (stdin/stdout), so you won't see output in the terminal. It's designed to be spawned by Claude Desktop.

### 4. Add to Claude Desktop

Open Claude Desktop > Settings > Developer > App Config File.

Add the following to the `mcpServers` section (create the section if it doesn't exist):

```json
{
  "mcpServers": {
    "gong": {
      "command": "node",
      "args": ["/absolute/path/to/gong-mcp-server/build/index.js"],
      "env": {
        "GONG_ACCESS_KEY": "your-access-key",
        "GONG_SECRET_KEY": "your-secret-key"
      }
    }
  }
}
```

Replace `/absolute/path/to/gong-mcp-server` with the actual path on your machine.

### 5. Restart Claude Desktop

After saving the config, restart Claude Desktop. The Gong connector should appear in Settings > Connectors.

### 6. Set permissions

In Settings > Connectors > gong, set tool permissions:

- list_calls: **Allow**
- get_call_details: **Allow**
- get_transcripts: **Allow**
- search_calls: **Allow**
- get_users: **Allow**

## Usage in Claude

Once connected, Claude can use the Gong tools directly:

```
"List all Gong calls from last week"
→ Claude calls list_calls with the date range

"Show me the transcript for call 1234567890"
→ Claude calls get_transcripts with the call ID

"Search for mentions of 'city manager' in Gong calls this month"
→ Claude calls search_calls with the query and date range

"Who was on the call with City of Durham on March 15?"
→ Claude calls get_call_details with the call ID
```

## API rate limits

Gong's API has rate limits. The server retries 429 responses up to 3 times with exponential backoff, honoring `Retry-After` when present. If you still see rate-limit errors during large backfills, reduce `maxCalls` on `search_calls` or narrow the date range.

## Gong API reference

The server uses these Gong v2 endpoints:

- `GET /v2/calls` — list calls by date range (cursor-paginated)
- `POST /v2/calls/extensive` — get detailed call data with participants
- `POST /v2/calls/transcript` — get call transcripts
- `GET /v2/users` — list users (cursor-paginated)

Full API documentation: https://gong.app.gong.io/settings/api/documentation

## Troubleshooting

**Server not appearing in Claude Desktop connectors:**
- Check that the path in the config is absolute and correct.
- Verify that `node` is accessible from the system PATH.
- Restart Claude Desktop after config changes.

**Authentication errors:**
- Verify GONG_ACCESS_KEY and GONG_SECRET_KEY are correct.
- Gong API keys use Basic auth (access_key:secret_key). The server handles encoding automatically.

**Empty results:**
- Check the date range format (ISO 8601 with timezone).
- Verify that calls exist in the specified range in Gong's UI.
- Some Gong plans restrict API access. Confirm your plan includes API access.

**Rate limit errors:**
- Reduce batch sizes. The `search_calls` tool has a `maxCalls` parameter (default 50).
- Narrow the date range so fewer calls are paginated.
