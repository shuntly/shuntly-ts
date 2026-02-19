import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ShuntlyRecord, SinkRotating, SinkStream } from "../src/index.js";
import { Writable } from "stream";

function makeRecord(): ShuntlyRecord {
  return ShuntlyRecord.build({
    client: "test.Client",
    method: "do.thing",
    request: { a: 1 },
    response: { b: 2 },
    durationMs: 5.0,
  });
}

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

describe("SinkRotating", () => {
  function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "shuntly-test-"));
  }

  function jsonlFiles(dir: string): string[] {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  }

  it("writes to directory", () => {
    const dir = makeTmpDir();
    try {
      const sink = new SinkRotating(dir);
      sink.write(makeRecord());
      sink.close();
      const files = jsonlFiles(dir);
      expect(files).toHaveLength(1);
      const data = JSON.parse(
        fs.readFileSync(path.join(dir, files[0]), "utf-8").trim(),
      );
      expect(data.client).toBe("test.Client");
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it("rotates on maxBytesFile", () => {
    const dir = makeTmpDir();
    try {
      const sink = new SinkRotating(dir, {
        maxBytesFile: 50,
        maxBytesDir: 0, // no pruning
      });
      for (let i = 0; i < 5; i++) {
        sink.write(makeRecord());
      }
      sink.close();
      expect(jsonlFiles(dir).length).toBeGreaterThan(1);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it("prunes old files", () => {
    const dir = makeTmpDir();
    try {
      const sink = new SinkRotating(dir, {
        maxBytesFile: 50,
        maxBytesDir: 500,
      });
      for (let i = 0; i < 20; i++) {
        sink.write(makeRecord());
      }
      sink.close();
      const files = jsonlFiles(dir);
      const total = files.reduce(
        (sum, f) => sum + fs.statSync(path.join(dir, f)).size,
        0,
      );
      expect(total).toBeLessThanOrEqual(1500);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it("creates nested directories", () => {
    const dir = makeTmpDir();
    const nested = path.join(dir, "sub", "dir");
    try {
      const sink = new SinkRotating(nested);
      sink.write(makeRecord());
      sink.close();
      expect(fs.existsSync(nested)).toBe(true);
      expect(jsonlFiles(nested)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it("close is idempotent", () => {
    const dir = makeTmpDir();
    try {
      const sink = new SinkRotating(dir);
      sink.write(makeRecord());
      sink.close();
      sink.close(); // should not throw
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it("does not prune when disabled", () => {
    const dir = makeTmpDir();
    try {
      const sink = new SinkRotating(dir, {
        maxBytesFile: 50,
        maxBytesDir: 0,
      });
      for (let i = 0; i < 10; i++) {
        sink.write(makeRecord());
      }
      sink.close();
      expect(jsonlFiles(dir).length).toBeGreaterThan(1);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});
