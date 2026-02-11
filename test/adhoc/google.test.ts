import { describe, it, expect } from "vitest";
import { Writable } from "stream";
import { shunt, SinkStream } from "../../src/index.js";
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-2.0-flash";

const maybe = API_KEY ? describe : describe.skip;

maybe("google adhoc", () => {
  it("captures non-streaming record", async () => {
    const sinkLines: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        sinkLines.push(chunk.toString());
        callback();
      },
    });
    const client = shunt(
      new GoogleGenAI({ apiKey: API_KEY }),
      new SinkStream(writable),
    );

    const resp = await client.models.generateContent({
      model: MODEL,
      contents: "Reply with the single word: pong",
    });

    // Assert on the live response
    const text = (resp.text ?? "").trim().toLowerCase();
    expect(text).toBe("pong");

    // Assert on the captured record
    const record = JSON.parse(sinkLines[0].trim());
    expect(record.client).toBe("GoogleGenAI");
    expect(record.method).toBe("models.generateContent");
    expect(record.request.model).toBe(MODEL);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThan(0);
    expect(record.response).toBeTruthy();
  });
});
