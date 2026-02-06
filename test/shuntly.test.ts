import { describe, it, expect } from "vitest";
import { shunt, ShuntlyRecord, Sink, SinkStream } from "../src/index.js";
import { Writable } from "stream";

// Helper to capture sink output
class TestSink implements Sink {
  records: ShuntlyRecord[] = [];

  write(record: ShuntlyRecord): void {
    this.records.push(record);
  }

  close(): void {}
}

// Mock Anthropic-like client
class MockMessages {
  create = async (params: {
    model: string;
    max_tokens: number;
    messages: unknown[];
  }) => {
    return {
      id: "msg_fake",
      content: [{ text: "hello" }],
      model: params.model,
    };
  };

  stream = async (params: {
    model: string;
    max_tokens: number;
    messages: unknown[];
  }) => {
    // Return an async iterable
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "content_block_delta", delta: { text: "hel" } };
        yield { type: "content_block_delta", delta: { text: "lo" } };
      },
    };
  };
}

class Anthropic {
  messages = new MockMessages();
}

// Mock OpenAI-like client
class MockCompletions {
  create = async (params: { model: string; messages: unknown[] }) => {
    return {
      id: "chatcmpl_fake",
      choices: [{ message: { content: "hello" } }],
    };
  };
}

class MockChat {
  completions = new MockCompletions();
}

class OpenAI {
  chat = new MockChat();
}

// Mock Google GenAI-like client
class MockModels {
  generateContent = async (params: { model: string; contents: string }) => {
    return {
      text: "hello from gemini",
      modelVersion: params.model,
    };
  };

  generateContentStream = async (params: {
    model: string;
    contents: string;
  }) => {
    return {
      async *[Symbol.asyncIterator]() {
        yield { text: "hel" };
        yield { text: "lo" };
      },
    };
  };
}

class GoogleGenAI {
  models = new MockModels();
}

describe("shunt", () => {
  describe("with Anthropic client", () => {
    it("returns the same object", () => {
      const sink = new TestSink();
      const client = new Anthropic();
      const result = shunt(client, sink);
      expect(result).toBe(client);
    });

    it("records calls", async () => {
      const sink = new TestSink();
      const client = shunt(new Anthropic(), sink);

      const resp = await client.messages.create({
        model: "claude-3",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      });

      expect(resp.id).toBe("msg_fake");
      expect(sink.records).toHaveLength(1);

      const record = sink.records[0];
      expect(record.client).toBe("Anthropic");
      expect(record.method).toBe("messages.create");
      expect(record.request).toEqual({
        model: "claude-3",
        max_tokens: 100,
        messages: [{ role: "user", content: "hi" }],
      });
      expect(record.error).toBeNull();
      expect(record.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("records errors", async () => {
      const sink = new TestSink();
      const client = new Anthropic();
      client.messages.create = async () => {
        throw new Error("API down");
      };
      shunt(client, sink);

      await expect(
        client.messages.create({
          model: "claude-3",
          max_tokens: 100,
          messages: [],
        }),
      ).rejects.toThrow("API down");

      expect(sink.records).toHaveLength(1);
      expect(sink.records[0].error).toBe("Error: API down");
      expect(sink.records[0].response).toBeNull();
    });
  });

  describe("with OpenAI client", () => {
    it("records calls", async () => {
      const sink = new TestSink();
      const client = shunt(new OpenAI(), sink);

      const resp = await client.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
      });

      expect(resp.id).toBe("chatcmpl_fake");
      expect(sink.records).toHaveLength(1);
      expect(sink.records[0].client).toBe("OpenAI");
      expect(sink.records[0].method).toBe("chat.completions.create");
    });
  });

  describe("with GoogleGenAI client", () => {
    it("records calls", async () => {
      const sink = new TestSink();
      const client = shunt(new GoogleGenAI(), sink);

      const resp = await client.models.generateContent({
        model: "gemini-2.0-flash",
        contents: "hi",
      });

      expect(resp.text).toBe("hello from gemini");
      expect(sink.records).toHaveLength(1);

      const record = sink.records[0];
      expect(record.client).toBe("GoogleGenAI");
      expect(record.method).toBe("models.generateContent");
      expect(record.request).toEqual({
        model: "gemini-2.0-flash",
        contents: "hi",
      });
      expect(record.error).toBeNull();
    });

    it("records streaming calls", async () => {
      const sink = new TestSink();
      const client = shunt(new GoogleGenAI(), sink);

      const stream = await client.models.generateContentStream({
        model: "gemini-2.0-flash",
        contents: "hi",
      });

      const chunks: unknown[] = [];
      for await (const chunk of stream as AsyncIterable<unknown>) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(sink.records).toHaveLength(1);

      const record = sink.records[0];
      expect(record.client).toBe("GoogleGenAI");
      expect(record.method).toBe("models.generateContentStream");
      expect(record.response).toEqual([{ text: "hel" }, { text: "lo" }]);
      expect(record.error).toBeNull();
    });

    it("records errors", async () => {
      const sink = new TestSink();
      const client = new GoogleGenAI();
      client.models.generateContent = async () => {
        throw new Error("quota exceeded");
      };
      shunt(client, sink);

      await expect(
        client.models.generateContent({
          model: "gemini-2.0-flash",
          contents: "hi",
        }),
      ).rejects.toThrow("quota exceeded");

      expect(sink.records).toHaveLength(1);
      expect(sink.records[0].error).toBe("Error: quota exceeded");
      expect(sink.records[0].response).toBeNull();
    });
  });

  describe("with custom methods", () => {
    it("patches specified methods", async () => {
      const sink = new TestSink();

      class MyClient {
        inner = {
          call: async (params: { prompt: string }) => "ok",
        };
      }

      const client = shunt(new MyClient(), sink, ["inner.call"]);

      const result = await client.inner.call({ prompt: "hi" });
      expect(result).toBe("ok");

      expect(sink.records).toHaveLength(1);
      expect(sink.records[0].method).toBe("inner.call");
      expect(sink.records[0].request).toEqual({ prompt: "hi" });
    });
  });

  describe("with unknown client", () => {
    it("throws without methods option", () => {
      class Unknown {}

      expect(() => shunt(new Unknown(), new TestSink())).toThrow(
        'Unknown client "Unknown"',
      );
    });
  });
});

describe("SinkStream", () => {
  it("writes JSON lines to stream", () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    const sink = new SinkStream(stream);
    const record = ShuntlyRecord.build({
      client: "Test",
      method: "test",
      request: { foo: "bar" },
      response: { result: 123 },
      durationMs: 42,
    });

    sink.write(record);

    expect(chunks).toHaveLength(1);
    const parsed = JSON.parse(chunks[0].trim());
    expect(parsed.client).toBe("Test");
    expect(parsed.method).toBe("test");
    expect(parsed.durationMs).toBe(42);
  });
});
