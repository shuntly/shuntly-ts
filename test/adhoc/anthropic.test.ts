import { describe, it, expect } from "vitest";
import { Writable } from "stream";
import { shunt, SinkStream } from "../../src/index.js";
import Anthropic from "@anthropic-ai/sdk";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-3-haiku-20240307";

const maybe = API_KEY ? describe : describe.skip;

maybe("anthropic adhoc", () => {
  it("captures non-streaming record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });
    const client = shunt(
      new Anthropic({ apiKey: API_KEY }),
      new SinkStream(writable),
    );

    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 32,
      messages: [
        { role: "user", content: "Reply with the single word: pong" },
      ],
    });

    // Assert on the live response
    expect(resp.id).toMatch(/^msg_/);
    expect(resp.model).toMatch(/^claude/);
    expect(["end_turn", "max_tokens"]).toContain(resp.stop_reason);
    const text =
      resp.content[0].type === "text"
        ? resp.content[0].text.toLowerCase()
        : "";
    expect(text).toBe("pong");

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe("Anthropic");
    expect(record.method).toBe("messages.create");
    expect(record.request.model).toBe(MODEL);
    expect(record.request.max_tokens).toBe(32);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(record.response.id).toMatch(/^msg_/);
    expect(record.response.content[0].text.toLowerCase()).toBe("pong");
  });

  it("captures streaming record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });
    const client = shunt(
      new Anthropic({ apiKey: API_KEY }),
      new SinkStream(writable),
    );

    const stream = await client.messages.create({
      model: MODEL,
      max_tokens: 32,
      stream: true,
      messages: [
        {
          role: "user",
          content: "Reply with the four words: ping pong ping pong",
        },
      ],
    });

    // Iterate events and extract text deltas
    const textParts: string[] = [];
    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      const ev = event as {
        type: string;
        delta?: { type: string; text?: string };
      };
      if (
        ev.type === "content_block_delta" &&
        ev.delta?.type === "text_delta" &&
        ev.delta.text
      ) {
        textParts.push(ev.delta.text);
      }
    }

    const fullText = textParts.join("").toLowerCase();
    expect(fullText).toBe("ping pong ping pong");

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe("Anthropic");
    expect(record.method).toBe("messages.create");
    expect(record.request.stream).toBe(true);
    expect(record.request.model).toBe(MODEL);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(Array.isArray(record.response)).toBe(true);
    expect(record.response.length).toBeGreaterThan(0);
  });
});
