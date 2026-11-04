// Provider-neutral agent loop. The same tools run on:
//   - Claude (ANTHROPIC_API_KEY)                         via the Anthropic SDK tool runner
//   - Gemini (GEMINI_API_KEY, free tier)                 via Google's OpenAI-compatible endpoint
//   - Ollama (default; local or free cloud models)       via Ollama's OpenAI-compatible endpoint
//   - any other OpenAI-compatible server (AI_BASE_URL)
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/** A chat turn as the browser keeps it. Only text crosses the wire. */
export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  /** Optional base64 data URL attached to a user turn (e.g. a product photo). */
  image?: string;
};

export type AgentTool<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<string>;
};

/** One tool call the agent made, shown to the user as an activity step. */
export type AgentStep = { tool: string; input: unknown; output: string; error: boolean };

export const tool = <S extends z.ZodObject>(t: AgentTool<S>) => t as unknown as AgentTool;

type RunOpts = {
  system: string;
  tools: AgentTool[];
  history: ChatTurn[];
  effort?: "low" | "medium" | "high";
};

const MAX_STEPS = 12;

export function aiProvider() {
  if (process.env.AI_BASE_URL) {
    return { kind: "openai" as const, baseUrl: process.env.AI_BASE_URL, apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL ?? "" };
  }
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return { kind: "claude" as const, model: process.env.AI_MODEL ?? "claude-opus-5-5" };
  }
  if (process.env.GEMINI_API_KEY) {
    return {
      kind: "openai" as const,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.AI_MODEL ?? "gemini-flash-latest",
    };
  }
  return {
    kind: "openai" as const,
    baseUrl: process.env.OLLAMA_URL ?? "http://localhost:11434/v1",
    apiKey: "ollama",
    model: process.env.AI_MODEL ?? "gemma4:31b-cloud",
  };
}

function cleanHistory(history: ChatTurn[]) {
  const turns = history.slice(-20);
  // Every provider wants the conversation to open with a user turn.
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

function parseDataUrl(url?: string) {
  const m = url && /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(url);
  return m ? { mediaType: m[1] as "image/png", data: m[2] } : null;
}

export async function runAgent(opts: RunOpts): Promise<{ text: string; steps: AgentStep[] }> {
  const steps: AgentStep[] = [];
  const tools = opts.tools.map((t) => ({
    ...t,
    run: async (input: unknown) => {
      const output = await t.run(input as never);
      steps.push({ tool: t.name, input, output: output.slice(0, 500), error: output.startsWith("Error") });
      return output;
    },
  }));
  const p = aiProvider();
  const run = { ...opts, tools };
  const text = p.kind === "claude" ? await runClaude(run, p.model) : await runOpenAICompatible(run, p);
  return { text, steps };
}

// ---------- Claude ----------

async function runClaude(opts: RunOpts, model: string) {
  const client = new Anthropic();
  const messages = cleanHistory(opts.history).map((t) => {
    const img = t.role === "user" ? parseDataUrl(t.image) : null;
    return {
      role: t.role,
      content: img
        ? [
            { type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data } },
            { type: "text" as const, text: t.text || "Here's a photo of the product." },
          ]
        : t.text || "(no text)",
    };
  });

  const final = await client.beta.messages.toolRunner({
    model,
    max_tokens: 16000,
    max_iterations: MAX_STEPS,
    system: opts.system,
    tools: opts.tools.map((t) =>
      betaZodTool({ name: t.name, description: t.description, inputSchema: t.schema, run: (i) => t.run(i) }),
    ),
    messages,
    output_config: { effort: opts.effort ?? "medium" },
    // If a safety classifier declines, retry on the default fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (final.stop_reason === "refusal") return "Sorry — I can't help with that request.";
  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || "Done.";
}

// ---------- OpenAI-compatible (Gemini, Ollama, Groq, …) ----------

type OAIMessage =
  | { role: "system" | "user"; content: string | Array<Record<string, unknown>> }
  | { role: "assistant"; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OAIToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

async function runOpenAICompatible(opts: RunOpts, p: { baseUrl: string; apiKey?: string; model: string }) {
  const messages: OAIMessage[] = [{ role: "system", content: opts.system }];
  for (const t of cleanHistory(opts.history)) {
    const img = t.role === "user" ? parseDataUrl(t.image) : null;
    if (img) {
      messages.push({
        role: "user",
        content: [
          { type: "image_url", image_url: { url: t.image } },
          { type: "text", text: t.text || "Here's a photo of the product." },
        ],
      });
    } else {
      messages.push({ role: t.role, content: t.text || "(no text)" });
    }
  }

  const tools = opts.tools.map((t) => {
    const { $schema: _s, ...parameters } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    void _s;
    return { type: "function", function: { name: t.name, description: t.description, parameters } };
  });

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: p.model, messages, tools }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`AI provider error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const msg = data.choices?.[0]?.message as { content: string | null; tool_calls?: OAIToolCall[] } | undefined;
    if (!msg) throw new Error("AI provider returned no message");

    if (!msg.tool_calls?.length) {
      return (msg.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim() || "Done.";
    }

    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    const results = await Promise.all(
      msg.tool_calls.map(async (call) => {
        const t = opts.tools.find((x) => x.name === call.function.name);
        let content: string;
        if (!t) {
          content = `Error: unknown tool ${call.function.name}`;
        } else {
          let raw: unknown;
          try {
            raw = JSON.parse(call.function.arguments || "{}");
          } catch {
            raw = undefined;
          }
          const parsed = t.schema.safeParse(raw);
          content = parsed.success
            ? await t.run(parsed.data).catch((e: Error) => `Error: ${e.message}`)
            : `Error: invalid arguments — ${parsed.error.message}`;
        }
        return { role: "tool" as const, tool_call_id: call.id, content };
      }),
    );
    messages.push(...results);
  }
  return "Sorry, that took too many steps — could you rephrase?";
}
