#!/usr/bin/env node

/**
 * Gong MCP Server
 *
 * An MCP server that wraps the Gong API v2, exposing call listings,
 * transcripts, and metadata as tools for Claude Desktop / Cowork.
 *
 * Authentication: Gong uses Basic Auth with access_key:secret_key.
 * Set GONG_ACCESS_KEY and GONG_SECRET_KEY as environment variables.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// --- Configuration ---

const GONG_ACCESS_KEY = process.env.GONG_ACCESS_KEY;
const GONG_SECRET_KEY = process.env.GONG_SECRET_KEY;
const GONG_BASE_URL = process.env.GONG_BASE_URL || "https://api.gong.io/v2";

if (!GONG_ACCESS_KEY || !GONG_SECRET_KEY) {
  console.error(
    "Error: GONG_ACCESS_KEY and GONG_SECRET_KEY environment variables are required."
  );
  process.exit(1);
}

const AUTH_HEADER =
  "Basic " +
  Buffer.from(`${GONG_ACCESS_KEY}:${GONG_SECRET_KEY}`).toString("base64");

// --- Gong API helpers ---

async function gongGet(
  path: string,
  params?: Record<string, string>
): Promise<any> {
  const url = new URL(`${GONG_BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gong API GET ${path} failed (${response.status}): ${body}`);
  }
  return response.json();
}

async function gongPost(path: string, body: any): Promise<any> {
  const response = await fetch(`${GONG_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const respBody = await response.text();
    throw new Error(
      `Gong API POST ${path} failed (${response.status}): ${respBody}`
    );
  }
  return response.json();
}

async function gongPostPaginated(
  path: string,
  body: any,
  resultKey: string,
  maxPages: number = 10
): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | undefined;
  let page = 0;
  while (page < maxPages) {
    const requestBody = cursor ? { ...body, cursor } : body;
    const data = await gongPost(path, requestBody);
    if (data[resultKey]) results.push(...data[resultKey]);
    if (data.records?.cursor) {
      cursor = data.records.cursor;
    } else {
      break;
    }
    page++;
  }
  return results;
}

// --- MCP Server setup ---

const server = new McpServer({
  name: "gong-mcp-server",
  version: "1.0.0",
});

// --- Tool: list_calls ---

server.registerTool(
  "list_calls",
  {
    title: "List Gong Calls",
    description:
      "List calls recorded in Gong within a date range. Returns call ID, title, start time, duration, and URL. Use this to find calls before retrieving transcripts.",
    inputSchema: {
      fromDateTime: z
        .string()
        .describe("Start of date range in ISO-8601 format (e.g., '2026-03-01T00:00:00Z')"),
      toDateTime: z
        .string()
        .describe("End of date range in ISO-8601 format (e.g., '2026-03-28T23:59:59Z')"),
      workspaceId: z.string().optional().describe("Optional Gong workspace ID"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ fromDateTime, toDateTime, workspaceId }) => {
    try {
      const params: Record<string, string> = { fromDateTime, toDateTime };
      if (workspaceId) params.workspaceId = workspaceId;
      const data = await gongGet("/calls", params);
      const calls = (data.calls || []).map((call: any) => ({
        id: call.id,
        title: call.title || "Untitled",
        started: call.started,
        duration: call.duration ? `${Math.round(call.duration / 60)} min` : "unknown",
        direction: call.direction || "unknown",
        url: call.url,
      }));
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ callCount: calls.length, calls }, null, 2) },
        ],
      };
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    }
  }
);

// --- Tool: get_call_details ---

server.registerTool(
  "get_call_details",
  {
    title: "Get Call Details",
    description:
      "Get detailed info about specific Gong calls including participants (name, email, title, internal vs external), topics, and trackers. Provide call IDs from list_calls.",
    inputSchema: {
      callIds: z
        .array(z.string())
        .describe("Array of Gong call IDs (max 20)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ callIds }) => {
    try {
      const data = await gongPost("/calls/extensive", {
        filter: { callIds: callIds.slice(0, 20) },
        contentSelector: {
          exposedFields: {
            content: { structure: true, topics: true, trackers: true, pointsOfInterest: true },
            collaboration: { publicComments: true },
            parties: true,
          },
        },
      });
      const calls = (data.calls || []).map((call: any) => ({
        id: call.metaData?.id,
        title: call.metaData?.title || "Untitled",
        started: call.metaData?.started,
        duration: call.metaData?.duration ? `${Math.round(call.metaData.duration / 60)} min` : "unknown",
        url: call.metaData?.url,
        parties: (call.parties || []).map((p: any) => ({
          name: p.name || "Unknown",
          email: p.emailAddress || null,
          title: p.title || null,
          affiliation: p.affiliation || "unknown",
          speakerId: p.speakerId,
        })),
        topics: call.content?.topics || [],
        trackers: call.content?.trackers || [],
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(calls, null, 2) }],
      };
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    }
  }
);

// --- Tool: get_transcript ---

server.registerTool(
  "get_transcript",
  {
    title: "Get Call Transcript",
    description:
      "Retrieve the full transcript of Gong calls segmented by speaker with timestamps. Match speaker IDs against participants from get_call_details to identify who said what.",
    inputSchema: {
      callIds: z
        .array(z.string())
        .describe("Array of Gong call IDs (max 10)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ callIds }) => {
    try {
      const data = await gongPost("/calls/transcript", {
        filter: { callIds: callIds.slice(0, 10) },
      });
      const transcripts = (data.callTranscripts || []).map((t: any) => ({
        callId: t.callId,
        segments: (t.transcript || []).map((seg: any) => ({
          speakerId: seg.speakerId,
          topic: seg.topic || null,
          sentences: (seg.sentences || []).map((s: any) => ({
            start: s.start,
            end: s.end,
            text: s.text,
          })),
        })),
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(transcripts, null, 2) }],
      };
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    }
  }
);

// --- Tool: search_calls ---

server.registerTool(
  "search_calls",
  {
    title: "Search Call Transcripts",
    description:
      "Search Gong call transcripts for keywords within a date range. Returns matching sentences with call context. Searches up to 50 calls; narrow the date range if there are more.",
    inputSchema: {
      keywords: z.string().describe("Keywords to search for in transcripts"),
      fromDateTime: z.string().describe("Start of date range (ISO-8601)"),
      toDateTime: z.string().describe("End of date range (ISO-8601)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ keywords, fromDateTime, toDateTime }) => {
    try {
      const listData = await gongGet("/calls", { fromDateTime, toDateTime });
      const allCalls = listData.calls || [];
      if (allCalls.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ matchCount: 0, message: "No calls in range." }) }],
        };
      }
      const callIds = allCalls.slice(0, 50).map((c: any) => c.id);
      const truncated = allCalls.length > 50;

      const allTranscripts: any[] = [];
      for (let i = 0; i < callIds.length; i += 10) {
        const batch = callIds.slice(i, i + 10);
        const data = await gongPost("/calls/transcript", { filter: { callIds: batch } });
        allTranscripts.push(...(data.callTranscripts || []));
      }

      const lower = keywords.toLowerCase();
      const matches: any[] = [];
      for (const t of allTranscripts) {
        const callInfo = allCalls.find((c: any) => c.id === t.callId);
        for (const seg of t.transcript || []) {
          for (const s of seg.sentences || []) {
            if (s.text.toLowerCase().includes(lower)) {
              matches.push({
                callId: t.callId,
                callTitle: callInfo?.title || "Untitled",
                callDate: callInfo?.started,
                callUrl: callInfo?.url,
                speakerId: seg.speakerId,
                timestamp: s.start,
                text: s.text,
              });
            }
          }
        }
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              matchCount: matches.length,
              searchedCalls: callIds.length,
              totalCallsInRange: allCalls.length,
              truncated,
              matches: matches.slice(0, 50),
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    }
  }
);

// --- Tool: get_users ---

server.registerTool(
  "get_users",
  {
    title: "List Gong Users",
    description:
      "List all Gong users (company team members). Returns ID, name, email, title. Use to map speaker IDs in transcripts to people.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const users = await gongPostPaginated("/users", {}, "users", 5);
      const formatted = users.map((u: any) => ({
        id: u.id,
        name: `${u.firstName || ""} ${u.lastName || ""}`.trim(),
        email: u.emailAddress,
        title: u.title || null,
        managerId: u.managerId || null,
        active: u.active,
      }));
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ userCount: formatted.length, users: formatted }, null, 2) },
        ],
      };
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    }
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gong MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
