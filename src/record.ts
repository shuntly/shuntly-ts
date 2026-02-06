import * as os from "os";

export interface ShuntlyRecordData {
  timestamp: string;
  hostname: string;
  user: string;
  pid: number;
  client: string;
  method: string;
  request: Record<string, unknown>;
  response: unknown;
  durationMs: number;
  error: string | null;
}

export class ShuntlyRecord {
  readonly timestamp: string;
  readonly hostname: string;
  readonly user: string;
  readonly pid: number;
  readonly client: string;
  readonly method: string;
  readonly request: Record<string, unknown>;
  readonly response: unknown;
  readonly durationMs: number;
  readonly error: string | null;

  constructor(data: ShuntlyRecordData) {
    this.timestamp = data.timestamp;
    this.hostname = data.hostname;
    this.user = data.user;
    this.pid = data.pid;
    this.client = data.client;
    this.method = data.method;
    this.request = data.request;
    this.response = data.response;
    this.durationMs = data.durationMs;
    this.error = data.error;
  }

  static build(params: {
    client: string;
    method: string;
    request: Record<string, unknown>;
    response: unknown;
    durationMs: number;
    error?: string | null;
  }): ShuntlyRecord {
    return new ShuntlyRecord({
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      user: os.userInfo().username,
      pid: process.pid,
      client: params.client,
      method: params.method,
      request: params.request,
      response: params.response,
      durationMs: params.durationMs,
      error: params.error ?? null,
    });
  }

  toJSON(): ShuntlyRecordData {
    return {
      timestamp: this.timestamp,
      hostname: this.hostname,
      user: this.user,
      pid: this.pid,
      client: this.client,
      method: this.method,
      request: this.request,
      response: serializeResponse(this.response),
      durationMs: this.durationMs,
      error: this.error,
    };
  }

  toJSONString(): string {
    return JSON.stringify(this.toJSON());
  }
}

/**
 * Serialize response objects that may have toJSON or similar methods.
 */
function serializeResponse(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj !== "object") {
    return obj;
  }
  // Handle objects with toJSON (standard JS convention)
  if (
    "toJSON" in obj &&
    typeof (obj as { toJSON: unknown }).toJSON === "function"
  ) {
    return (obj as { toJSON: () => unknown }).toJSON();
  }
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(serializeResponse);
  }
  // Plain object - recursively serialize
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = serializeResponse(value);
  }
  return result;
}
