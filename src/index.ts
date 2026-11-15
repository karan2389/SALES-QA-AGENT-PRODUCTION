import type { Env } from "./env";
import { runExperiment } from "./experiment";
import { transcribeCall } from "./transcribe";
import { createD1Store, invalidateEvaluation, recordCallTypeLabel, recordReview } from "./evaluation/d1-store.ts";
import { validateInvalidationInput, validateLabelInput, validateReviewInput } from "./evaluation/labels.ts";
import { runExport, describeError } from "./sheets/export.ts";
import { createD1ExportStore } from "./sheets/d1-export-store.ts";
import { getAccessToken, parseServiceAccount } from "./sheets/google-auth.ts";
import type { FetchFn } from "./sheets/google-auth.ts";
import { createSheetsClient } from "./sheets/sheets-client.ts";
import { runEvaluation } from "./evaluation/evaluate.ts";
import { createGptOssModel } from "./evaluation/workers-ai-model.ts";
import { runMrv1Evaluation } from "./mrv1/engine.ts";
import { createMrv1Store } from "./mrv1/d1-store.ts";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // POST /admin/transcribe/<callyzer_call_id>  (requires Authorization: Bearer <ADMIN_TOKEN>)
    const m = url.pathname.match(/^\/admin\/transcribe\/([A-Za-z0-9_-]+)$/);
    if (m) {
      const auth = request.headers.get("authorization");
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("forbidden", { status: 403 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const result = await transcribeCall(env, m[1]);
      return Response.json(result, { status: result.ok ? 200 : 500 });
    }

    // POST /admin/experiment/<id>?label=..&vad=1&lang=hi&offset=..&length=..  (quality experiments; stored separately)
    const x = url.pathname.match(/^\/admin\/experiment\/([A-Za-z0-9_-]+)$/);
    if (x) {
      const auth = request.headers.get("authorization");
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("forbidden", { status: 403 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const q = url.searchParams;
      const label = q.get("label") ?? "";
      if (!/^[a-z0-9_]{1,40}$/.test(label)) return new Response("bad label", { status: 400 });
      const options: Record<string, unknown> = {};
      if (q.get("vad") === "1") options.vad_filter = true;
      if (q.get("lang")) options.language = q.get("lang");
      if (q.get("prompt")) options.initial_prompt = (q.get("prompt") as string).slice(0, 1500);
      const offset = Number(q.get("offset")), length = Number(q.get("length"));
      const range = q.has("offset") && Number.isFinite(offset) && Number.isFinite(length) && length > 0 ? { offset, length } : undefined;
      // source=body: the request body is the audio to transcribe (e.g. a WAV chunk); meta= is stored JSON about it.
      let audio: Uint8Array | undefined, meta: unknown;
      if (q.get("source") === "body") {
        audio = new Uint8Array(await request.arrayBuffer());
        try { meta = JSON.parse((q.get("meta") ?? "").slice(0, 1000) || "null"); } catch { return new Response("bad meta", { status: 400 }); }
      }
      const result = await runExperiment(env, x[1], { label, options, range, audio, meta });
      return Response.json(result, { status: result.ok ? 200 : 500 });
    }

    // POST /admin/call-type/<callyzer_call_id>?call_type=..&labelled_by=..&basis=..[&verification=human_confirmed|unverified_test_override]
    // Records the human-confirmed call-type label (history is kept; a new confirmed label supersedes the previous one).
    const ct = url.pathname.match(/^\/admin\/call-type\/([A-Za-z0-9_-]+)$/);
    if (ct) {
      const auth = request.headers.get("authorization");
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("forbidden", { status: 403 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const q = url.searchParams;
      const v = validateLabelInput({ callType: q.get("call_type"), labelledBy: q.get("labelled_by"), basis: q.get("basis"), verification: q.get("verification") });
      if (!v.ok) return Response.json({ status: "rejected", error: v.error }, { status: 400 });
      const call = await createD1Store(env.DB).loadCall(ct[1]);
      if (!call) return Response.json({ status: "rejected", error: "no call with that Callyzer id" }, { status: 404 });
      const rec = await recordCallTypeLabel(env.DB, call.id, v.value);
      return Response.json({ status: "recorded", call_id: call.id, call_type: v.value.callType, verification: v.value.verification, active: rec.active, label_id: rec.label_id });
    }

    // POST /admin/evaluation/<id>/invalidate?status=test_only|invalidated|superseded&reason=..&by=..
    // Marks an evaluation as not valid (kept for audit; never deleted or modified).
    const inv = url.pathname.match(/^\/admin\/evaluation\/(\d+)\/invalidate$/);
    if (inv) {
      const auth = request.headers.get("authorization");
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("forbidden", { status: 403 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const q = url.searchParams;
      const v = validateInvalidationInput({ id: inv[1], status: q.get("status"), reason: q.get("reason"), by: q.get("by") });
      if (!v.ok) return Response.json({ status: "rejected", error: v.error }, { status: 400 });
      const res = await invalidateEvaluation(env.DB, v.value);
      return res.ok ? Response.json({ status: "invalidated", evaluation_id: v.value.evaluationId, invalidation: v.value.status, call_id: res.call_id, call_status: res.call_status }) : Response.json({ status: "rejected", error: res.error }, { status: res.error === "evaluation not found" ? 404 : 409 });
    }

    // POST /admin/evaluation/<id>/review?status=in_review|approved|changes_requested&reviewer=..[&comment=..]
    // Records a human review decision separately from the model output. Exporting to Google Sheets never does this.
    const rev = url.pathname.match(/^\/admin\/evaluation\/(\d+)\/review$/);
    if (rev) {
      const auth = request.headers.get("authorization");
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("forbidden", { status: 403 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const q = url.searchParams;
      const v = validateReviewInput({ id: rev[1], status: q.get("status"), reviewer: q.get("reviewer"), comment: q.get("comment") });
      if (!v.ok) return Response.json({ status: "rejected", error: v.error }, { status: 400 });
      const res = await recordReview(env.DB, v.value);
      return res.ok ? Response.json({ status: "recorded", evaluation_id: v.value.evaluationId, human_review_status: res.status }) : Response.json({ status: "rejected", error: res.error }, { status: res.error === "evaluation not found" ? 404 : 409 });
    }

    // POST /admin/export/google-sheets?dry_run=1&agent=<name|id>&evaluation_id=<id>   (requires Authorization: Bearer <ADMIN_TOKEN>)
    // Exports VALID D1 evaluations to the existing Google spreadsheet (idempotent). dry_run=1 reads but never writes.
    if (url.pathname === "/admin/export/google-sheets") {
      const auth = request.headers.get("authorization");
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("forbidden", { status: 403 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const q = url.searchParams;
      const evalIdRaw = q.get("evaluation_id");
      const evaluationId = evalIdRaw === null ? null : Number(evalIdRaw);
      if (evaluationId !== null && (!Number.isInteger(evaluationId) || evaluationId <= 0)) return Response.json({ status: "rejected", error: "evaluation_id must be a positive integer" }, { status: 400 });
      if (!env.GOOGLE_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_JSON) return Response.json({ status: "not_configured", error: "GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_SPREADSHEET_ID must be set as Worker secrets" }, { status: 503 });
      try {
        const sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON);
        const fetchFn: FetchFn = (input, init) => fetch(input, init) as any;
        const sheets = createSheetsClient({ spreadsheetId: env.GOOGLE_SPREADSHEET_ID, getToken: () => getAccessToken(sa, fetchFn), fetchFn });
        const result = await runExport({ store: createD1ExportStore(env.DB), sheets }, { dryRun: q.get("dry_run") === "1", agent: q.get("agent"), evaluationId });
        const code = result.status === "success" || result.status === "dry_run" ? 200 : result.status === "busy" ? 409 : result.status === "rejected" ? 404 : result.status === "partial" ? 207 : 502;
        return Response.json(result, { status: code });
      } catch (e) {
        return Response.json({ status: "failed", error: describeError(e) }, { status: 502 });
      }
    }

    // POST /admin/evaluate/<callyzer_call_id>?call_type=..&labelled_by=..[&basis=..][&transcript=production|experiment:<label>][&replace=1][&dry_run=1][&acknowledge_conflict=1][&debug=1]
    // Evaluates one call with @cf/openai/gpt-oss-120b (Category 01 + 02). Requires Authorization: Bearer <ADMIN_TOKEN>.
    const ev = url.pathname.match(/^\/admin\/evaluate\/([A-Za-z0-9_-]+)$/);
    if (ev) {
      const auth = request.headers.get("authorization");
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("forbidden", { status: 403 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const q = url.searchParams;
      const transcriptSource = q.get("transcript") ?? "production";
      if (!/^(production|experiment:[a-z0-9_]{1,40})$/.test(transcriptSource)) return new Response("bad transcript source", { status: 400 });
      const result = await runEvaluation(
        { store: createD1Store(env.DB), model: createGptOssModel(env.AI) },
        { callyzerCallId: ev[1], callType: q.get("call_type"), labelledBy: q.get("labelled_by"), basis: q.get("basis"), transcriptSource, replace: q.get("replace") === "1", dryRun: q.get("dry_run") === "1", acknowledgeConflict: q.get("acknowledge_conflict") === "1" },
      );
      if (result.status === "failed" && q.get("debug") !== "1") delete result.raw_output; // raw model text only on request
      const status =
        result.status === "hold" ? 409
        : result.status !== "failed" ? 200
        : result.error_kind === "call_not_found" || result.error_kind === "transcript_missing" ? 404
        : ["malformed_json", "schema_invalid", "truncated", "empty_output"].includes(result.error_kind) ? 422
        : ["timeout", "model_error"].includes(result.error_kind) ? 502
        : 500;
      return Response.json(result, { status });
    }

    // POST /admin/mrv1/evaluate/<callyzer_call_id>?[transcript=production|experiment:<label>][&dry_run=1][&acknowledge_conflict=1][&debug=1]
    // Master Evaluation Rubric v1.0 (19 categories + separate Sales Psychology scorecard). The call type comes ONLY from the human-confirmed label on file.
    // Gated: recording, transcript, call type; four model passes; validation; stored pending human review. Requires Authorization: Bearer <ADMIN_TOKEN>.
    const mv = url.pathname.match(/^\/admin\/mrv1\/evaluate\/([A-Za-z0-9_-]+)$/);
    if (mv) {
      const auth = request.headers.get("authorization");
      if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("forbidden", { status: 403 });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      const q = url.searchParams;
      const transcriptSource = q.get("transcript") ?? "production";
      if (!/^(production|experiment:[a-z0-9_]{1,40})$/.test(transcriptSource)) return new Response("bad transcript source", { status: 400 });
      const result = await runMrv1Evaluation(
        { store: createMrv1Store(env.DB), model: createGptOssModel(env.AI) },
        { callyzerCallId: mv[1], transcriptSource, dryRun: q.get("dry_run") === "1", acknowledgeConflict: q.get("acknowledge_conflict") === "1" },
      );
      if (result.status === "failed" && q.get("debug") !== "1") delete result.raw_output;
      const status = result.status === "hold" ? 409 : result.status !== "failed" ? 200 : result.error_kind === "call_not_found" ? 404 : ["malformed_json", "schema_invalid", "truncated", "empty_output", "incomplete_output"].includes(result.error_kind) ? 422 : ["timeout", "model_error"].includes(result.error_kind) ? 502 : 500;
      return Response.json(result, { status });
    }

    return Response.json({ service: "sales-qa-agent", status: "ok", phase: 1 });
  },
} satisfies ExportedHandler<Env>;
