#!/usr/bin/env node
import process from "node:process";
import readline from "node:readline";

const mode = process.argv[2] ?? "relevant";
const relevantTool = {
  name: "lookup_build_code",
  description: "Look up an opaque build code in the release database.",
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: { code: { type: "string", description: "Opaque lookup code." } },
    required: ["code"],
    additionalProperties: false,
  },
};
const domains = ["calendar", "email", "finance", "github", "image", "messaging", "music", "shipping", "social", "weather"];
const noisyTools = Array.from({ length: 40 }, (_, index) => ({
  name: `${domains[index % domains.length]}_catalog_${String(index + 1).padStart(2, "0")}`,
  description: `Unrelated ${domains[index % domains.length]} remote operation ${index + 1}. This optional integration includes detailed metadata and is irrelevant to the requested release database lookup.`,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-form remote catalog query." },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum records returned." },
      includeMetadata: { type: "boolean", description: "Include optional metadata fields." },
    },
    required: ["query"],
    additionalProperties: false,
  },
}));
const tools = mode === "noisy" ? noisyTools : [relevantTool];

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  let message;
  try { message = JSON.parse(line); }
  catch { continue; }
  if (message.id === undefined) continue;
  try {
    write({ jsonrpc: "2.0", id: message.id, result: handle(message) });
  } catch (error) {
    write({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: error.message } });
  }
}

function handle(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: `condiments-${mode}-evaluation`, version: "1.0.0" },
    };
  }
  if (message.method === "ping") return {};
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (mode === "relevant" && name === relevantTool.name && message.params?.arguments?.code === "ALPHA") {
      return { content: [{ type: "text", text: "TOKEN-SPLIT-OK-927" }], isError: false };
    }
    throw new Error(`Unknown or invalid tool call '${name}'.`);
  }
  throw new Error(`Unsupported method '${message.method}'.`);
}

function write(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
