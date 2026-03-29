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
export declare class GongClient {
    private baseUrl;
    private authHeader;
    constructor(config: GongConfig);
    private request;
    /**
     * List calls within a date range.
     * GET /v2/calls?fromDateTime=...&toDateTime=...
     */
    listCalls(fromDateTime: string, toDateTime: string, cursor?: string): Promise<{
        calls: GongCall[];
        cursor?: string;
        totalRecords: number;
    }>;
    /**
     * Get detailed call data including participants.
     * POST /v2/calls/extensive
     */
    getCallDetails(callIds: string[]): Promise<GongCallDetailed[]>;
    /**
     * Get transcripts for calls.
     * POST /v2/calls/transcript
     */
    getTranscripts(callIds: string[]): Promise<GongCallTranscript[]>;
    /**
     * List all calls in a date range, handling pagination automatically.
     */
    listAllCalls(fromDateTime: string, toDateTime: string): Promise<GongCall[]>;
}
