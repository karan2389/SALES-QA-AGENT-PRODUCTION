// Pure input validation for the call-type label and evaluation-invalidation admin actions (no Cloudflare types).
import { CALL_TYPES } from "./rubric.ts";

export const LABEL_VERIFICATIONS = ["human_confirmed", "unverified_test_override"] as const;
export const INVALIDATION_STATUSES = ["test_only", "invalidated", "superseded"] as const;
export type LabelVerification = (typeof LABEL_VERIFICATIONS)[number];
export type InvalidationStatus = (typeof INVALIDATION_STATUSES)[number];

export interface LabelInput {
  callType: string;
  labelledBy: string;
  basis: string | null;
  verification: LabelVerification;
}
export interface InvalidationInput {
  evaluationId: number;
  status: InvalidationStatus;
  reason: string;
  by: string;
}

export function validateLabelInput(q: { callType: string | null; labelledBy: string | null; basis: string | null; verification: string | null }): { ok: true; value: LabelInput } | { ok: false; error: string } {
  if (!q.callType || !CALL_TYPES.includes(q.callType)) return { ok: false, error: `call_type must be one of: ${CALL_TYPES.join(", ")}` };
  if (!q.labelledBy || q.labelledBy.trim() === "") return { ok: false, error: "labelled_by is required (who confirmed the call type)" };
  const verification = (q.verification ?? "human_confirmed") as LabelVerification;
  if (!LABEL_VERIFICATIONS.includes(verification)) return { ok: false, error: `verification must be one of: ${LABEL_VERIFICATIONS.join(", ")}` };
  if (verification === "human_confirmed" && (!q.basis || q.basis.trim() === "")) return { ok: false, error: "basis is required for a human-confirmed label (what the confirmation rests on)" };
  return { ok: true, value: { callType: q.callType, labelledBy: q.labelledBy.trim(), basis: q.basis?.trim() || null, verification } };
}

export const REVIEW_STATUSES = ["in_review", "approved", "changes_requested"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export interface ReviewInput {
  evaluationId: number;
  status: ReviewStatus;
  reviewer: string;
  comment: string | null;
}

/** A human review decision. The model output is never modified; the decision is stored separately (evaluation_reviews). */
export function validateReviewInput(q: { id: string; status: string | null; reviewer: string | null; comment: string | null }): { ok: true; value: ReviewInput } | { ok: false; error: string } {
  const id = Number(q.id);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "evaluation id must be a positive integer" };
  if (!q.status || !(REVIEW_STATUSES as readonly string[]).includes(q.status)) return { ok: false, error: `status must be one of: ${REVIEW_STATUSES.join(", ")}` };
  if (!q.reviewer || q.reviewer.trim() === "") return { ok: false, error: "reviewer is required (who reviewed it)" };
  if (q.status === "changes_requested" && (!q.comment || q.comment.trim() === "")) return { ok: false, error: "comment is required when requesting changes" };
  return { ok: true, value: { evaluationId: id, status: q.status as ReviewStatus, reviewer: q.reviewer.trim(), comment: q.comment?.trim() || null } };
}

export function validateInvalidationInput(q: { id: string; status: string | null; reason: string | null; by: string | null }): { ok: true; value: InvalidationInput } | { ok: false; error: string } {
  const id = Number(q.id);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "evaluation id must be a positive integer" };
  if (!q.status || !(INVALIDATION_STATUSES as readonly string[]).includes(q.status)) return { ok: false, error: `status must be one of: ${INVALIDATION_STATUSES.join(", ")}` };
  if (!q.reason || q.reason.trim() === "") return { ok: false, error: "reason is required" };
  if (!q.by || q.by.trim() === "") return { ok: false, error: "by is required (who invalidated it)" };
  return { ok: true, value: { evaluationId: id, status: q.status as InvalidationStatus, reason: q.reason.trim(), by: q.by.trim() } };
}
