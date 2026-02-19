import { describe, it, expect } from "vitest";
import { Writable } from "stream";
import { shunt, SinkStream } from "../../src/index.js";
import { Ollama } from "ollama";

const API_KEY = process.env.OLLAMA_API_KEY;
const MODEL = "nemotron-3-nano:30b";

function makeClient(): Ollama {
  return new Ollama({
    host: "https://ollama.com",
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
}

const maybe = API_KEY ? describe : describe.skip;

maybe("ollama adhoc", () => {
  it("captures chat record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });

    const client = shunt(makeClient(), new SinkStream(writable));

    const response = await client.chat({
      model: MODEL,
      messages: [{ role: "user", content: "Reply with just the word: pong" }],
    });

    // Assert on the live response
    expect(response.message).toBeDefined();
    expect(response.message.content).toBeDefined();

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe("Ollama");
    expect(record.method).toBe("chat");
    expect(record.request.model).toBe(MODEL);
    expect(record.request.messages[0].content).toBe(
      "Reply with just the word: pong",
    );
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(record.response.message).toBeDefined();
  });

  it("captures generate record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });

    const client = shunt(makeClient(), new SinkStream(writable));

    const response = await client.generate({
      model: MODEL,
      prompt: "Reply with just the word: ping",
    });

    // Assert on the live response
    expect(response.response).toBeDefined();

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe("Ollama");
    expect(record.method).toBe("generate");
    expect(record.request.model).toBe(MODEL);
    expect(record.request.prompt).toBe("Reply with just the word: ping");
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(record.response.response).toBeDefined();
  });

  it("captures streaming chat record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });

    const client = shunt(makeClient(), new SinkStream(writable));

    const stream = await client.chat({
      model: MODEL,
      messages: [{ role: "user", content: "Count to 3" }],
      stream: true,
    });

    // Consume the streaming response
    const chunks = [];
    for await (const chunk of stream as AsyncIterable<
      Record<string, unknown>
    >) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => "message" in chunk)).toBe(true);

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe("Ollama");
    expect(record.method).toBe("chat");
    expect(record.request.model).toBe(MODEL);
    expect(record.request.stream).toBe(true);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(Array.isArray(record.response)).toBe(true);
    expect(record.response.length).toBeGreaterThan(0);
  });

  it("captures streaming generate record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });

    const client = shunt(makeClient(), new SinkStream(writable));

    const stream = await client.generate({
      model: MODEL,
      prompt: "Say hello",
      stream: true,
    });

    // Consume the streaming response
    const chunks = [];
    for await (const chunk of stream as AsyncIterable<
      Record<string, unknown>
    >) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe("Ollama");
    expect(record.method).toBe("generate");
    expect(record.request.model).toBe(MODEL);
    expect(record.request.stream).toBe(true);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(Array.isArray(record.response)).toBe(true);
    expect(record.response.length).toBeGreaterThan(0);
  });
});
