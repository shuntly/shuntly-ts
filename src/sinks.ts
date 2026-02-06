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
    if (fd !== null) {
      try {
        fs.writeSync(fd, record.toJSONString() + "\n");
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EAGAIN" || code === "EPIPE") {
          // Buffer full or reader disconnected — drop it
          this.close();
        } else {
          throw err;
        }
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
