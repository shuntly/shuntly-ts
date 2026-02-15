import { describe, it, expect } from "vitest";
import { Writable } from "stream";
import { shunt, SinkStream } from "../../src/index.js";
import {
  complete,
  completeSimple,
  stream,
  streamSimple,
  getModel,
  getEnvApiKey,
} from "@mariozechner/pi-ai";

const API_KEY = getEnvApiKey("anthropic");
const model = getModel("anthropic", "claude-haiku-4-5-20251001");

const maybe = API_KEY ? describe : describe.skip;

maybe("pi-ai adhoc", () => {
  it("captures complete record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });
    const wrapped = shunt(complete, new SinkStream(writable));

    const resp = await wrapped(model, {
      messages: [
        {
          role: "user",
          content: "Reply with the single word: pong",
          timestamp: Date.now(),
        },
      ],
    });

    // Assert on the live response
    expect(resp.role).toBe("assistant");
    const text = resp.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim()
      .toLowerCase();
    expect(text).toBe("pong");
    expect(["stop", "length"]).toContain(resp.stopReason);

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe(`${model.provider}/${model.id}`);
    expect(record.method).toBe("complete");
    expect(record.request.messages).toHaveLength(1);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(record.response.role).toBe("assistant");
  });

  it("captures stream record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });
    const wrapped = shunt(stream, new SinkStream(writable));

    const eventStream = wrapped(model, {
      messages: [
        {
          role: "user",
          content: "Reply with the four words: ping pong ping pong",
          timestamp: Date.now(),
        },
      ],
    });

    // Iterate events and extract text deltas
    const textParts: string[] = [];
    for await (const event of eventStream as AsyncIterable<
      Record<string, unknown>
    >) {
      const ev = event as { type: string; delta?: string };
      if (ev.type === "text_delta" && ev.delta) {
        textParts.push(ev.delta);
      }
    }

    const fullText = textParts.join("").trim().toLowerCase();
    expect(fullText).toBe("ping pong ping pong");

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe(`${model.provider}/${model.id}`);
    expect(record.method).toBe("stream");
    expect(record.request.messages).toHaveLength(1);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(Array.isArray(record.response)).toBe(true);
    expect(record.response.length).toBeGreaterThan(0);
  });

  it("captures completeSimple record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });
    const wrapped = shunt(completeSimple, new SinkStream(writable));

    const resp = await wrapped(model, {
      messages: [
        {
          role: "user",
          content: "Reply with the single word: pong",
          timestamp: Date.now(),
        },
      ],
    });

    expect(resp.role).toBe("assistant");
    const text = resp.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim()
      .toLowerCase();
    expect(text).toBe("pong");

    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe(`${model.provider}/${model.id}`);
    expect(record.method).toBe("completeSimple");
    expect(record.request.messages).toHaveLength(1);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(record.response.role).toBe("assistant");
  });

  it("captures streamSimple record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });
    const wrapped = shunt(streamSimple, new SinkStream(writable));

    const eventStream = wrapped(model, {
      messages: [
        {
          role: "user",
          content: "Reply with the four words: ping pong ping pong",
          timestamp: Date.now(),
        },
      ],
    });

    const textParts: string[] = [];
    for await (const event of eventStream as AsyncIterable<
      Record<string, unknown>
    >) {
      const ev = event as { type: string; delta?: string };
      if (ev.type === "text_delta" && ev.delta) {
        textParts.push(ev.delta);
      }
    }

    const fullText = textParts.join("").trim().toLowerCase();
    expect(fullText).toBe("ping pong ping pong");

    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe(`${model.provider}/${model.id}`);
    expect(record.method).toBe("streamSimple");
    expect(record.request.messages).toHaveLength(1);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(Array.isArray(record.response)).toBe(true);
    expect(record.response.length).toBeGreaterThan(0);
  });
});
