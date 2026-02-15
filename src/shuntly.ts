import { ShuntlyRecord } from "./record.js";
import { Sink, SinkStream } from "./sinks.js";

type AnyFunction = (...args: unknown[]) => unknown;
type AnyObject = Record<string, unknown>;

const METHOD_REGISTRY: Map<string, string[]> = new Map([
  ["Anthropic", ["messages.create", "messages.stream"]],
  ["OpenAI", ["chat.completions.create"]],
  ["GoogleGenAI", ["models.generateContent", "models.generateContentStream"]],
]);

/**
 * Get the constructor/class name of an object.
 */
function getClientName(client: object): string {
  return client.constructor.name;
}

/**
 * Resolve a dotted path like 'messages.create' on an object.
 * Returns [func, parent, attrName] for patching.
 */
function resolveQualified(
  obj: object,
  path: string,
): [AnyFunction, object, string] {
  const parts = path.split(".");
  let parent: object = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    parent = (parent as AnyObject)[part] as object;
    if (parent === undefined || parent === null) {
      throw new Error(`Invalid method path: ${path}`);
    }
  }

  const attr = parts[parts.length - 1];
  const func = (parent as AnyObject)[attr] as AnyFunction;

  if (typeof func !== "function") {
    throw new Error(`${path} is not a function`);
  }

  return [func, parent, attr];
}

/**
 * Check if a value is a Promise.
 */
function isPromise(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "then" in value &&
    typeof (value as { then: unknown }).then === "function"
  );
}

/**
 * Check if a value is an async iterable (streaming response).
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null && typeof value === "object" && Symbol.asyncIterator in value
  );
}

/**
 * Wrap an async iterable to accumulate chunks while proxying iteration.
 *
 * Instead of replacing the iterable with a generator, this overrides
 * [Symbol.asyncIterator] on the original object. This preserves the object's
 * identity, prototype, and any extra methods (e.g. `.push()`, `.result()` on
 * pi-ai's push-based EventStream), which is critical when the producer holds
 * a reference to the original object and calls methods on it after creation.
 */
function wrapAsyncIterable(
  iterable: AsyncIterable<unknown>,
  onComplete: (chunks: unknown[]) => void,
  onError: (error: Error) => void,
): AsyncIterable<unknown> {
  const originalMethod = iterable[Symbol.asyncIterator].bind(iterable);
  let wrapped = false;

  (iterable as { [Symbol.asyncIterator]: () => AsyncIterator<unknown> })[
    Symbol.asyncIterator
  ] = function (): AsyncIterator<unknown> {
    // Only instrument the first iteration; subsequent calls get the original
    // iterator to avoid double-recording.
    if (wrapped) {
      return originalMethod();
    }
    wrapped = true;

    const iter = originalMethod();
    const chunks: unknown[] = [];

    return {
      async next(): Promise<IteratorResult<unknown>> {
        try {
          const result = await iter.next();
          if (result.done) {
            onComplete(chunks);
          } else {
            chunks.push(result.value);
          }
          return result;
        } catch (error) {
          onError(error as Error);
          throw error;
        }
      },
      async return(value?: unknown): Promise<IteratorResult<unknown>> {
        onComplete(chunks);
        return iter.return ? iter.return(value) : { value, done: true };
      },
      async throw(error?: unknown): Promise<IteratorResult<unknown>> {
        onError(error instanceof Error ? error : new Error(String(error)));
        if (iter.throw) return iter.throw(error);
        throw error;
      },
    };
  };

  return iterable;
}

/**
 * Create a wrapper function that records calls to sink.
 */
function createWrapper(
  func: AnyFunction,
  clientName: string,
  method: string,
  sink: Sink,
): AnyFunction {
  return function (this: unknown, ...args: unknown[]): unknown {
    const startTime = performance.now();
    let error: string | null = null;

    // Build request from args
    // Most SDK methods take a single options object
    const request: AnyObject =
      args.length === 1 && typeof args[0] === "object" && args[0] !== null
        ? (args[0] as AnyObject)
        : { args };

    const recordAndWrite = (response: unknown, err: string | null) => {
      const durationMs = performance.now() - startTime;
      const record = ShuntlyRecord.build({
        client: clientName,
        method,
        request,
        response,
        durationMs,
        error: err,
      });
      sink.write(record);
    };

    try {
      const result = func.apply(this, args);

      // Handle async (Promise) responses
      if (isPromise(result)) {
        return result.then(
          (resolved) => {
            // Check if the resolved value is an async iterable (streaming)
            if (isAsyncIterable(resolved)) {
              return wrapAsyncIterable(
                resolved,
                (chunks) => recordAndWrite(chunks, null),
                (err) => recordAndWrite(null, `${err.name}: ${err.message}`),
              );
            }
            recordAndWrite(resolved, null);
            return resolved;
          },
          (err: Error) => {
            error = `${err.name}: ${err.message}`;
            recordAndWrite(null, error);
            throw err;
          },
        );
      }

      // Handle sync async iterable (unlikely but possible)
      if (isAsyncIterable(result)) {
        return wrapAsyncIterable(
          result,
          (chunks) => recordAndWrite(chunks, null),
          (err) => recordAndWrite(null, `${err.name}: ${err.message}`),
        );
      }

      // Sync response
      recordAndWrite(result, null);
      return result;
    } catch (err) {
      error = `${(err as Error).name}: ${(err as Error).message}`;
      recordAndWrite(null, error);
      throw err;
    }
  };
}

/**
 * Derive a client name from a pi-ai-style model object.
 * If the first arg has string `provider` and `id` properties, returns "provider/id".
 * Otherwise returns "Unknown".
 */
function deriveClientName(firstArg: unknown): string {
  if (
    firstArg !== null &&
    typeof firstArg === "object" &&
    "provider" in firstArg &&
    "id" in firstArg &&
    typeof (firstArg as AnyObject).provider === "string" &&
    typeof (firstArg as AnyObject).id === "string"
  ) {
    return `${(firstArg as AnyObject).provider}/${(firstArg as AnyObject).id}`;
  }
  return "Unknown";
}

/**
 * Wrap an LLM client to record all API calls.
 */
export function shunt<T extends object>(
  client: T,
  sink?: Sink | null,
  methods?: string[],
): T;

/**
 * Wrap a standalone function (e.g. pi-ai's `complete` or `stream`) to record calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shunt<F extends (...args: any[]) => any>(
  fn: F,
  sink?: Sink | null,
): F;

export function shunt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOrFn: object | ((...args: any[]) => any),
  sink?: Sink | null,
  methods?: string[],
): unknown {
  const actualSink = sink ?? new SinkStream();

  // Standalone function overload, as with pi-ai
  if (typeof clientOrFn === "function" && methods === undefined) {
    const fn = clientOrFn as (...args: unknown[]) => unknown;
    const methodName = fn.name || "anonymous";

    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      const startTime = performance.now();
      const clientName = deriveClientName(args[0]);

      // Capture request: if 2+ args and args[1] is an object, use it; else fall back
      // if pi-ai, args are model, context
      const request: AnyObject =
        args.length >= 2 &&
        args[1] !== null &&
        typeof args[1] === "object" &&
        !Array.isArray(args[1])
          ? (args[1] as AnyObject)
          : { args };

      const recordAndWrite = (response: unknown, err: string | null) => {
        const durationMs = performance.now() - startTime;
        const record = ShuntlyRecord.build({
          client: clientName,
          method: methodName,
          request,
          response,
          durationMs,
          error: err,
        });
        actualSink.write(record);
      };

      try {
        const result = fn.apply(this, args);

        if (isPromise(result)) {
          return result.then(
            (resolved) => {
              if (isAsyncIterable(resolved)) {
                return wrapAsyncIterable(
                  resolved,
                  (chunks) => recordAndWrite(chunks, null),
                  (err) => recordAndWrite(null, `${err.name}: ${err.message}`),
                );
              }
              recordAndWrite(resolved, null);
              return resolved;
            },
            (err: Error) => {
              recordAndWrite(null, `${err.name}: ${err.message}`);
              throw err;
            },
          );
        }

        if (isAsyncIterable(result)) {
          return wrapAsyncIterable(
            result,
            (chunks) => recordAndWrite(chunks, null),
            (err) => recordAndWrite(null, `${err.name}: ${err.message}`),
          );
        }

        recordAndWrite(result, null);
        return result;
      } catch (err) {
        recordAndWrite(
          null,
          `${(err as Error).name}: ${(err as Error).message}`,
        );
        throw err;
      }
    };

    // Preserve function name for debugging
    Object.defineProperty(wrapper, "name", { value: methodName });
    return wrapper as typeof fn;
  }

  // Object/client wrapper
  const client = clientOrFn as object;
  const clientName = getClientName(client);
  if (!methods) {
    methods = METHOD_REGISTRY.get(clientName);
    if (!methods) {
      throw new Error(
        `Unknown client "${clientName}". Pass methods option to specify which methods to patch.`,
      );
    }
  }

  for (const method of methods) {
    const [func, parent, attr] = resolveQualified(client, method);
    const wrapper = createWrapper(func, clientName, method, actualSink);
    (parent as AnyObject)[attr] = wrapper;
  }

  return client;
}
