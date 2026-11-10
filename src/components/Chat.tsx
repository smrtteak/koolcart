"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";

export type Step = { tool: string; input: Record<string, unknown>; output: string; error: boolean };

export type Turn = {
  role: "user" | "assistant";
  text: string;
  image?: string;
  /** Tool calls the agent made for this reply. UI-only. */
  steps?: Step[];
  /** UI-only extras rendered under an assistant turn (e.g. a pay button). Not sent to the server. */
  extra?: ReactNode;
};

/** Lets the page push a message into the chat (e.g. from a product card button). */
export type ChatHandle = { send: (text: string) => void };

/** Downscale a photo in the browser so it's cheap to send to the model and store. */
async function shrinkImage(file: File, max = 640): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

const money = (v: unknown) => (typeof v === "number" ? `$${v.toFixed(2)}` : "");

/** Plain-language note for each thing the assistant did. `paypal` marks calls that touch payments. */
function describe(step: Step): { label: string; paypal?: boolean } {
  const i = step.input ?? {};
  switch (step.tool) {
    case "search_catalog":
      return { label: i.query ? `looked for “${i.query}”` : "checked the shelves" };
    case "get_product":
      return { label: "read the label" };
    case "evaluate_offer": {
      let verdict = "";
      try {
        const v = JSON.parse(step.output);
        verdict =
          v.verdict === "accept" ? `: yes at ${money(v.price)}` : v.verdict === "counter" ? `: countered ${money(v.counter)}` : ": no";
      } catch {}
      return { label: `asked the owner about ${money(i.offeredUnitPrice)}${verdict}` };
    }
    case "create_checkout":
      return { label: step.error ? "couldn't open checkout" : "opened a checkout", paypal: true };
    case "check_order_status":
      return { label: "checked the order", paypal: true };
    case "get_shop_overview":
      return { label: "looked over the books" };
    case "create_listing":
      return { label: `put “${i.title}” on the shelf`, paypal: true };
    case "update_listing":
      return { label: "touched up a listing" };
    case "delete_listing":
      return { label: "took a listing down" };
    case "list_orders":
      return { label: "flipped through orders" };
    case "refund_order":
      return {
        label: step.error ? "refund didn't go through" : `refunded${i.amount ? ` ${money(i.amount)}` : ""}`,
        paypal: true,
      };
    case "set_shop_name":
      return { label: `renamed the shop “${i.name}”` };
    default:
      return { label: step.tool };
  }
}

/** A handwritten margin note of what the assistant did before replying. */
function Steps({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 font-hand text-[17px] leading-snug text-muted">
      {steps.map((s, i) => {
        const { label, paypal } = describe(s);
        return (
          <span
            key={i}
            className={`animate-[fadeIn_.4s_ease-out_both] ${s.error ? "text-warn" : paypal ? "text-brand" : ""}`}
            style={{ animationDelay: `${i * 110}ms` }}
          >
            ✓ {label}
          </span>
        );
      })}
    </div>
  );
}

/** The shopkeeper's little avatar sticker. */
export function Orb({ size = 36, busy = false }: { size?: number; busy?: boolean }) {
  return (
    <span
      className={`sticker inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-display italic ${
        busy ? "animate-[wiggle_.6s_ease-in-out_infinite]" : ""
      }`}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      k
    </span>
  );
}

export function Chat({
  title,
  subtitle,
  intro,
  suggestions,
  allowImages,
  send,
  ref,
  className = "",
}: {
  title: string;
  subtitle?: string;
  intro: string;
  suggestions: string[];
  allowImages?: boolean;
  /** Called with the full history; returns the assistant reply, its steps and optional UI extras. */
  send: (history: Turn[]) => Promise<{ text: string; steps?: Step[]; extra?: ReactNode }>;
  ref?: Ref<ChatHandle>;
  className?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([{ role: "assistant", text: intro }]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function submit(text: string) {
    if ((!text.trim() && !image) || busy) return;
    const next: Turn[] = [...turns, { role: "user", text: text.trim(), image }];
    setTurns(next);
    setInput("");
    setImage(undefined);
    setBusy(true);
    try {
      const reply = await send(next);
      setTurns([...next, { role: "assistant", text: reply.text, steps: reply.steps, extra: reply.extra }]);
    } catch (e) {
      setTurns([...next, { role: "assistant", text: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(ref, () => ({ send: (text) => submit(text) }));

  return (
    <section className={`card flex flex-col overflow-hidden rounded-[24px] ${className}`}>
      <div className="flex items-center gap-3 border-b border-line-strong bg-background/70 px-5 py-3.5">
        <Orb busy={busy} />
        <div className="min-w-0">
          <div className="font-display text-2xl leading-none">{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-xs text-muted">{subtitle}</div>}
        </div>
        <span className="ml-auto font-hand text-lg text-ok">{busy ? "typing…" : "here"}</span>
      </div>

      <div ref={scroller} className="scrollbar-none flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex animate-[rise_.35s_ease-out_both] justify-end">
              <div className="max-w-[85%] rounded-[18px] rounded-br-sm border border-line-strong bg-brand px-4 py-2.5 text-sm text-paper">
                {t.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.image} alt="" className="mb-2 max-h-44 rounded-xl" />
                )}
                <div className="whitespace-pre-wrap">{t.text}</div>
              </div>
            </div>
          ) : (
            <div key={i} className="flex animate-[rise_.4s_ease-out_both] gap-3">
              <Orb size={26} />
              <div className="min-w-0 flex-1 pt-0.5 text-[14px] leading-relaxed">
                {t.steps && <Steps steps={t.steps} />}
                <div className="whitespace-pre-wrap text-foreground">{t.text}</div>
                {t.extra && <div className="mt-3">{t.extra}</div>}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-3">
            <Orb size={26} busy />
            <div className="flex gap-1">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink"
                  style={{ animationDelay: `${d * 140}ms` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {turns.length <= 1 && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto px-5 pb-3">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              className="shrink-0 rounded-full border border-dashed border-line px-3 py-1.5 text-xs text-muted transition hover:border-solid hover:border-line-strong hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="p-3 pt-0"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-[20px] border border-line-strong bg-background/60 p-1.5 transition focus-within:bg-paper focus-within:border-brand">
          {allowImages && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setImage(await shrinkImage(f));
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                title="Attach a product photo"
                onClick={() => fileInput.current?.click()}
                className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-paper text-muted transition hover:border-line-strong hover:text-ink"
              >
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="attached" className="h-full w-full object-cover" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                )}
              </button>
            </>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={1}
            placeholder={busy ? "one sec…" : "Write a message…"}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted"
          />
          <button
            aria-label="Send"
            disabled={busy || (!input.trim() && !image)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition hover:-rotate-12 active:scale-95 disabled:bg-surface-strong disabled:text-muted"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </form>
    </section>
  );
}

/** Strip UI-only fields before posting history to the server. */
export const wire = (turns: Turn[]) => turns.map(({ role, text, image }) => ({ role, text, image }));

export async function postJSON<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Poll an endpoint so the page stays live while another tab sells or lists things. */
export function useLive<T>(url: string, intervalMs = 4000, headers: Record<string, string> = {}) {
  const [data, setData] = useState<T>();
  const [tick, setTick] = useState(0);
  const headerKey = JSON.stringify(headers);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(url, { headers: JSON.parse(headerKey) })
        .then((r) => r.json())
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [url, intervalMs, tick, headerKey]);
  return { data, refresh: () => setTick((t) => t + 1) };
}
