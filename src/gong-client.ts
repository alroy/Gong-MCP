/**
 * Gong API v2 client.
 *
 * Authentication: Basic auth using access key + secret key.
 * Base URL: https://api.gong.io/v2
 *
 * Endpoints used:
 *   GET  /v2/calls                  — list calls by date range (cursor-paginated)
 *   POST /v2/calls/extensive        — get detailed call data with participants
 *   POST /v2/calls/transcript       — get call transcripts
 *   GET  /v2/users                  — list users (cursor-paginated)
 */

export interface GongConfig {
  accessKey: string;
  secretKey: string;
  baseUrl?: string;
}

export interface GongCall {
  id: string;
  title: string;
  started: string;
  duration: number;
  direction: string;
  primaryUserId: string;
  url: string;
}

export interface GongParticipant {
  id?: string;
  name: string;
  emailAddress?: string;
  title?: string;
  speakerId: string;
  affiliation: "internal" | "external" | "unknown";
}

export interface GongCallDetailed {
  metaData: {
    id: string;
    title: string;
    started: string;
    duration: number;
    url: string;
    primaryUserId: string;
    direction: string;
    scope: string;
  };
  parties?: GongParticipant[];
  content?: {
    topics?: Array<{ name: string; duration?: number }>;
    trackers?: Array<{ name: string; count?: number }>;
    pointsOfInterest?: unknown[];
  };
}

export interface GongTranscriptEntry {
  speakerId: string;
  topic: string | null;
  sentences: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export interface GongCallTranscript {
  callId: string;
  transcript: GongTranscriptEntry[];
}

export interface GongUser {
  id: string;
  emailAddress?: string;
  firstName?: string;
  lastName?: string;
  title?: string | null;
  managerId?: string | null;
  active?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GongClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: GongConfig) {
    this.baseUrl = config.baseUrl || "https://api.gong.io/v2";
    const credentials = Buffer.from(
      `${config.accessKey}:${config.secretKey}`
    ).toString("base64");
    this.authHeader = `Basic ${credentials}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 0
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (response.status === 429) {
      if (attempt < 3) {
        const retryAfterRaw = response.headers.get("Retry-After");
        const retryAfterSec = retryAfterRaw ? parseFloat(retryAfterRaw) : NaN;
        const waitMs = Number.isFinite(retryAfterSec)
          ? Math.max(retryAfterSec * 1000, 500)
          : Math.min(8000, 1000 * Math.pow(2, attempt));
        await sleep(waitMs);
        return this.request<T>(method, path, body, attempt + 1);
      }
      throw new Error(`Gong API rate limited after ${attempt + 1} attempts.`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gong API ${method} ${path} failed (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Single-page call listing. Use listAllCalls to auto-paginate.
   * GET /v2/calls?fromDateTime=...&toDateTime=...
   */
  async listCalls(
    fromDateTime: string,
    toDateTime: string,
    cursor?: string
  ): Promise<{ calls: GongCall[]; cursor?: string; totalRecords: number }> {
    const params = new URLSearchParams({ fromDateTime, toDateTime });
    if (cursor) params.set("cursor", cursor);

    const data = await this.request<{
      records?: { totalRecords?: number; currentPageSize?: number; cursor?: string };
      calls?: GongCall[];
    }>("GET", `/calls?${params.toString()}`);

    return {
      calls: data.calls || [],
      cursor: data.records?.cursor,
      totalRecords: data.records?.totalRecords || 0,
    };
  }

  /**
   * List all calls in a date range, auto-paginating. Caps pages to bound
   * latency and rate-limit usage; sets truncated=true when the cap is hit.
   */
  async listAllCalls(
    fromDateTime: string,
    toDateTime: string,
    maxPages = 20
  ): Promise<{ calls: GongCall[]; truncated: boolean; totalRecords: number }> {
    const all: GongCall[] = [];
    let cursor: string | undefined;
    let totalRecords = 0;
    let page = 0;
    do {
      const data = await this.listCalls(fromDateTime, toDateTime, cursor);
      all.push(...data.calls);
      totalRecords = data.totalRecords || totalRecords;
      cursor = data.cursor;
      page++;
    } while (cursor && page < maxPages);

    return { calls: all, truncated: Boolean(cursor), totalRecords };
  }

  /**
   * Detailed call data including participants, topics, trackers.
   * POST /v2/calls/extensive
   */
  async getCallDetails(callIds: string[]): Promise<GongCallDetailed[]> {
    const data = await this.request<{ calls?: GongCallDetailed[] }>(
      "POST",
      "/calls/extensive",
      {
        filter: { callIds },
        contentSelector: {
          exposedFields: {
            parties: true,
            content: {
              structure: true,
              topics: true,
              trackers: true,
              pointsOfInterest: true,
            },
            collaboration: { publicComments: true },
          },
        },
      }
    );
    return data.calls || [];
  }

  /**
   * Transcripts for calls. POST /v2/calls/transcript.
   * Auto-paginates over Gong's cursor in case the response is chunked.
   */
  async getTranscripts(callIds: string[]): Promise<GongCallTranscript[]> {
    const all: GongCallTranscript[] = [];
    let cursor: string | undefined;
    do {
      const body: Record<string, unknown> = { filter: { callIds } };
      if (cursor) body.cursor = cursor;
      const data = await this.request<{
        records?: { cursor?: string };
        callTranscripts?: GongCallTranscript[];
      }>("POST", "/calls/transcript", body);
      all.push(...(data.callTranscripts || []));
      cursor = data.records?.cursor;
    } while (cursor);
    return all;
  }

  /**
   * List all users, auto-paginating. GET /v2/users.
   */
  async listUsers(maxPages = 10): Promise<GongUser[]> {
    const all: GongUser[] = [];
    let cursor: string | undefined;
    let page = 0;
    do {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      const qs = params.toString();
      const data = await this.request<{
        records?: { cursor?: string };
        users?: GongUser[];
      }>("GET", `/users${qs ? `?${qs}` : ""}`);
      all.push(...(data.users || []));
      cursor = data.records?.cursor;
      page++;
    } while (cursor && page < maxPages);
    return all;
  }
}
