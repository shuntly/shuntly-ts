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
