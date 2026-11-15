// Workers AI implementation of EvaluationModel for @cf/openai/gpt-oss-120b, via the existing `AI` binding.
// Input shape: chat `messages` plus `max_tokens`/`max_completion_tokens` and `reasoning_effort`, as typed by the installed
// @cloudflare/workers-types. The output shape is read defensively (see model-output.ts).
import { EvaluationModelError } from "./evaluate.ts";
import type { EvaluationModel, ModelRequest, ModelResponse } from "./evaluate.ts";
import { extractModelText } from "./model-output.ts";

export const GPT_OSS_MODEL_ID = "@cf/openai/gpt-oss-120b";

export interface GptOssOptions {
  maxOutputTokens?: number; // includes reasoning tokens
  reasoningEffort?: "low" | "medium" | "high";
  temperature?: number;
  timeoutMs?: number;
}

export function createGptOssModel(ai: Ai, opts: GptOssOptions = {}): EvaluationModel {
  const maxTokens = opts.maxOutputTokens ?? 20000;
  const timeoutMs = opts.timeoutMs ?? 280_000;
  return {
    id: GPT_OSS_MODEL_ID,
    async run(req: ModelRequest): Promise<ModelResponse> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new EvaluationModelError("timeout", `model did not respond within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      });
      try {
        const call = ai.run(GPT_OSS_MODEL_ID, {
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          max_tokens: maxTokens,
          max_completion_tokens: maxTokens,
          reasoning_effort: opts.reasoningEffort ?? "medium",
          temperature: opts.temperature ?? 0.1,
        });
        const out = await Promise.race([call, timeout]);
        const { text, finish, usage } = extractModelText(out);
        if (text.trim() === "") {
          const keys = out && typeof out === "object" ? Object.keys(out as object).join(",") : typeof out;
          throw new EvaluationModelError("empty_output", `model returned no final text (response keys: ${keys}; finish: ${finish ?? "n/a"})`);
        }
        return { text, finish_reason: finish, usage };
      } catch (e) {
        if (e instanceof EvaluationModelError) throw e;
        throw new EvaluationModelError("model_error", e instanceof Error ? e.message.slice(0, 300) : "Workers AI call failed");
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
