#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_DIR="/usr/lib/node_modules/openclaw"
STREAM_JS="$OPENCLAW_DIR/node_modules/@mariozechner/pi-ai/dist/stream.js"
SINK_PATH="/home/ubuntu/.openclaw/shuntly.jsonl"

echo "=== Installing shuntly into OpenClaw ==="

# 1. Install shuntly as a dependency inside openclaw
cd "$OPENCLAW_DIR"
npm install shuntly
echo "✓ shuntly installed"

# 2. Back up the original stream.js
if [ ! -f "$STREAM_JS.bak" ]; then
    cp "$STREAM_JS" "$STREAM_JS.bak"
    echo "✓ backed up stream.js → stream.js.bak"
else
    echo "⚠ stream.js.bak already exists, skipping backup"
fi

# 3. Write the patched stream.js
cat > "$STREAM_JS" << 'PATCH'
import "./providers/register-builtins.js";
import "./utils/http-proxy.js";
import { getApiProvider } from "./api-registry.js";
import { shunt, SinkFile } from "shuntly";
export { getEnvApiKey } from "./env-api-keys.js";

const _sink = new SinkFile("__SINK_PATH__");

function resolveApiProvider(api) {
    const provider = getApiProvider(api);
    if (!provider) {
        throw new Error(`No API provider registered for api: ${api}`);
    }
    return provider;
}

function _stream(model, context, options) {
    const provider = resolveApiProvider(model.api);
    return provider.stream(model, context, options);
}

async function _complete(model, context, options) {
    const s = _stream(model, context, options);
    return s.result();
}

function _streamSimple(model, context, options) {
    const provider = resolveApiProvider(model.api);
    return provider.streamSimple(model, context, options);
}

async function _completeSimple(model, context, options) {
    const s = _streamSimple(model, context, options);
    return s.result();
}

export const stream = shunt(_stream, _sink);
export const complete = shunt(_complete, _sink);
export const streamSimple = shunt(_streamSimple, _sink);
export const completeSimple = shunt(_completeSimple, _sink);
PATCH

# Replace the sink path placeholder
sed -i "s|__SINK_PATH__|$SINK_PATH|g" "$STREAM_JS"

echo "✓ patched stream.js"
echo ""
echo "=== Done ==="
echo "Shuntly will log all LLM calls to: $SINK_PATH"
echo "To revert: cp $STREAM_JS.bak $STREAM_JS"
echo "Restart OpenClaw to activate: openclaw gateway restart"