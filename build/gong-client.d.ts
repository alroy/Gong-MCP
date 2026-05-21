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
        topics?: Array<{
            name: string;
            duration?: number;
        }>;
        trackers?: Array<{
            name: string;
            count?: number;
        }>;
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
export declare class GongClient {
    private baseUrl;
    private authHeader;
    constructor(config: GongConfig);
    private request;
    /**
     * Single-page call listing. Use listAllCalls to auto-paginate.
     * GET /v2/calls?fromDateTime=...&toDateTime=...
     */
    listCalls(fromDateTime: string, toDateTime: string, cursor?: string): Promise<{
        calls: GongCall[];
        cursor?: string;
        totalRecords: number;
    }>;
    /**
     * List all calls in a date range, auto-paginating. Caps pages to bound
     * latency and rate-limit usage; sets truncated=true when the cap is hit.
     */
    listAllCalls(fromDateTime: string, toDateTime: string, maxPages?: number): Promise<{
        calls: GongCall[];
        truncated: boolean;
        totalRecords: number;
    }>;
    /**
     * Detailed call data including participants, topics, trackers.
     * POST /v2/calls/extensive
     */
    getCallDetails(callIds: string[]): Promise<GongCallDetailed[]>;
    /**
     * Transcripts for calls. POST /v2/calls/transcript.
     * Auto-paginates over Gong's cursor in case the response is chunked.
     */
    getTranscripts(callIds: string[]): Promise<GongCallTranscript[]>;
    /**
     * List all users, auto-paginating. GET /v2/users.
     */
    listUsers(maxPages?: number): Promise<GongUser[]>;
}
