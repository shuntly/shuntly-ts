import { describe, it, expect } from "vitest";
import { Writable } from "stream";
import { shunt, SinkStream } from "../../src/index.js";
import OpenAI from "openai";

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = "gpt-4o-mini";

const maybe = API_KEY ? describe : describe.skip;

maybe("openai adhoc", () => {
  it("captures non-streaming record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });
    const client = shunt(
      new OpenAI({ apiKey: API_KEY }),
      new SinkStream(writable),
    );

    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "Reply with the single word: pong" }],
    });

    // Assert on the live response
    expect(resp.id).toMatch(/^chatcmpl-/);
    expect(resp.model).toMatch(/^gpt-/);
    expect(["stop", "length"]).toContain(resp.choices[0].finish_reason);
    const text = resp.choices[0].message.content!.toLowerCase().trim();
    expect(text).toBe("pong");

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe("OpenAI");
    expect(record.method).toBe("chat.completions.create");
    expect(record.request.model).toBe(MODEL);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(record.response.id).toMatch(/^chatcmpl-/);
    expect(
      record.response.choices[0].message.content.toLowerCase().trim(),
    ).toBe("pong");
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
      new OpenAI({ apiKey: API_KEY }),
      new SinkStream(writable),
    );

    const stream = await client.chat.completions.create({
      model: MODEL,
      stream: true,
      messages: [
        {
          role: "user",
          content: "Reply with the four words: ping pong ping pong",
        },
      ],
    });

    // Iterate chunks and extract text deltas
    const textParts: string[] = [];
    for await (const chunk of stream as AsyncIterable<
      Record<string, unknown>
    >) {
      const c = chunk as {
        choices: Array<{ delta: { content?: string | null } }>;
      };
      if (c.choices?.[0]?.delta?.content) {
        textParts.push(c.choices[0].delta.content);
      }
    }

    const fullText = textParts.join("").toLowerCase().trim();
    expect(fullText).toBe("ping pong ping pong");

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe("OpenAI");
    expect(record.method).toBe("chat.completions.create");
    expect(record.request.model).toBe(MODEL);
    expect(record.request.stream).toBe(true);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);

    // Response is the list of accumulated chunks
    expect(Array.isArray(record.response)).toBe(true);
    expect(record.response.length).toBeGreaterThan(0);

    const parts: string[] = [];
    for (const r of record.response) {
      const content = r.choices?.[0]?.delta?.content;
      if (content) {
        parts.push(content);
      }
    }
    expect(parts.join("").toLowerCase().trim()).toBe("ping pong ping pong");
  });
});
