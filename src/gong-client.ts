/**
 * Gong API v2 client.
 *
 * Authentication: Basic auth using access key + secret key.
 * Base URL: https://api.gong.io/v2
 *
 * Endpoints used:
 *   GET  /v2/calls                  — list calls by date range
 *   POST /v2/calls/extensive        — get detailed call data with participants
 *   POST /v2/calls/transcript       — get call transcripts
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
  id: string;
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
  parties: GongParticipant[];
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
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new Error(
        `Gong API rate limited. Retry after ${retryAfter || "unknown"} seconds.`
      );
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gong API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * List calls within a date range.
   * GET /v2/calls?fromDateTime=...&toDateTime=...
   */
  async listCalls(
    fromDateTime: string,
    toDateTime: string,
    cursor?: string
  ): Promise<{ calls: GongCall[]; cursor?: string; totalRecords: number }> {
    let path = `/calls?fromDateTime=${encodeURIComponent(fromDateTime)}&toDateTime=${encodeURIComponent(toDateTime)}`;
    if (cursor) {
      path += `&cursor=${encodeURIComponent(cursor)}`;
    }

    const data = await this.request<{
      requestId: string;
      records: {
        totalRecords: number;
        currentPageSize: number;
        cursor?: string;
      };
      calls: Array<{
        id: string;
        title: string;
        started: string;
        duration: number;
        direction: string;
        primaryUserId: string;
        url: string;
      }>;
    }>("GET", path);

    return {
      calls: data.calls || [],
      cursor: data.records?.cursor,
      totalRecords: data.records?.totalRecords || 0,
    };
  }

  /**
   * Get detailed call data including participants.
   * POST /v2/calls/extensive
   */
  async getCallDetails(callIds: string[]): Promise<GongCallDetailed[]> {
    const data = await this.request<{
      requestId: string;
      records: { totalRecords: number; currentPageSize: number };
      calls: GongCallDetailed[];
    }>("POST", "/calls/extensive", {
      filter: { callIds },
      contentSelector: {
        exposedFields: {
          parties: true,
          content: {
            trackers: false,
            topics: true,
            pointsOfInterest: false,
          },
        },
      },
    });

    return data.calls || [];
  }

  /**
   * Get transcripts for calls.
   * POST /v2/calls/transcript
   */
  async getTranscripts(callIds: string[]): Promise<GongCallTranscript[]> {
    const data = await this.request<{
      requestId: string;
      records: {
        totalRecords: number;
        currentPageSize: number;
        cursor?: string;
      };
      callTranscripts: GongCallTranscript[];
    }>("POST", "/calls/transcript", {
      filter: { callIds },
    });

    return data.callTranscripts || [];
  }

  /**
   * List all calls in a date range, handling pagination automatically.
   */
  async listAllCalls(
    fromDateTime: string,
    toDateTime: string
  ): Promise<GongCall[]> {
    const allCalls: GongCall[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.listCalls(fromDateTime, toDateTime, cursor);
      allCalls.push(...page.calls);
      cursor = page.cursor;
    } while (cursor);

    return allCalls;
  }
}
