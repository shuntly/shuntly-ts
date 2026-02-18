import { execFileSync } from "child_process";
import * as constants from "constants";
import * as fs from "fs";
import { ShuntlyRecord } from "./record.js";

export interface Sink {
  write(record: ShuntlyRecord): void;
  close(): void;
}

/**
 * Writes records to a stream (defaults to stderr).
 */
export class SinkStream implements Sink {
  private stream: NodeJS.WritableStream;

  constructor(stream?: NodeJS.WritableStream) {
    this.stream = stream ?? process.stderr;
  }

  write(record: ShuntlyRecord): void {
    this.stream.write(record.toJSONString() + "\n");
  }

  close(): void {
    // Don't close stderr/stdout
  }
}

/**
 * Appends records to a file in JSONL format.
 */
export class SinkFile implements Sink {
  private path: string;
  private fd: number | null = null;

  constructor(path: string) {
    this.path = path;
  }

  private ensureOpen(): number {
    if (this.fd === null) {
      this.fd = fs.openSync(this.path, "a");
    }
    return this.fd;
  }

  write(record: ShuntlyRecord): void {
    const fd = this.ensureOpen();
    fs.writeSync(fd, record.toJSONString() + "\n");
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

/**
 * Writes records to a named pipe (FIFO). Fails gracefully if no reader is
 * connected or the reader disconnects.
 */
export class SinkPipe implements Sink {
  private path: string;
  private fd: number | null = null;

  constructor(path: string) {
    this.path = path;
  }

  private ensureOpen(): number | null {
    if (this.fd !== null) {
      return this.fd;
    }

    if (!fs.existsSync(this.path)) {
      execFileSync("mkfifo", [this.path]);
    } else {
      const stat = fs.statSync(this.path);
      if (!stat.isFIFO()) {
        throw new Error(`${this.path} exists and is not a FIFO`);
      }
    }

    try {
      this.fd = fs.openSync(
        this.path,
        constants.O_WRONLY | constants.O_NONBLOCK,
      );
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENXIO") {
        // No reader connected
        return null;
      }
      throw err;
    }

    return this.fd;
  }

  write(record: ShuntlyRecord): void {
    const fd = this.ensureOpen();
    if (fd === null) {
      return;
    }

    const data = Buffer.from(record.toJSONString() + "\n");
    let offset = 0;

    while (offset < data.length) {
      try {
        const written = fs.writeSync(fd, data, offset);
        offset += written;
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EAGAIN") {
          // Buffer full — retry
          continue;
        }
        if (code === "EPIPE") {
          // Reader disconnected
          this.close();
          return;
        }
        throw err;
      }
    }
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

/**
 * Writes JSONL files into a directory with automatic rotation and pruning.
 *
 * Each file is named with an ISO-8601 timestamp (e.g.
 * `2025-02-15T210530.482371Z.jsonl`). A new file is started when the current
 * file reaches `maxBytesFile`. Old files are removed when total directory
 * size exceeds `maxBytesDir` (oldest first).
 */
export class SinkRotating implements Sink {
  private static readonly DEFAULT_MAX_BYTES_FILE = 10 * 1024 * 1024; // 10 MB
  private static readonly DEFAULT_MAX_BYTES_DIR = 100 * 1024 * 1024; // 100 MB

  private directory: string;
  private maxBytesFile: number;
  private maxBytesDir: number;
  private fd: number | null = null;
  private filePath: string | null = null;
  private fileSize: number = 0;

  constructor(
    directory: string,
    options?: {
      maxBytesFile?: number;
      maxBytesDir?: number;
    },
  ) {
    this.directory = directory;
    this.maxBytesFile =
      options?.maxBytesFile ?? SinkRotating.DEFAULT_MAX_BYTES_FILE;
    this.maxBytesDir =
      options?.maxBytesDir ?? SinkRotating.DEFAULT_MAX_BYTES_DIR;
    fs.mkdirSync(directory, { recursive: true });
  }

  private static makeFilename(): string {
    const now = new Date();
    const pad = (n: number, w: number = 2) => String(n).padStart(w, "0");
    const ts =
      `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
      `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}` +
      `.${pad(now.getUTCMilliseconds(), 3)}${pad(Math.floor(Math.random() * 1000), 3)}Z`;
    return `${ts}.jsonl`;
  }

  private openNewFile(): number {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
    }
    const name = SinkRotating.makeFilename();
    this.filePath = `${this.directory}/${name}`;
    this.fd = fs.openSync(this.filePath, "a");
    this.fileSize = 0;
    return this.fd;
  }

  private prune(): void {
    if (this.maxBytesDir <= 0) {
      return;
    }
    const entries: { path: string; size: number }[] = [];
    for (const entry of fs.readdirSync(this.directory)) {
      if (!entry.endsWith(".jsonl")) continue;
      const full = `${this.directory}/${entry}`;
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        entries.push({ path: full, size: stat.size });
      }
    }
    // Sort oldest first (filenames are ISO timestamps)
    entries.sort((a, b) => a.path.localeCompare(b.path));
    let total = entries.reduce((sum, e) => sum + e.size, 0);
    while (total > this.maxBytesDir && entries.length > 0) {
      const oldest = entries[0];
      // Don't delete the current file
      if (oldest.path === this.filePath) {
        break;
      }
      fs.unlinkSync(oldest.path);
      total -= oldest.size;
      entries.shift();
    }
  }

  private ensureOpen(): number {
    if (this.fd === null) {
      return this.openNewFile();
    }
    if (this.fileSize >= this.maxBytesFile) {
      this.prune();
      return this.openNewFile();
    }
    return this.fd;
  }

  write(record: ShuntlyRecord): void {
    const fd = this.ensureOpen();
    const line = record.toJSONString() + "\n";
    fs.writeSync(fd, line);
    this.fileSize += Buffer.byteLength(line);
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
      this.filePath = null;
      this.fileSize = 0;
    }
  }
}

/**
 * Writes to multiple sinks.
 */
export class SinkMany implements Sink {
  private sinks: Sink[];

  constructor(sinks: Sink[]) {
    this.sinks = sinks;
  }

  write(record: ShuntlyRecord): void {
    for (const sink of this.sinks) {
      sink.write(record);
    }
  }

  close(): void {
    for (const sink of this.sinks) {
      sink.close();
    }
  }
}
