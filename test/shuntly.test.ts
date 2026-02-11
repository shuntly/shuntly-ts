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

describe("with standalone functions", () => {
  it("records async function calls", async () => {
    const sink = new TestSink();

    async function complete(
      model: { provider: string; id: string },
      context: { systemPrompt: string; messages: unknown[] },
    ) {
      return { text: "hello from complete" };
    }

    const wrapped = shunt(complete, sink);

    const model = { provider: "openai", id: "gpt-4o-mini" };
    const context = {
      systemPrompt: "You are helpful.",
      messages: [{ role: "user", content: "hi" }],
    };

    const result = await wrapped(model, context);

    expect(result.text).toBe("hello from complete");
    expect(sink.records).toHaveLength(1);

    const record = sink.records[0];
    expect(record.client).toBe("openai/gpt-4o-mini");
    expect(record.method).toBe("complete");
    expect(record.request).toEqual(context);
    expect(record.error).toBeNull();
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records streaming (async iterable) calls", async () => {
    const sink = new TestSink();

    function stream(
      model: { provider: string; id: string },
      context: { systemPrompt: string; messages: unknown[] },
    ): AsyncIterable<unknown> {
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "text", text: "hel" };
          yield { type: "text", text: "lo" };
        },
      };
    }

    const wrapped = shunt(stream, sink);

    const model = { provider: "anthropic", id: "claude-3" };
    const context = {
      systemPrompt: "Be concise.",
      messages: [{ role: "user", content: "hi" }],
    };

    const chunks: unknown[] = [];
    for await (const chunk of wrapped(
      model,
      context,
    ) as AsyncIterable<unknown>) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(sink.records).toHaveLength(1);

    const record = sink.records[0];
    expect(record.client).toBe("anthropic/claude-3");
    expect(record.method).toBe("stream");
    expect(record.response).toEqual([
      { type: "text", text: "hel" },
      { type: "text", text: "lo" },
    ]);
    expect(record.error).toBeNull();
  });

  it("preserves extra methods on async iterables", async () => {
    const sink = new TestSink();

    function stream(model: { provider: string; id: string }, context: object) {
      const iterable = {
        async *[Symbol.asyncIterator]() {
          yield { type: "text", text: "hello" };
        },
        result: async () => ({
          role: "assistant",
          content: "hello",
        }),
      };
      return iterable;
    }

    const wrapped = shunt(stream, sink);

    const model = { provider: "openai", id: "gpt-4o-mini" };
    const s = wrapped(model, { messages: [] }) as AsyncIterable<unknown> & {
      result: () => Promise<unknown>;
    };

    // Consume the stream
    const chunks: unknown[] = [];
    for await (const chunk of s) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);

    // .result() should still be accessible
    expect(typeof s.result).toBe("function");
    const resultValue = await s.result();
    expect(resultValue).toEqual({ role: "assistant", content: "hello" });
  });

  it("derives client name from first arg provider/id", async () => {
    const sink = new TestSink();

    async function complete(model: unknown, context: unknown) {
      return "ok";
    }

    const wrapped = shunt(complete, sink);
    await wrapped({ provider: "google", id: "gemini-2.0" }, {});

    expect(sink.records[0].client).toBe("google/gemini-2.0");
  });

  it("uses 'Unknown' when first arg has no provider/id", async () => {
    const sink = new TestSink();

    async function complete(text: string) {
      return "ok";
    }

    const wrapped = shunt(complete, sink);
    await wrapped("hello");

    expect(sink.records[0].client).toBe("Unknown");
  });

  it("records errors from async functions", async () => {
    const sink = new TestSink();

    async function complete(
      model: { provider: string; id: string },
      context: object,
    ) {
      throw new Error("API down");
    }

    const wrapped = shunt(complete, sink);

    await expect(
      wrapped({ provider: "openai", id: "gpt-4o-mini" }, { messages: [] }),
    ).rejects.toThrow("API down");

    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].error).toBe("Error: API down");
    expect(sink.records[0].response).toBeNull();
    expect(sink.records[0].client).toBe("openai/gpt-4o-mini");
  });

  it("records errors from sync functions", () => {
    const sink = new TestSink();

    function compute(model: { provider: string; id: string }) {
      throw new Error("sync failure");
    }

    const wrapped = shunt(compute, sink);

    expect(() => wrapped({ provider: "openai", id: "gpt-4" })).toThrow(
      "sync failure",
    );

    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].error).toBe("Error: sync failure");
  });

  it("falls back to { args } when second arg is not an object", async () => {
    const sink = new TestSink();

    async function complete(model: unknown, count: number) {
      return "ok";
    }

    const wrapped = shunt(complete, sink);
    await wrapped({ provider: "openai", id: "gpt-4o-mini" }, 42);

    expect(sink.records[0].request).toEqual({
      args: [{ provider: "openai", id: "gpt-4o-mini" }, 42],
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
