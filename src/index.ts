#!/usr/bin/env node

/**
 * Gong MCP Server
 *
 * Wraps the Gong API v2, exposing call listings, transcripts, and
 * metadata as tools for Claude Desktop / Cowork.
 *
 * Auth: Gong uses Basic Auth with access_key:secret_key.
 * Set GONG_ACCESS_KEY and GONG_SECRET_KEY as environment variables.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GongClient } from "./gong-client.js";

const GONG_ACCESS_KEY = process.env.GONG_ACCESS_KEY;
const GONG_SECRET_KEY = process.env.GONG_SECRET_KEY;
const GONG_BASE_URL = process.env.GONG_BASE_URL;

if (!GONG_ACCESS_KEY || !GONG_SECRET_KEY) {
  console.error(
    "Error: GONG_ACCESS_KEY and GONG_SECRET_KEY environment variables are required."
  );
  process.exit(1);
}

const gong = new GongClient({
  accessKey: GONG_ACCESS_KEY,
  secretKey: GONG_SECRET_KEY,
  baseUrl: GONG_BASE_URL,
});

const server = new McpServer({
  name: "gong-mcp-server",
  version: "1.0.0",
});

const textResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

const errorResult = (err: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: `Error: ${err instanceof Error ? err.message : String(err)}`,
    },
  ],
  isError: true,
});

// --- Tool: list_calls ---

server.registerTool(
  "list_calls",
  {
    title: "List Gong Calls",
    description:
      "List calls recorded in Gong within a date range. Auto-paginates across Gong's cursor. Returns call ID, title, start time, duration, direction, and URL. Use this to find calls before retrieving transcripts.",
    inputSchema: {
      fromDateTime: z
        .string()
        .describe("Start of date range in ISO-8601 format (e.g., '2026-03-01T00:00:00Z')"),
      toDateTime: z
        .string()
        .describe("End of date range in ISO-8601 format (e.g., '2026-03-28T23:59:59Z')"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ fromDateTime, toDateTime }) => {
    try {
      const { calls, truncated, totalRecords } = await gong.listAllCalls(
        fromDateTime,
        toDateTime
      );
      const formatted = calls.map((call) => ({
        id: call.id,
        title: call.title || "Untitled",
        started: call.started,
        duration: call.duration
          ? `${Math.round(call.duration / 60)} min`
          : "unknown",
        direction: call.direction || "unknown",
        url: call.url,
      }));
      return textResult({
        callCount: formatted.length,
        totalRecords,
        truncated,
        calls: formatted,
      });
    } catch (error) {
      return errorResult(error);
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
        .min(1)
        .max(20)
        .describe("Array of Gong call IDs (max 20)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ callIds }) => {
    try {
      const calls = await gong.getCallDetails(callIds.slice(0, 20));
      const formatted = calls.map((call) => ({
        id: call.metaData?.id,
        title: call.metaData?.title || "Untitled",
        started: call.metaData?.started,
        duration: call.metaData?.duration
          ? `${Math.round(call.metaData.duration / 60)} min`
          : "unknown",
        url: call.metaData?.url,
        parties: (call.parties || []).map((p) => ({
          name: p.name || "Unknown",
          email: p.emailAddress || null,
          title: p.title || null,
          affiliation: p.affiliation || "unknown",
          speakerId: p.speakerId,
        })),
        topics: call.content?.topics || [],
        trackers: call.content?.trackers || [],
      }));
      return textResult(formatted);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// --- Tool: get_transcripts ---

server.registerTool(
  "get_transcripts",
  {
    title: "Get Call Transcripts",
    description:
      "Retrieve full transcripts for Gong calls segmented by speaker with timestamps. Match speakerId against parties from get_call_details to identify who said what.",
    inputSchema: {
      callIds: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe("Array of Gong call IDs (max 10)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ callIds }) => {
    try {
      const transcripts = await gong.getTranscripts(callIds.slice(0, 10));
      const formatted = transcripts.map((t) => ({
        callId: t.callId,
        segments: (t.transcript || []).map((seg) => ({
          speakerId: seg.speakerId,
          topic: seg.topic || null,
          sentences: (seg.sentences || []).map((s) => ({
            start: s.start,
            end: s.end,
            text: s.text,
          })),
        })),
      }));
      return textResult(formatted);
    } catch (error) {
      return errorResult(error);
    }
  }
);

// --- Tool: search_calls ---

server.registerTool(
  "search_calls",
  {
    title: "Search Call Transcripts",
    description:
      "Search Gong call transcripts for keywords within a date range. Returns matching sentences with call context (case-insensitive substring match). Caps the number of calls scanned per invocation; narrow the date range if there are more.",
    inputSchema: {
      keywords: z.string().min(1).describe("Keywords to search for in transcripts"),
      fromDateTime: z.string().describe("Start of date range (ISO-8601)"),
      toDateTime: z.string().describe("End of date range (ISO-8601)"),
      maxCalls: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .describe("Max calls to scan (default 50, hard cap 200)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ keywords, fromDateTime, toDateTime, maxCalls }) => {
    try {
      const cap = Math.min(maxCalls ?? 50, 200);
      const { calls: allCalls, totalRecords } = await gong.listAllCalls(
        fromDateTime,
        toDateTime
      );
      if (allCalls.length === 0) {
        return textResult({ matchCount: 0, message: "No calls in range." });
      }
      const scoped = allCalls.slice(0, cap);
      const callsById = new Map(scoped.map((c) => [c.id, c]));
      const truncated = allCalls.length > cap;

      const transcripts: Awaited<ReturnType<typeof gong.getTranscripts>> = [];
      for (let i = 0; i < scoped.length; i += 10) {
        const batch = scoped.slice(i, i + 10).map((c) => c.id);
        const data = await gong.getTranscripts(batch);
        transcripts.push(...data);
      }

      const needle = keywords.toLowerCase();
      const matches: Array<Record<string, unknown>> = [];
      for (const t of transcripts) {
        const call = callsById.get(t.callId);
        for (const seg of t.transcript || []) {
          for (const s of seg.sentences || []) {
            if (s.text.toLowerCase().includes(needle)) {
              matches.push({
                callId: t.callId,
                callTitle: call?.title || "Untitled",
                callDate: call?.started,
                callUrl: call?.url,
                speakerId: seg.speakerId,
                timestamp: s.start,
                text: s.text,
              });
            }
          }
        }
      }
      return textResult({
        matchCount: matches.length,
        searchedCalls: scoped.length,
        totalCallsInRange: totalRecords || allCalls.length,
        truncated,
        matches: matches.slice(0, 50),
      });
    } catch (error) {
      return errorResult(error);
    }
  }
);

// --- Tool: get_users ---

server.registerTool(
  "get_users",
  {
    title: "List Gong Users",
    description:
      "List Gong users (company team members). Returns id, name, email, title. Use to map speaker IDs in transcripts to people.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const users = await gong.listUsers();
      const formatted = users.map((u) => ({
        id: u.id,
        name: `${u.firstName || ""} ${u.lastName || ""}`.trim(),
        email: u.emailAddress,
        title: u.title || null,
        managerId: u.managerId || null,
        active: u.active,
      }));
      return textResult({ userCount: formatted.length, users: formatted });
    } catch (error) {
      return errorResult(error);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gong MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
