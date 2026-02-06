# Shuntly

| | CI | Package |
|---|---|---|
| Python | [![CI](https://img.shields.io/github/actions/workflow/status/shuntly/shuntly-py/ci.yml?branch=default&label=CI&logo=Github)](https://github.com/shuntly/shuntly-py/actions/workflows/ci.yml) | [![PyPI](https://img.shields.io/pypi/v/shuntly?label=PyPI&logo=pypi)](https://pypi.org/project/shuntly/) |
| TypeScript | [![CI](https://img.shields.io/github/actions/workflow/status/shuntly/shuntly-ts/ci.yml?branch=main&label=CI&logo=Github)](https://github.com/shuntly/shuntly-ts/actions/workflows/ci.yml) | [![NPM](https://img.shields.io/npm/v/shuntly?label=NPM&logo=npm)](https://www.npmjs.com/package/shuntly) |


A lightweight wiretap for LLM SDKs: capture all requests and responses with a single line of code.

Shuntly wraps LLM SDKs to record every request and response as JSON. Calling `shunt()` wraps and returns a client with its original interface and types preserved, permitting consistent IDE autocomplete and type checking. Shuntly provides a collection of configurable "sinks" to write records to stderr, files, named pipes, or any combination.

While debugging LLM tooling, maybe you want to see exactly what is being sent and returned. When launching an agent, maybe you want to record every call to the LLM. Shuntly can capture it all without TLS interception, a web-based platform, or complicated logging infrastructure.

## Install

```
npm install shuntly
```

## Integrate

Given an LLM SDK (e.g. [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk), [`openai`](https://www.npmjs.com/package/openai), [`@google/genai`](https://www.npmjs.com/package/@google/genai)), simply call `shunt()` with the instantiated SDK class. The returned object has the same type and interface.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { shunt } from "shuntly";

// Without providing a sink Shuntly output goes to stderr
const client = shunt(new Anthropic({ apiKey: API_KEY }));

// Now use the client as before
const message = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});
```

Each call to `messages.create()` writes a complete JSON record:

```json
{
  "timestamp": "2025-01-15T12:00:00.000Z",
  "hostname": "dev1",
  "user": "alice",
  "pid": 42,
  "client": "Anthropic",
  "method": "messages.create",
  "request": {
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{ "role": "user", "content": "Hello" }]
  },
  "response": {
    "id": "msg_...",
    "content": [{ "type": "text", "text": "Hi!" }]
  },
  "durationMs": 823.4,
  "error": null
}
```

## View

Shuntly JSON output can be streamed or read with a JSON viewer like [`fx`](https://fx.wtf). These tools provide JSON syntax highlighting and collapsible sections.

### View Realtime Shuntly from `stderr`

Shuntly output, by default, goes to `stderr`; this is equivalent to providing a `SinkStream` to `shunt()`:

```typescript
import { shunt, SinkStream } from "shuntly";
const client = shunt(new Anthropic({ apiKey: API_KEY }), new SinkStream());
```

Given a `command`, you can view Shuntly `stderr` output in `fx` with the following:

```bash
$ command 2>&1 >/dev/null | fx
```

### View Realtime Shuntly via a Pipe

To view Shuntly output via a named pipe in another terminal, the `SinkPipe` sink can be used. First, name the pipe when providing `SinkPipe` to `shunt()`:

```typescript
import { shunt, SinkPipe } from "shuntly";
const client = shunt(
  new Anthropic({ apiKey: API_KEY }),
  new SinkPipe("/tmp/shuntly.fifo"),
);
```

Then, in a terminal to view Shuntly output, create the named pipe and provide it to `fx`

```bash
$ mkfifo /tmp/shuntly.fifo; fx < /tmp/shuntly.fifo
```

Then, in another terminal, launch your command.

### View Shuntly from a File

To store Shuntly output in a file, the `SinkFile` sink can be used. Name the file when providing `SinkFile` to `shunt()`:

```typescript
import { shunt, SinkFile } from "shuntly";
const client = shunt(
  new Anthropic({ apiKey: API_KEY }),
  new SinkFile("/tmp/shuntly.jsonl"),
);
```

Then, after your command is complete, view the file:

```bash
$ fx /tmp/shuntly.jsonl
```

### Send Shuntly Output to Multiple Sinks

Using `SinkMany`, multiple sinks can be written to simultaneously.

```typescript
import { shunt, SinkStream, SinkFile, SinkMany } from "shuntly";

const client = shunt(
  new Anthropic(),
  new SinkMany([new SinkStream(), new SinkFile("/tmp/shuntly.jsonl")]),
);
```

### Custom Sinks

Custom sinks can be implemented by implementing the `Sink` interface:

```typescript
import { Sink, ShuntlyRecord } from "shuntly";

class SinkConsole implements Sink {
  write(record: ShuntlyRecord): void {
    console.log(record.client, record.method, record.durationMs);
  }
  close(): void {}
}
```

## Supported SDKs

Shuntly presently handles these clients:

| Client        | Package                                                  | Methods                                                  |
| ------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `Anthropic`   | [`npm`](https://www.npmjs.com/package/@anthropic-ai/sdk) | `messages.create`, `messages.stream`                     |
| `OpenAI`      | [`npm`](https://www.npmjs.com/package/openai)            | `chat.completions.create`                                |
| `GoogleGenAI` | [`npm`](https://www.npmjs.com/package/@google/genai)     | `models.generateContent`, `models.generateContentStream` |

For anything else, method paths can be explicitly provided:

```typescript
const client = shunt(myClient, null, ["chat.send", "embeddings.create"]);
```

## What is New in Shuntly

### 0.5.0

Corrected interleaved writes in `SinkPipe`.


### 0.4.0

Added README.md, ci.yml, and additional configuration.

### 0.3.0

Initial release.
