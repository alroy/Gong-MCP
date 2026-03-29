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
export class GongClient {
    baseUrl;
    authHeader;
    constructor(config) {
        this.baseUrl = config.baseUrl || "https://api.gong.io/v2";
        const credentials = Buffer.from(`${config.accessKey}:${config.secretKey}`).toString("base64");
        this.authHeader = `Basic ${credentials}`;
    }
    async request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        const options = {
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
            throw new Error(`Gong API rate limited. Retry after ${retryAfter || "unknown"} seconds.`);
        }
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Gong API error ${response.status}: ${text}`);
        }
        return response.json();
    }
    /**
     * List calls within a date range.
     * GET /v2/calls?fromDateTime=...&toDateTime=...
     */
    async listCalls(fromDateTime, toDateTime, cursor) {
        let path = `/calls?fromDateTime=${encodeURIComponent(fromDateTime)}&toDateTime=${encodeURIComponent(toDateTime)}`;
        if (cursor) {
            path += `&cursor=${encodeURIComponent(cursor)}`;
        }
        const data = await this.request("GET", path);
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
    async getCallDetails(callIds) {
        const data = await this.request("POST", "/calls/extensive", {
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
    async getTranscripts(callIds) {
        const data = await this.request("POST", "/calls/transcript", {
            filter: { callIds },
        });
        return data.callTranscripts || [];
    }
    /**
     * List all calls in a date range, handling pagination automatically.
     */
    async listAllCalls(fromDateTime, toDateTime) {
        const allCalls = [];
        let cursor;
        do {
            const page = await this.listCalls(fromDateTime, toDateTime, cursor);
            allCalls.push(...page.calls);
            cursor = page.cursor;
        } while (cursor);
        return allCalls;
    }
}
