// Pure helper (no Cloudflare types): pull the final text out of whichever layout the model returned.

function textOfContent(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("");
  return "";
}

/** Final text (never the reasoning) from chat-completions, Responses-style, or legacy `response` layouts. */
export function extractModelText(out: unknown): { text: string; finish: string | null; usage: unknown } {
  const o = out as any;
  if (Array.isArray(o?.choices) && o.choices[0]) {
    const ch = o.choices[0];
    return { text: textOfContent(ch.message?.content ?? ch.text), finish: ch.finish_reason ?? null, usage: o.usage ?? null };
  }
  if (typeof o?.output_text === "string" && o.output_text) return { text: o.output_text, finish: o.status === "incomplete" ? "length" : null, usage: o.usage ?? null };
  if (Array.isArray(o?.output)) {
    const text = o.output
      .filter((i: any) => i?.type === "message")
      .map((i: any) => textOfContent(i.content))
      .join("");
    const incomplete = o.status === "incomplete" || o.incomplete_details?.reason === "max_output_tokens";
    return { text, finish: incomplete ? "length" : null, usage: o.usage ?? null };
  }
  if (typeof o?.response === "string") return { text: o.response, finish: null, usage: o.usage ?? null };
  return { text: "", finish: null, usage: o?.usage ?? null };
}
