# FlexiFunnels Sales Call Evaluation Rubric — v1, Revision 4

Status (Revision 4): **Category 01 approved by the project owner on 2026-11-14** (after the corrections recorded in §11). **Category 02 — Understanding Intent (§12) approved by the project owner on 2026-11-14**, after being revised to incorporate the owner's decisions on U02-01 to U02-16. **Call-type applicability and identification (U2, U3; §13) approved by the project owner on 2026-11-14.** The rubric as a whole remains a draft. No overall score, no category weights, no other categories. Nothing in this document is implemented in code.

## 1. Project objective and scope

**Objective.** Define how a sales call by the FlexiFunnels Senior Mentoring Team is judged against the team's own approved sales process, in a way that two independent reviewers (human or LLM) can reach similar conclusions and that every judgement can be traced to evidence in the call.

**Scope of this version.** Category 01 — Introduction (three criteria), applying to **new webinar-attendee prospect calls** (decision Q1). The evaluator (Claude Sonnet) is **not** built; this rubric is the specification it will eventually be given and that humans can use today. Category 02 — Understanding Intent is added in §12 (approved 2026-11-14).

**Out of scope.** Checklist categories 03 onward (not started), an overall call score, category weights, any database or API design, any change to transcription, and rubrics for renewal, follow-up and continuation calls (call-type applicability is defined in §13; separate rubrics are future work).

**Design principles.**
1. Judge the *behaviour and its meaning in context*, never the presence of a keyword.
2. Hindi, English and Hinglish are equally acceptable; different wording is fine if the intended behaviour is clearly demonstrated.
3. Every score is backed by a timestamp range, transcript evidence and a short explanation. Where behaviour is present the evidence is an exact quotation; where it is absent the evidence is the record defined in §6.2. The evaluator never fabricates a quotation.
4. The transcript is a machine product with known Hindi-English errors; it is evidence, not proof.
5. Ethical conduct: honest, respectful, informed-decision selling is what is assessed. The rubric rewards no misleading or manipulative behaviour and scores no personal characteristic of a prospect.

## 2. Source documents used

| # | Document | Provenance | Used for |
|---|---|---|---|
| S1 | *Sales Call Checklist – FlexiFunnels Senior Mentoring Team* | **Provided as text in the project conversation.** No file metadata is recorded for it. | **Authority** for Category 01, section 1 "Introduction": (a) "Introduce yourself & team (Senior Mentoring Team, FlexiFunnels)", (b) "Purpose of the call (Selected for an exclusive 1:1 session)", (c) "Set expectations (20-minute personalised solution)". |
| S2 | *Sales Call Journey, Leading Questions & USPs* | Uploaded PDF (file name as supplied: "Sales Call Journey, Leading Questions & USPs (1).pdf"). | Reference **script wording** for the intro (below); confirms the sequence Intro → Desire (discovery). |
| S3 | *OBJECTIONS* | Uploaded PDF ("OBJECTIONS.pdf"). | **No Introduction content.** Read only for conduct and honesty context (see §9, Q11). |

Reference wording for the intro, from S2 (the approved script; a rep is not required to repeat it verbatim):
> "Hi, this is [NAME]. I am calling from the senior mentoring team of FlexiFunnels."
> "The reason behind my call is we have selected 20 people who attended the webinar for a personalised 1-1 call and you are one of them. For the next 20 minutes, I am here to understand the challenges you are facing in your Online Goals and provide a personalised solution to you."

**Cross-cutting checklist references.** The checklist text supplied in the project conversation contains cross-cutting sections outside Category 01: *Follow the Sales Call Sequence*, *No Fake Promises*, *Sales Conduct Guidelines*, *Monologue Guidelines* and the *Call recording feedback checklist*. The conduct and sequence points cited in this document come from these sections, and **their content is confirmed against the checklist text supplied in the conversation** (U1, closed). They are **cross-cutting conduct references only, not additional Category 01 scoring criteria**; they are never used to define a Category 01 criterion.

**Repository check.** Neither uploaded PDF is in this repository. Decision Q13: the recommended home for reference documents is `docs/source/`. **That folder has not been created and no files have been copied**; this revision modifies only this file.

## 3. Evaluation category: Introduction

| Field | Value |
|---|---|
| Category ID | C01 |
| Name | Introduction |
| Applies to | New webinar-attendee prospect calls (Q1). Other call types: see §7. |
| Position in call | Step 1 of the checklist sequence, before discovery questions (S1 section 2 "Understanding Intent"; S2 "DESIRE"). |
| Criteria | C01-01 Self and team introduction · C01-02 Purpose of the call · C01-03 Expectation setting |
| Source basis | S1 section 1 (authority); S2 INTRO (wording) |

**Opening phase** (accepted for v1, Q5): from the salesperson's first speech after the call connects to, and including, the salesperson's first discovery question (a question about the prospect's reasons, background or goals) or first substantive pitch statement, whichever comes first.

### 3.1 Element timing states

For every element the evaluator searches the whole available, readable transcript and assigns exactly one timing state. "Prompted" is a separate attribute, not a timing state.

| State | Definition | Scoring effect |
|---|---|---|
| **On time** | First clear occurrence is inside the opening phase. | Counts normally. |
| **Late** | First clear occurrence is **after** the opening phase, and it clearly communicates the same required introductory behaviour in context (see below). | Does **not** count as on time. If the criterion has no on-time element but at least one late element, its maximum score is 1. |
| **Never demonstrated** | Not found anywhere in the part of the transcript that is observable and adequately reliable. | Element is missing. Evidence is the absence record (§6.2). |
| **Not observable** | The element could have occurred where the transcript has no usable evidence (recording began midway; gap; garbled window). | Element is unresolved; may make the criterion **NE** (§5.3). It is **not** "never demonstrated". |

**Contextual validation of late elements.** The search covers the whole readable transcript, but a later mention counts as a late demonstration **only when it clearly communicates the same required introductory behaviour in context**: the salesperson, addressing the prospect, identifies themselves or their team, states the purpose of the call, or sets expectations for it. An unrelated mention of FlexiFunnels, a duration, the word "selected", or any other keyword elsewhere in the conversation (for example a duration quoted about a course, a reference to the webinar's length, or "FlexiFunnels" used while describing the product) receives **no credit** and is not recorded as late.

**Prompted delivery.** If an element is delivered in response to a prospect's question or request (e.g. the prospect asks "who is calling?" and the salesperson answers), record `prompted_by_prospect = yes`. A prompted element **inside the opening phase is on time and scores normally**. A prompted element after the opening phase is late like any other.

## 4. Individual evaluation criteria

### C01-01 — Self and team introduction
- **Expected behaviour.** The salesperson tells the prospect who is calling. *Source: S1 1(a); S2 INTRO.*
- **Elements:**
  - **N** — the salesperson gives their own name.
  - **F** — the salesperson says they are calling from FlexiFunnels.
  - **T** — the salesperson says they are from the Mentoring Team. "Mentoring Team" is sufficient; **"Senior" is not mandatory** (Q6). A different team ("sales team", "support team") does **not** satisfy T.
- **Not an element:** greetings alone ("hello", "namaste"); saying the prospect's name; "FlexiFunnels" used in another sense (e.g. "I have used FlexiFunnels", "your FlexiFunnels account").

### C01-02 — Purpose of the call
- **Expected behaviour.** The salesperson tells the prospect why they are being called: the prospect has been selected or invited for a personalised 1:1 session. *Source: S1 1(b); S2 INTRO.*
- **Elements:**
  - **P1** — the call is described as a personalised / 1:1 / one-to-one session.
  - **P2** — the salesperson **communicates** that the prospect was specifically selected or invited (exclusive), not contacted generically.
- **What is assessed.** Only the *communication* of selection or invitation. Whether the selection or exclusivity is **actually true** is a separate, unscored question (see §5.4).
- **Optional context (not required, not scored):** that the prospect attended the webinar; "to understand your challenges"; and **the number 20**, which is optional and unscored (Q2). Leaving any of these out is never penalised.

### C01-03 — Expectation setting
- **Expected behaviour.** The salesperson tells the prospect what to expect from the call: its length and what it will deliver. *Source: S1 1(c); S2 INTRO.*
- **Elements:**
  - **X1** — a time frame of **15–25 minutes** (provisional, Q4). Met if the stated figure, or the whole stated range, lies within 15–25 minutes ("20 minutes", "around 20 minutes", "15–20", "20–25", "बीस मिनट"). A figure outside it (e.g. "5 minutes", "an hour", "20–30") does not meet X1 and is recorded as a deviation.
  - **X2** — what the call will deliver: a personalised solution, or an equivalent statement that the salesperson will understand the prospect's situation or challenges and offer a solution tailored to it.
- **Not evaluated here:** the actual duration of the call (Q3); whether the salesperson asked "is this a good time?" (Q12); any other expectation not in S1 or S2.

## 5. Detailed scoring definitions

### 5.1 Outcome vocabulary (used consistently throughout)

| Outcome | Meaning |
|---|---|
| **0** | The criterion is **applicable and observable** but the required behaviour was **not demonstrated**. Requires an absence record (§6.2). |
| **1 / 2 / 3** | Applicable and demonstrated to **varying degrees** (poor / partial / effective). |
| **N/A** | The criterion **genuinely does not apply** to this call (§7). |
| **NE** | **Available evidence is insufficient to establish what happened reliably** (§5.3). Not a low score and not "not applicable". |

### 5.2 Score table

"Elements" are N/F/T, P1/P2 or X1/X2. An element counts only if **on time and clearly demonstrated in context** (prompted or not).

| Score | C01-01 (N, F, T) | C01-02 (P1, P2) | C01-03 (X1, X2) |
|---|---|---|---|
| **3 — Effective** | All three on time, stated clearly enough for the prospect to understand. | Both on time, clearly communicated. | Both on time, clearly stated. |
| **2 — Partial** | Exactly two on time. | Exactly one on time (a personal 1:1 call without saying they were selected, or "you were selected" without saying what for). | Exactly one on time (duration without outcome; outcome without duration; or outcome plus a duration outside 15–25 minutes). |
| **1 — Poor** | Exactly one on time; **or** no element on time but at least one late. | A purpose is given but not the intended one (generic or product-led, e.g. "to tell you about our offer", no personalisation or selection); **or** no element on time but P1 or P2 late. | An expectation is voiced but meets neither element (e.g. only "a short call"); **or** no element on time but X1 or X2 late. |
| **0 — Not demonstrated** | Applicable and observable; none of N, F, T demonstrated at all (never, not even late). | Applicable and observable; no purpose stated; the rep goes straight to questions or pitch. | Applicable and observable; no expectation of any kind stated. |

**Distinguishing the three failure states.**
- *Never demonstrated:* nothing in the readable transcript → counts toward 0 (or a lower band if other elements exist).
- *Demonstrated late:* present only after the opening phase → maximum 1 if no element is on time.
- *Demonstrated in response to a prospect's question:* if inside the opening phase, **scores normally**; the prompt is noted in the explanation, not penalised.

**Boundary rules (reviewer alignment).**
1. Count elements, then apply the table. Do not average, and do not reward fluency, tone or charisma here.
2. Meaning over keywords. "20 minutes" spoken about something else, or "selected" with another meaning, earns nothing; the element must be addressed to the prospect as part of the introduction. No score may rest on a keyword match.
3. Any phrasing in Hindi, English or Hinglish that clearly conveys the element counts.
4. Contradiction inside the opening phase (e.g. "20 minutes" then "just 2 minutes") means the element is not met.
5. If some elements are on time and others late, score on the on-time ones and note the late ones.
6. **Ambiguity tie-break (Q8).** If two adjacent scores both seem plausible because of the salesperson's **wording**, choose the **lower** and state the ambiguity. If the ambiguity comes from **transcript quality**, do not lower the score: report **NE**.

### 5.3 When the outcome is NE
Report NE, not 0 and not a guessed score, when the criterion cannot be established reliably, including:
- the transcript covering the observable opening is missing, cut off or demonstrably garbled so that the decisive words (a name, "20", "team", "selected") cannot be read;
- the recording begins midway through the introduction and elements are **not observable** (below);
- the salesperson cannot be distinguished from the prospect and the answer depends on it;
- an uncertain element could change the score band.

If only some elements are uncertain and the rest settle the band, give the score and set `evidence_confidence = low`.

**A recording that begins midway through an introduction must not automatically receive 0 or N/A.** Indicators of a mid-introduction start include: the first segment begins mid-sentence; the first utterance is a response to something not in the recording ("yes, go ahead", "okay"); references to earlier statements ("as I said", "as discussed"); no greeting. In that case:
- elements observed in the transcript are recorded as demonstrated, with their timing state;
- elements not found are **not observable**, not "never demonstrated";
- if the observed elements already reach the top band for the criterion, give **3**; otherwise report **NE**, stating how many elements were observed as a lower bound for the human reviewer;
- if the recording begins after the point where the introduction would have ended (discovery already under way, no explicit evidence either way), report **NE** for the unobservable elements, not 0.

### 5.4 C01-02: selection communication versus factual verification

Two separate questions are recorded for C01-02:

| Question | Who answers | Output |
|---|---|---|
| **Was selection or invitation communicated?** (P2) | The evaluator, from the transcript. | Scored under C01-02. |
| **Is the underlying selection or exclusivity claim true?** | A human, using information the evaluator does not have. | `claim_verification_status`, default **`not_assessed`**. |

Rules:
1. The evaluator scores the **communication**. It **must not** state or imply that a statement is false merely because the underlying fact is unavailable to it.
2. Statements matching the approved script (S2), including "selected 20 people", are treated as approved wording and are **not** flagged by default.
3. Where the introduction contains a **non-scripted, checkable factual claim** (e.g. a specific number of people, a deadline, a prize or special benefit, an earnings or results claim), record `human_review_flag = unverified_claim` with the quotation and timestamp. The element is still scored on communication.
4. Only if the transcript **itself** contradicts the claim (e.g. the same call elsewhere says the offer is open to everyone), or authoritative evidence is supplied, record `human_review_flag = possible_contradiction`. Even then the evaluator does not decide it is false: the criterion result is marked **provisional pending human review**.
5. The number 20 remains optional and unscored.

## 6. Evidence requirements

### 6.1 Evidence for scores 1–3 and for elements found
| Field | Requirement |
|---|---|
| criterion_id | e.g. `C01-02` |
| outcome | `0`, `1`, `2`, `3`, `N/A`, `NE` |
| elements | Per element: demonstrated / never / late / not observable, plus `prompted_by_prospect` yes/no |
| evidence_start / evidence_end | Seconds from the start of the stored recording, to 0.1 s, as `mm:ss.s`. End required whenever evidence spans several segments. |
| quote | **Exact** transcript text, unaltered, in its original script. Not translated, corrected, or stitched without marking each part. A translation may be added only if labelled as the evaluator's translation. |
| speaker | Salesperson or prospect, as inferred from context; state if it cannot be established (the transcript has no speaker labels). |
| explanation | One to three sentences linking evidence to the criterion and score boundary. |
| evidence_confidence | `high` / `medium` / `low`, with reason. |
| transcript_quality_flags | Any warning overlapping the evidence window (gaps, cut-off words, language flips, repeated phrases, failed chunks). |
| human_review_flags | `unverified_claim`, `possible_contradiction`, call-type conflict, etc., where applicable. |

**Timestamp rules.** Call-relative seconds from the stored recording, **not** Callyzer wall-clock time; 0:00 is the first sample of the recording, which may not be the moment the call connected. Use transcript segment times; word times were accurate for correctly recognised words in tests so far but are unverified inside garbled text, so do not claim sub-0.1 s precision and mark times approximate when the surrounding text is garbled. Give each location its own start/end if evidence appears in several places.

### 6.2 Evidence mechanism for a score of 0 (absence record)
A zero means the criterion was applicable and observable but the behaviour was not demonstrated. **The evaluator cannot quote something that was not said**, so no quotation proving absence is ever required or allowed to be invented. Instead a score of 0 must carry an **absence record**:

| Field | Requirement |
|---|---|
| observable_window | Start and end timestamps (`mm:ss.s`) of the opening phase as observed: from the first salesperson speech to the end of the opening phase (the first discovery question or pitch statement). |
| progression_excerpts | Enough **exact** transcript excerpts, with timestamps and speakers, to establish the observable opening and how the conversation progressed. Prefer two or more where available: (1) the earliest salesperson speech in the window; (2) the salesperson's utterance that ended the opening phase (first discovery question or pitch statement); (3) any excerpt in between if the window is long. A **single** excerpt is permitted if that is all the observable opening reasonably contains. These show what *was* said, not that the behaviour was absent. |
| absence_explanation | One to three sentences stating which elements were looked for, that none appears in the window, and what the salesperson did instead. |
| whole_transcript_search | Statement that the rest of the readable transcript was also searched for each element (to exclude "late"), applying the contextual validation in §3.1. |
| evidence_confidence | `high` / `medium` / `low`, with reason. |
| transcript_quality_flags | Every flag, and every gap over 5 s, overlapping the observable window. |

**Sufficiency of excerpts.** There is no fixed minimum number of excerpts. Fewer than two available excerpts does **not** by itself make the outcome NE. The evaluator judges whether the available exact excerpts, together with the quality flags and the whole-transcript search, are sufficient to establish the absence reliably: if they are, the outcome may be 0 (with the single excerpt, or the few available, recorded); if they are not, the outcome is NE under §5.3. Evidence is never fabricated to reach a number of excerpts.

**Zero-eligibility test (all must hold; otherwise the outcome is not 0):**
1. Applicability: call type is a new webinar-attendee prospect call (else N/A or hold, §7).
2. Observability: the recording captures the start of the call or the whole opening phase (else NE, §5.3).
3. Reliability: no quality flag or gap in the observable window is large enough to have hidden the behaviour; if one could have, the outcome is NE.
4. Search: no element is found anywhere in the readable transcript (an element found only late is scored as late, not 0).

For a partial score (1 or 2) the same record is kept, per **missing element**, in the explanation (window, excerpts, why it is considered absent).

### 6.3 Evidence for N/A and NE
- **N/A:** the reason code from §7 plus, where the reason is "call type" or "no conversation", the metadata or excerpt that supports it.
- **NE:** the reason from §5.3, the window, the quality flags, what *is* known (elements observed, as a lower bound), and the recommended human action.

### 6.4 General rules
- **No fabrication.** Never invent a quotation, timestamp or behaviour.
- **Robustness to known transcription limits.** The transcript may write English terms in Latin script in one place and Devanagari in another; garble names and numbers; skip short replies and boundary words; output English paraphrase for Hindi speech; and carry no speaker labels. Therefore accept equivalent renderings ("senior mentoring team", "सीनियर मेंटरिंग टीम", "बीस मिनट", "20"); do not treat one garbled word as proof of a missing behaviour; prefer consistent evidence over a single fragment; never treat a long transcript or a high model confidence as evidence of accuracy.

## 7. Applicability and N/A rules

**Applicability (Q1; U2 and U3 resolved, §13).** Category 01 applies to **new webinar-attendee prospect calls**. Follow-up, renewal, continuation and support calls are not scored by Category 01 in v1: the approved handling is the applicability matrix in §13.5, and separate rubrics for renewal, follow-up and continuation calls are future work that needs an owner-supplied process.
- **Call type is a required human-confirmed input** (source-of-truth hierarchy, §13.4). The evaluator does not decide call type and never guesses it. If it is missing, or conflicts with other information (e.g. transcript indicators of a renewal or an explicit reference to an earlier conversation), the evaluator **holds the call** and requests human review. It does not score it as 0. After a human re-confirms the label with the conflict visible, the label stands and is recorded as `call_type_conflict_acknowledged`.
- Once a human confirms a call as **not** a new webinar-attendee prospect call, C01-01 to C01-03 are **N/A** with reason `call_type_not_covered`. This is a provisional status: it means v1 has no rule for the call type, **not** that such calls need no introduction.

**Other N/A reasons.**
- `no_conversation`: the call was not a two-way conversation (unanswered, voicemail, wrong number, immediate disconnect).

**N/A is never used for:** a recording that begins midway (use §5.3), a poor transcript (NE), a prospect's personal characteristic (§8), or an element that was simply not said (0, 1 or 2).

**Summary of the four non-guess outcomes.**

| Situation | Outcome |
|---|---|
| Applicable, observable, reliable, nothing demonstrated | 0 (with absence record) |
| Applicable, demonstrated to some degree | 1–3 |
| Does not apply (no conversation; confirmed call type not covered) | N/A |
| Applies but evidence is insufficient (garbled, cut off, midway start, speaker unclear) | NE |
| Call type missing or in conflict with transcript | Hold, ask a human (process state, not a score) |

## 8. Known limitations and assumptions

**Known limitations**
1. **Transcription quality.** Phase 1 evidence so far shows Hindi-English recognition at roughly 2–3 out of 5 in human review: garbled Hindi, inconsistent English terms, omissions, no speaker labels. A criterion's outcome is only as reliable as its evidence window (§5.3, §6).
2. **No speaker labels.** Attribution to the salesperson is inferred.
3. **Recording start.** The recording may not begin at the call's opening; the opening may be partly or wholly missing.
4. **Source scope.** Only S1 (text), S2 and S3 were reviewed. The Sales Straight Path video and the Google Docs linked from the checklist were not accessible. Versions may not be current.
5. **Single script.** S2 gives one wording; good introductions differ, hence the rule that wording is not penalised.
6. **Untested boundaries.** No call has yet been scored against this rubric.
7. **Observation, not a source:** the one Agent 1 transcript reviewed so far (machine transcript, not human-verified) appears to be a renewal or continuation call that begins mid-conversation. It would be held, not scored, under §7.

**Assumptions** (each needs confirmation)
- A1. S1 (the text in the conversation) is the authority; S2 supplies wording only.
- A2. The 15–25 minute tolerance (Q4) and the opening-phase definition (Q5) are accepted for v1 but remain revisable after real calls are scored.
- A3. A human supplies the call type until metadata rules exist.

**Ethical conduct and fairness**
- Category 01 scores never depend on, and the evaluator must not infer or use, a prospect's language ability, education level, disability, military status, age, gender, region, religion or any other personal characteristic. No criterion here refers to them (Q10).
- The "people to whom you can never sell" guidelines in the checklist are **deliberately not translated into rubric rules**: they would score a rep by prospect characteristics. The framework instead assesses product fit, informed decision-making, honest communication and respectful conduct. **The leadership / legal review flag is retained** (Q10).
- The rubric rewards no false scarcity, pressure or misleading claim. Verifiability of claims is handled by flags and human review, never by the evaluator asserting falsehood (§5.4).

## 9. Decisions recorded and open questions

### 9.1 Decisions from the project owner (applied in this revision)
| # | Decision |
|---|---|
| Q1 | Category 01 applies to new webinar-attendee prospect calls. Renewals, follow-ups and continuation calls need separate applicability rules. |
| Q2 | The number 20 is optional and unscored. Selection **communication** is evaluated; factual verification is separate (§5.4). |
| Q3 | Actual call duration is not evaluated in Introduction. |
| Q4 | 15–25 minutes accepted, provisionally. |
| Q5 | Opening-phase definition accepted; score cap of 1 for elements delivered only after it retained. |
| Q6 | "Mentoring Team" is sufficient; "Senior" not mandatory. |
| Q7 | NE approved. |
| Q8 | Lower score for genuine wording ambiguity; NE for transcript ambiguity. |
| Q9 | Monologue and small-talk guidelines reserved for a later category. |
| Q10 | Do not score prospect personal characteristics. Leadership/legal review flag retained. |
| Q11 | Aggressive or potentially misleading scripted claims (income timelines, guarantees, ease claims, pressure tactics in S2/S3) reserved for review when objection-handling and closing categories are designed. |
| Q12 | Asking whether it is a good time is not scored in Introduction. |
| Q13 | `docs/source/` recommended for reference documents; no files copied (none are in the repo and this revision may modify only this file). |
| Q14 | Hindi, English and Hinglish equally acceptable. |

### 9.2 Unresolved questions and ambiguities
| # | Open item | Why it matters |
|---|---|---|
| U4 | **How to tell that a recording begins midway** reliably (the indicators in §5.3 are heuristics). Does Callyzer give a call start time or recording offset? | Distinguishes NE from 0. |
| U5 | **Which claims count as "non-scripted, checkable"** for the `unverified_claim` flag, and who verifies them and with what evidence. Proposed examples: number of people, deadlines, prizes, earnings/results. | Keeps the flag useful without flooding reviewers. |
| U6 | **Who owns verification of the scripted selection/exclusivity claim** itself (a business question separate from evaluation). | The evaluator does not assess it. |
| U8 | **Reviewer calibration.** After the first calls are scored by two reviewers, confirm that the boundaries (especially 1 vs 2 and 0 vs NE) agree. | The rubric is untested on real data. |

### 9.3 Closed in the final Revision 2 corrections

| # | Item | Resolution |
|---|---|---|
| U1 | Source provenance of cross-cutting checklist sections | **Closed.** The cross-cutting content (*Follow the Sales Call Sequence*, *No Fake Promises*, *Sales Conduct Guidelines*, *Monologue Guidelines*, *Call recording feedback checklist*) is confirmed against the checklist text supplied in the conversation. These remain cross-cutting conduct references, not Category 01 scoring criteria. |
| U7 | Whether to search the whole transcript for late elements | **Closed as a consequence of Correction 2.** The whole-readable-transcript search is retained, with the contextual-validation restriction in §3.1. |

### 9.4 Closed by the call-type decision (2026-11-14)

| # | Item | Resolution |
|---|---|---|
| U2 | Applicability rules for renewal, follow-up and continuation calls | **Closed.** Option Y approved: follow-up, renewal, continuation and support calls are N/A (`call_type_not_covered`, provisional) for Category 01 and Category 02 until type-specific criteria are approved; rubrics for renewal and follow-up are future work needing an owner-supplied process. Full rules and matrix in §13. |
| U3 | How call type is identified and supplied | **Closed.** Source-of-truth hierarchy approved: human-confirmed label (authoritative), then business records (suggest a label for human confirmation, if later approved), then Callyzer metadata and call history (hints), then transcript inference (indicators). Missing label or conflict means hold; a re-confirmed human label stands (`call_type_conflict_acknowledged`). Full rules in §13.4. |

## 10. Template for future categories (structure only)

Each category repeats: **Category ID and name → source basis and applicability (including which call types it applies to, §13.5) → criteria (ID `Cnn-mm`, expected behaviour, elements) → element timing states → scoring table (0–3) → boundary rules → evidence requirements (including the absence record for 0) → N/A and NE rules → limitations → open questions.** No overall score or weights will be added until all categories are individually approved.

## 11. Revision log

1. **Source provenance corrected.** S1 is the checklist provided as text in the conversation (not a PDF; no page count or file metadata asserted). The two uploaded PDFs are S2 and S3. The note on cross-cutting references and the question U1 recorded how those sections were read; U1 is now closed (item 7).
2. **Zero-score evidence.** Added the absence record (§6.2) and the zero-eligibility test; no invented quotation is required.
3. **C01-02.** Separated communication of selection from verification of the claim (§5.4); the number 20 remains optional and unscored; unverified claims are flagged for human review; no falsehood is asserted without evidence. The earlier "conduct override" that removed credit was replaced by flags and provisional status.
4. **Late delivery.** Added timing states (on time, late, never, not observable) and the prompted-delivery attribute (§3.1); prompted delivery in the opening phase scores normally; cap of 1 for late-only elements retained.
5. **0 / 1–3 / N/A / NE** defined once (§5.1) and applied consistently; a recording starting midway no longer defaults to 0 or N/A (§5.3).
6. **Decisions Q1–Q14 applied**, including the 15–25 minute tolerance, "Mentoring Team" sufficiency, the call-type applicability rule and the hold state. Open questions reduced to U1–U8.
7. **Final narrow corrections.** (a) §6.2: the rigid "at least two excerpts" requirement was replaced by "enough exact excerpts to establish the observable opening and its progression" (two or more preferred; one permitted; fewer than two does not by itself force NE; evidence is never fabricated). (b) §3.1: the whole-transcript search for late elements is retained, with the restriction that a later mention counts only if it clearly communicates the same required introductory behaviour in context; unrelated keyword mentions earn no credit. (c) U1 closed: cross-cutting sections confirmed against the checklist text supplied in the conversation; they remain cross-cutting conduct references, not Category 01 criteria. U7 (search scope) closed as a consequence of (b).
**Revision 2** (items 1–7 above): Category 01, approved 2026-11-14.

**Revision 3**: Category 02 — Understanding Intent (§12), pending approval. It comprises:
8. **First draft of Category 02** (§12): six criteria (C02-01 to C02-06), definitions, scoring tables, evidence rules layered on §6, applicability, N/A, NE and edge cases, ethical safeguards, limitations, and 16 open questions (U02-01 to U02-16). Document-level text touched outside §12: the title, status line, two sentences in §1 (scope and out-of-scope), and this log.
9. **Revision 3 corrections after the project owner's review** (§12 only, plus document-level version text). (a) **Owner decisions applied:** U02-01 questioning-method guidance may define scored criteria (source basis separated into direct checklist requirement versus cross-cutting questioning guidance; monologue limit, small talk and talk balance not introduced); U02-02 all five information areas expected, volunteered information counts, a bare yes/haan establishes agreement only; U02-03 one specific learning suffices; U02-04 D, W and S stay in C02-03 with element-level evidence; U02-05 prospect expectations excluded; U02-06 interruption and talk balance flag-only. (b) **C02-06 rescored:** 3 requires purpose established or a genuine attempt with respectful proceeding; a simple unanswered question never earns 3; 2 is one brief lapse with a return to discovery; 1 is sustained or repeated pitching, repeated assumptions or pitching at length (including an unanswered question followed by a pitch without clarification); 0 is no attempt; N/A `no_transition_observed`. (c) **C02-04:** measurable reflection threshold (all answers if 1–2; ⌈75%⌉, rounded up, if 3 or more), marked a provisional owner-approved calibration rule; reflection, neutral follow-up, acknowledgement and generic move-on defined; scoring table made consistent (0 to 3). (d) **C02-03:** element-level record for D, W and S (asked, volunteered, established, exact quotation, timestamp, evidence confidence, quality flag). (e) **U02-07 to U02-16 resolved** with the owner-approved interpretations, including the revised unreached-versus-skipped rule for a prospect who ends the call (NE for unreached, normal scoring for skipped). (f) **Overlap re-checked:** boundaries between C02-01 to C02-03, C02-04, C02-05 and C02-06 stated, with the one-incident-once rule. (g) **U02-15 verified** against the checklist document in the project materials; wording unchanged. (h) **Two new provisional items** recorded as U02-17 (counting substantive answers) and U02-18 (a single isolated assumed-intent statement). (i) **Version consistency fixed:** title, status line, this log and the footer now agree on Revision 3. **Category 01 (§3–§9) is unchanged**, including its scoring, evidence rules and decisions Q1–Q14. At the time of this revision Category 02 was not yet approved (see item 10).
10. **Category 02 approved** by the project owner on 2026-11-14. Status text updated in the title block, §1, §12 header, §12.11 and the footer; no scoring, evidence or applicability text was changed. Categories 03 onward are not started.
11. **Draft proposal §13 added** (call-type applicability and identification, U2 and U3), at the time marked pending the owner's decision; no approved text (§3–§12) was changed when it was added.

**Revision 4** (current): call-type applicability and identification (U2, U3).
12. **§13 approved by the project owner on 2026-11-14 ("Approve as proposed")**, adopting every recommended default in §13.10. Applied: (a) §13 status updated to approved; (b) **applicability wording only** updated in §7 and §12.8 (call type is a human-confirmed input under the §13.4 hierarchy; hold on missing or conflicting call type; a re-confirmed human label stands as `call_type_conflict_acknowledged`; other confirmed types are N/A `call_type_not_covered` per the §13.5 matrix; separate rubrics are future work), and in §1 (out-of-scope sentence) and §10 (template now includes "applies to which call types"); (c) U2 and U3 removed from the open list in §9.2 and recorded as closed in the new §9.4; (d) title, status line, this log and the footer updated to Revision 4. **No criterion, score table, evidence rule or approved decision (Q1–Q14, U02-01 to U02-18) was changed.**

## 12. Category 02 — Understanding Intent

> **APPROVED by the project owner on 2026-11-14 (Revision 3).** This section incorporates the project owner's decisions on U02-01 to U02-16 and the owner-approved scoring corrections. It does not change Category 01 (§3–§9). All outcome terms (0, 1, 2, 3, N/A, NE), the absence record, the zero-eligibility test, the hold state, quality flags and evidence confidence are used exactly as defined in §5–§7.

### 12.1 Materials reviewed, source basis and verification

Source priority: S1 (checklist) is authoritative for the expected process; S2 gives supporting examples and suggested flow; S3 is supporting reference only. Example wording is never mandatory.

| Material | What it says about Category 02 |
|---|---|
| This document, Category 01 (§1–§11) | Conventions inherited: outcome vocabulary (§5.1), NE (§5.3), absence record and zero-eligibility test (§6.2), contextual validation (§3.1), call-type hold and N/A (§7), ethics (§8), decisions Q1–Q14. |
| **S1 checklist, section 2 "Understanding Intent"** (authority) | Five items: (a) "Why did they attend the webinar?" (b) "Top 3 learnings from the webinar" (c) "How long have they followed FlexiFunnels/Saurabh Sir?" (d) "Why do they follow FlexiFunnels/Saurabh Sir?" (e) "How did they find out about the webinar?" **Verified at this revision** (U02-15, §12.11). |
| S1 cross-cutting: Sales Psychology Parameters | "Follow the Sales Call Sequence"; "Avoid One-Sided Conversations"; "Encourage Two-Way Communication"; "Allow Customers to Finish Speaking"; "Document Customer Responses". |
| S1 cross-cutting: Monologue Guidelines | "Follow-up questions must be based on keywords provided by the prospect. The last question keyword should connect to the next question"; "Do not move to the next step until the previous answer is received"; "Rephrase the same question and get the answer if the customer tries to dodge it"; "No Fake Promises". |
| S1 cross-cutting: Call recording feedback checklist | "Don't assume anything—ask clarifying questions like a doctor diagnosing a patient"; "Don't repeat the same questions—listen carefully and write down key points". |
| S2 Journey | "DESIRE" section: "May I know your purpose for attending the webinar?" and "What were your Top 3 learnings from the webinar?". Worked examples of following the prospect's own keywords ("Keep getting into the WHY of every Keyword they tell you"; "Ask one question at a time and keep following up"). The other three S1 items appear in S2 inside the persona question list; S2 says its questions are "for reference". |
| S3 OBJECTIONS | **Does not address Category 02.** Not used for scoring. |
| Project documentation | `README.md` has no sales-process content. The reports in `reports/` concern transcription and are used only for transcript-reliability limits (§12.10). |

**Source basis, by type (decision U02-01).**
- **Direct checklist requirement** = the five information areas in S1 section 2. These define C02-01 to C02-03.
- **Cross-cutting questioning guidance** = the S1 guidelines about *how to ask and respond*. The project owner has approved these as a basis for scored Category 02 criteria. The approved guidance is: base follow-ups on the prospect's keywords; do not move to the next step before receiving the previous answer; rephrase when the prospect avoids answering; do not assume information about the prospect; encourage two-way communication; listen to the prospect's responses.
- **Not used in Category 02 scoring:** the 60-second monologue limit, small-talk restrictions and general talk-time balance. They remain reserved for a later category (Q9).

| Criterion | Direct checklist requirement | Cross-cutting questioning guidance (owner-approved basis) |
|---|---|---|
| C02-01 | S1 2(a) | none needed |
| C02-02 | S1 2(b) | none needed |
| C02-03 | S1 2(c), 2(d), 2(e) | none needed |
| C02-04 | none (the five items require asking, not following up) | keyword-based follow-ups; listen to the prospect's responses; encourage two-way communication (interactive engagement shown through reflection and follow-up; talk balance is **not** scored). S2 DESIRE examples support it. |
| C02-05 | none | rephrase when the prospect avoids answering; do not move to the next step before receiving the previous answer; do not assume (ask clarifying questions) |
| C02-06 | none directly; the checklist order places Understanding Intent (section 2) before USP (section 15) | do not move to the next step before receiving the previous answer; do not assume information about the prospect. "Follow the Sales Call Sequence" is cited as corroboration only. |

### 12.2 Validation of the areas investigated

| # | Area investigated | Supported by | Final treatment |
|---|---|---|---|
| 1 | Understands why the prospect attended or is interested | S1 2(a), 2(d); S2 DESIRE | Included: C02-01, C02-03 (W). |
| 2 | Explores what the prospect is looking to achieve or learn | "Learn": S1 2(b). "Achieve" (goals, revenue, plan): S1 sections 3, 5, 8 | "Learn" included: C02-02. "Achieve" **excluded** (later categories). |
| 3 | Identifies expectations from the webinar, call or solution | Not in S1 section 2 | **Excluded** (U02-05). No criterion and no implicit requirement. |
| 4 | Asks relevant questions instead of assuming | S1 section 2; cross-cutting "Don't assume anything" | Qualifying-question test (§12.4) and C02-06. |
| 5 | Listens and asks appropriate follow-ups | Keyword-based follow-up guideline; S2 examples | C02-04. |
| 6 | Clarifies vague, incomplete or ambiguous answers | Rephrase-if-dodged and do-not-move-on guidelines; ask clarifying questions | C02-05. |
| 7 | Lets the prospect explain instead of dominating | S1 Sales Psychology Parameters; Monologue Guidelines (reserved, Q9) | **Flag only, never scored from the transcript** (U02-06). |
| 8 | Avoids prematurely pitching | Do-not-move-on guideline; checklist order | C02-06. |

Topics deliberately **not** part of Category 02 (later categories): personal and business details, goals, revenue and money, emotional why, why now, plan, challenges, knowledge gap, past experiences. A salesperson's questions on those topics are neither required nor credited here.

### 12.3 Evaluation category: Understanding Intent

| Field | Value |
|---|---|
| Category ID | C02 |
| Name | Understanding Intent |
| Applies to | New webinar-attendee prospect calls (Q1). Missing or conflicting call type: human hold. Other confirmed call types: N/A, reason `call_type_not_covered` (provisional). See §7 and §12.8. |
| Position in call | Step 2 of the checklist sequence, after the introduction (S1 section 2; S2 DESIRE). |
| Five information areas (all expected) | **I1** why the prospect attended the webinar · **I2** what they learned from it · **I3 (D)** how long they have followed FlexiFunnels or Saurabh Sir · **I4 (W)** why they follow · **I5 (S)** how they found out about the webinar |
| Criteria (final) | **C02-01** Purpose of attendance (I1) · **C02-02** Webinar learnings (I2) · **C02-03** Following history and source of interest (I3, I4, I5 as D, W, S) · **C02-04** Reflection and follow-up on the prospect's answers · **C02-05** Clarification of unclear answers · **C02-06** Intent established before advancing or pitching |
| Boundaries (no overlap) | **C02-01 to C02-03:** whether the required information was established. **C02-04:** whether the salesperson reflected on and explored understandable answers. **C02-05:** whether the salesperson clarified unclear answers. **C02-06:** whether the salesperson respected the discovery sequence and avoided assuming intent or pitching prematurely. |

### 12.4 Definitions used by every Category 02 criterion

**Coverage rules for the five information areas (decision U02-02).**
- All five areas are **expected to be covered** during the conversation.
- The salesperson does **not** need to use the scripted questions; natural, conversation-led wording is never penalised.
- Relevant information **volunteered** by the prospect counts as established without any question.
- An area neither asked about nor volunteered is **missing**.
- A salesperson question without a meaningful answer does **not** count as established information.
- Record `question_asked` and `information_established` separately; a question never sets the second field.

**Terms.**
- **Stage window.** From the end of the opening phase (§3) to the first substantive pitch statement or the first question belonging to a later category, whichever comes first. Used for sequence (C02-06) and as the main place to look; C02-01 to C02-03 still search the whole readable transcript (U02-13).
- **Qualifying question.** A question that is (a) addressed to the prospect, (b) about one of the five areas, (c) open and neutral: it does not supply the answer, presuppose it, or pressure the prospect. Leading or assumptive questions are not qualifying questions.
- **Information established.** The prospect's **own statement**, attributable to the prospect, readable in the transcript, and specific enough to state the fact. A salesperson's restatement does not establish it. **A bare "yes" or "haan" to something the salesperson supplied establishes agreement only, not the underlying information** (U02-11).
- **Specific learning** (I2). A particular topic, idea, method or lesson from the webinar. "It was good" or "I learned a lot" is **not** specific. **One specific learning is sufficient** for the highest score; three are not required and fewer than three is never penalised (U02-03).
- **Substantive answer.** A distinct prospect answer, volunteered or in response to a question, that gives at least one concrete idea (topic, reason, event, name, duration) on one of the five areas. Counting convention (U02-17, provisional): count in transcript order; a statement giving concrete ideas for two different areas counts as two answers; a later answer counts separately only if it adds a new concrete idea; generic, evasive or unclear answers are not substantive (they are C02-05 events).
- **Unclear answer.** An answer on one of the five areas that is vague (generic: "just to learn"), incomplete (part of a multi-part question), contradictory (conflicts with something said earlier), or evasive (dodges the question).
- **Reflection.** The salesperson **accurately restates, paraphrases or builds on a specific idea the prospect communicated**, in the next relevant turn or a later turn clearly tied to that answer. "Okay", "right", "hmm" or "accha" alone are **acknowledgements, not reflections**. A generic scripted question unrelated to the prospect's answer is **not** a reflection.
- **Neutral follow-up.** A question built on a specific word or idea in the prospect's answer (a keyword) that is open and not leading, assumptive or pressuring. A leading or assumptive follow-up does **not** qualify.
- **Clarification attempt.** A question aimed at the unclear point that is rephrased or more specific, neutral, not a verbatim repeat, and not pressuring. A clarification attempted later in the call counts where the context clearly ties it to the earlier unclear answer.
- **Genuine attempt** (to understand the prospect's purpose, I1). A qualifying question about I1 was asked **and**, where the answer was absent, unclear or evasive, at least one clarification attempt was made, **unless the prospect clearly declined to give the information**, in which case no further attempt is expected. **A simple unanswered question with no reasonable clarification attempt, where one is appropriate, is not a genuine attempt.**
- **Respectfully proceeding.** After the prospect remains unwilling or unable to give the information, the salesperson acknowledges this (explicitly, or by plainly accepting it), does not keep pressing beyond the attempts already made, does not state or invent an assumed purpose, and does not treat the missing answer as consent or interest.
- **Premature pitch.** A persuasive statement directed at the prospect about FlexiFunnels features, benefits, results, price, offers or deadlines, or an invitation to pay or enroll, made before the prospect's purpose (I1) has been established or genuinely attempted. **Not** a premature pitch: describing the call's purpose or process (Category 01); a brief factual acknowledgement of the webinar; a **brief factual response to a question the prospect asked, if the salesperson then returns to discovery** (U02-08). Judged by meaning and context, never by a keyword such as "FlexiFunnels".
- **Understanding check** (C02-01 to C02-03). Information the prospect established is not later contradicted, replaced or re-asked by the salesperson as if unanswered. Failure caps the criterion at 2.

**One-incident-once rule and overlap boundaries.** One behaviour is counted under one criterion only:

| Behaviour observed | Counted in |
|---|---|
| Required information not obtained, or not asked, or only generic | C02-01, C02-02 or C02-03 |
| Established information contradicted, replaced or re-asked | The understanding check cap in C02-01 to C02-03 only (not also in C02-04) |
| Answer ignored, only acknowledged, or answered with a generic move-on | C02-04 only |
| Unclear answer not clarified, or clarified poorly | C02-05 only (not also in C02-04) |
| Pitch before purpose, or assumed intent | C02-06 only |

The same behaviour is never penalised twice. Two **distinct** failures in the same exchange (for example an unclear answer that is not clarified *and* a pitch that follows) are scored in their own criteria.

**Reasonable opportunity, reached, unreached and skipped** (decision U02-16). An information area is **unreached** if the prospect clearly asked to end the call or declined to continue before the salesperson had a reasonable opportunity to cover it in sequence. It is **skipped** if the salesperson had that opportunity and did not cover it (including when time was used on unnecessary delay or unrelated conversation). See §12.8.

### 12.5 Individual evaluation criteria

Illustrative examples are **paraphrases written for this rubric, not quotations from any call**. They show behaviour, not required wording. Hindi, English and Hinglish are evaluated equally (Q14).

#### C02-01 — Purpose of attendance
- **Behaviour evaluated.** The salesperson establishes why the prospect attended the webinar (I1). *Basis: direct checklist requirement, S1 2(a); S2 DESIRE.*
- **Expected observable elements.** **Q1** — a qualifying question about the reason, **or** the prospect volunteers it. **A1** — the prospect states a reason, established as information. **Understanding check.**
- **Strong evidence.** A qualifying question (quote, timestamp, speaker) or a volunteered statement, the prospect's specific reason in their own words (quote, timestamp), and no later contradiction or re-asking of it.
- **Partial evidence.** A reason established only generically ("to learn more") and not clarified; or established but later contradicted or re-asked.
- **Does not qualify.** A leading or assumptive statement; the salesperson's own statement of the reason; a bare "yes" to a supplied reason; a question about something else ("did you like the webinar?"); the introduction's mention that the prospect attended; a reason that cannot be attributed to the prospect.
- **Acceptable (illustrative).** "What made you decide to join the webinar?" / "Aapne webinar kyun attend kiya?" Or the prospect says they came to learn Facebook ads and the salesperson builds on it.
- **Poor (illustrative).** "You joined because you want to make big money, right?" Asking and moving into product features without an answer. Asking again later as if the earlier answer was never given.

#### C02-02 — Webinar learnings
- **Behaviour evaluated.** The salesperson establishes what the prospect took from the webinar (I2). *Basis: direct checklist requirement, S1 2(b); S2 DESIRE.*
- **Expected observable elements.** **Q2** — a qualifying question about learnings or takeaways (the number three is not required), **or** the prospect volunteers it. **A2** — at least one **specific learning** in the prospect's own words. **Understanding check.**
- **Strong evidence.** One specific learning (or more) established, not contradicted or re-asked.
- **Partial evidence.** Only generic comments ("it was good", "I learned a lot"), not clarified; or a specific learning later contradicted or re-asked.
- **Does not qualify.** Suggested learnings with bare agreement; the salesperson summarising the webinar; praise without content.
- **Acceptable (illustrative).** "What were the main things you took away from the webinar?" / "Webinar se aapne kya seekha?"
- **Poor (illustrative).** Telling the prospect what the webinar taught. Asking and cutting to a pitch before any answer.

#### C02-03 — Following history and source of interest
- **Behaviour evaluated.** The salesperson establishes the prospect's relationship with FlexiFunnels or Saurabh Sir and how they came to the webinar. *Basis: direct checklist requirement, S1 2(c), 2(d), 2(e).* These items stay in Category 02 and are **not** moved to Customer Persona (U02-04).
- **Retained as one criterion with three separately recorded elements:**
  - **D** — Duration of following (I3).
  - **W** — Reason for following (I4).
  - **S** — Source through which the prospect discovered the webinar (I5).
- **Element-level record (required for each of D, W and S):** whether it was **asked** (with quote and timestamp); whether it was **volunteered** (with quote and timestamp); whether it was **established** (yes / partial / no / not_transcribed); the **prospect's exact quotation** and **timestamp**; **evidence confidence**; any relevant **transcript-quality flag**. The three elements are never collapsed into one statement; the criterion score is derived from the per-element results with the table in §12.6.
- **Strong evidence.** All three established, each with its own quote and timestamp.
- **Partial evidence.** Two established; or all three addressed but one answer remains generic.
- **Does not qualify.** The salesperson stating the history or source for the prospect; "yes" to a supplied history; information about the prospect's business (a later category).
- **Acceptable (illustrative).** "How long have you been following Saurabh Sir, and what do you like about his content?" / "Webinar ke baare mein aapko kahan se pata chala?"
- **Poor (illustrative).** Assuming the prospect is a long-time follower. Skipping all three and moving to the prospect's business.

#### C02-04 — Reflection and follow-up on the prospect's answers
- **Behaviour evaluated.** Whether the salesperson visibly understands what the prospect said and explores it with the prospect's own words, within the five information areas. *Basis: cross-cutting questioning guidance approved under U02-01 (keyword-based follow-ups; listen to the prospect's responses; encourage two-way communication); S2 DESIRE examples. It is not a direct checklist requirement.*
- **Unit of evaluation.** Each substantive answer (§12.4 counting convention).
- **Expected observable elements.** **R** — reflection. **F** — a follow-up built on a specific keyword or idea in the answer. **N** — the follow-up is neutral.
- **Measurable reflection threshold (provisional, owner-approved calibration rule — not a quotation from the checklist).** If there are one or two substantive answers, reflection is expected for **all** of them. If there are three or more, reflection is expected for **at least 75%**, rounded **up** to the next whole number.

| Substantive answers | Minimum reflected | | Substantive answers | Minimum reflected |
|---:|---:|---|---:|---:|
| 1 | 1 | | 6 | 5 |
| 2 | 2 | | 7 | 6 |
| 3 | 3 | | 8 | 6 |
| 4 | 3 | | 9 | 7 |
| 5 | 4 | | 10 | 8 |

  Formula: required = n if n ≤ 2; otherwise ⌈0.75 × n⌉. The threshold is a provisional calibration rule to be reviewed after real-call evaluation.
- **Follow-up condition for a score of 3 (retained).** Neutral, keyword-based follow-ups on **at least two distinct** substantive answers, or on the sole substantive answer when only one exists.
- **Strong evidence.** Reflection threshold met **and** follow-up condition met; each cited with the prospect's quote and the salesperson's response quote and timestamps.
- **Partial evidence.** Reflection without the required follow-ups, or a neutral follow-up without meeting the reflection threshold.
- **Does not qualify.** Bare acknowledgements; a generic scripted next question unrelated to the answer; a follow-up that supplies the answer or leads; a question already answered; follow-ups about later-category topics.
- **Acceptable (illustrative).** The prospect says they came to explore digital marketing; the salesperson asks what they mean by it or why it interests them (the S2 worked example has the same shape).
- **Poor (illustrative).** Moving to the next scripted question each time. "So you want to earn lakhs, right?" in response to a learning about ads.

#### C02-05 — Clarification of unclear answers
- **Behaviour evaluated.** When an answer on one of the five areas is vague, incomplete, contradictory or evasive, the salesperson clarifies it instead of assuming it or moving on. *Basis: cross-cutting questioning guidance approved under U02-01 (rephrase when the prospect avoids answering; do not move to the next step before receiving the previous answer; do not assume).*
- **Unit of evaluation.** Each unclear-answer event.
- **Expected observable elements.** **C** — a clarification attempt (§12.4). **R** — resolution: the information is now established, **or** the salesperson acknowledges it remains unclear and proceeds respectfully (§12.4) without pressure.
- **Strong evidence.** Every substantive unclear-answer event is clarified with a qualifying attempt and resolved or respectfully left unresolved; quotes show the unclear answer, the clarifying question and the outcome.
- **Partial evidence.** Some events clarified and others passed over; or clarification attempted but left unresolved without any acknowledgement.
- **Does not qualify.** Repeating a question verbatim; a leading "clarification" supplying the answer; re-asking something that was clearly answered (understanding check, not C02-05).
- **Acceptable (illustrative).** The prospect says "just to learn"; the salesperson asks "What would you like to learn first?" The prospect dodges, the salesperson rephrases once, then moves on respectfully.
- **Poor (illustrative).** Accepting "just to learn" and moving on as if it were clear. Repeating the same question after the prospect has declined. Filling in a purpose for the prospect.

#### C02-06 — Intent established before advancing or pitching
- **Behaviour evaluated.** The salesperson establishes, or genuinely attempts to establish, the prospect's purpose before pitching, and does not assume intent. *Basis: cross-cutting questioning guidance approved under U02-01 (do not move to the next step before receiving the previous answer; do not assume information about the prospect); checklist order corroborates.*
- **Expected observable elements.** **V1** — sequence: no premature pitch before the prospect's purpose (I1) was established or **genuinely attempted** (§12.4); if the answer was missing or unclear, a clarification attempt was made where appropriate, and a prospect who stays unwilling or unable is **respectfully proceeded with**. **V2** — no assumed intent: the salesperson does not state the prospect's intent, goals or interest as fact before the prospect said it, and does not treat webinar attendance as intent to buy.
- **A question alone never earns 3.** Asking a qualifying question and then pitching without an answer and without a reasonable clarification attempt does not satisfy V1.
- **Strong evidence.** Purpose established before any pitch statement; or a genuine attempt followed by respectful proceeding; no assumption statements. Quotes for the purpose question, the prospect's response, any clarification attempt, the acknowledgement, and the first pitch statement.
- **Partial evidence.** One brief premature-pitch lapse followed by a visible return to discovery.
- **Does not qualify.** A brief factual answer to a prospect-initiated question followed by a return to discovery; describing the call's purpose (Category 01).
- **Acceptable (illustrative).** The prospect asks about price early; the salesperson answers briefly and returns to why the prospect joined. The prospect declines to say why; the salesperson rephrases once, acknowledges, and moves on without assuming.
- **Poor (illustrative).** Presenting features and an offer straight after the introduction. "You are here to launch your course, so let me show you…" when the prospect never said so. Asking "why did you attend?", getting no answer, and starting the pitch.

### 12.6 Detailed scoring definitions

Outcomes are exactly as in §5.1: **0** applicable, observable, reliable, not demonstrated (the inherited absence record, §6.2 and §12.7, is **required for every 0**); **1** poor or very limited; **2** partial; **3** effective; **N/A** genuinely does not apply (§12.8); **NE** insufficient reliable evidence (§12.8). No weights and no overall score are introduced.

**C02-01 Purpose of attendance and C02-02 Webinar learnings** (same structure):

| Score | Conditions |
|---|---|
| **3** | A qualifying question (or a volunteered answer) **and** specific information established in the prospect's own words (C02-01: a concrete reason; C02-02: at least one specific learning) **and** the understanding check passes. |
| **2** | Information established only generically and not clarified; **or** established but the understanding check fails. |
| **1** | A question was asked but **no usable information was established** (no answer, off-topic answer; an answer that exists but is absent from the transcript is NE, §12.8); **or** the only "information" came from the salesperson's leading or assumptive statement with at most a bare agreement. |
| **0** | Applicable and observable; no qualifying question and no volunteered information anywhere in the readable transcript, and the area was not unreached (U02-16). Absence record required. |

**C02-03 Following history and source of interest** (criterion-level scoring table, unchanged in substance; element-level records kept for D, W, S):

| Score | Conditions |
|---|---|
| **3** | D, W and S all established **and** the understanding check passes. |
| **2** | Exactly two established; **or** all three established but the understanding check fails. |
| **1** | Exactly one established; **or** none established but at least one asked. |
| **0** | Applicable and observable; none asked and none volunteered anywhere, and the elements were not unreached (U02-16). Absence record required, kept per element. |

**C02-04 Reflection and follow-up.** Response types: **R** reflection; **F** neutral keyword-based follow-up; **A** bare acknowledgement; **L** non-neutral follow-up (leading, assumptive, pressuring); **G** generic move-on (next scripted question unrelated to the answer, no acknowledgement).

| Score | Conditions |
|---|---|
| **3** | The **reflection threshold is met** (all answers if 1–2; ⌈75%⌉ if 3 or more) **and** neutral keyword-based follow-ups on **at least two distinct** substantive answers (or on the sole substantive answer if only one exists). |
| **2** | At least one reflection or at least one neutral keyword-based follow-up exists, but the conditions for 3 are not both met. |
| **1** | No reflection and no neutral follow-up, but at least one bare acknowledgement (A) or non-neutral follow-up (L) in response to substantive answers. |
| **0** | At least one substantive answer exists, observable and reliable, and every substantive answer was met only with a generic move-on (G): no reflection, follow-up or acknowledgement of any kind. Absence record required. |

**C02-05 Clarification of unclear answers:**

| Score | Conditions |
|---|---|
| **3** | Every substantive unclear-answer event clarified with a clarification attempt and resolved, or respectfully left unresolved with acknowledgement (respectfully proceeding). |
| **2** | Some events clarified and others passed over; or a clarification attempted but left unresolved with no acknowledgement. |
| **1** | An attempt exists but is poor: leading, assuming the answer, pressuring, verbatim repetition only, or aimed at the wrong point. |
| **0** | At least one unclear-answer event, observable, with **no clarification attempt anywhere** and the salesperson proceeds as if the answer were clear. Absence record required. |

**C02-06 Intent established before advancing or pitching** (revised per owner decision):

| Score | Conditions |
|---|---|
| **3 — Effective** | The prospect's purpose is **established before pitching**; **or** the salesperson makes a **genuine attempt** to understand and clarify it (qualifying question plus a clarification attempt where appropriate), the prospect remains unwilling or unable to give more, and the salesperson **respectfully proceeds** (acknowledges, no pressure, no invented assumptions). No premature pitch and no assumed intent. **A simple unanswered question, without a reasonable clarification attempt where appropriate, does not qualify for 3.** |
| **2 — Partial** | **One brief premature-pitch lapse**, after which the salesperson recognises the sequence issue and **returns to discovery** (visible as a return to discovery questions or an explicit return). A single isolated assumed-intent statement that is then corrected by a question is treated the same way (U02-18). |
| **1 — Poor** | **Sustained or repeated** premature pitching; **repeated** assumptions about intent; or pitching **at length** before the purpose was established, **including** a question asked but pitching proceeding without an answer and without a reasonable clarification attempt, and premature pitching not followed by a return to discovery. |
| **0 — Not demonstrated** | The salesperson moves into pitching, presenting an offer or closing **without any attempt** to understand the prospect's purpose anywhere in the readable transcript. Absence record required. |
| **N/A** | No transition or pitch occurs **and** there is no assumed-intent behaviour in the observable conversation; reason `no_transition_observed`. If the transcript is incomplete, NE. **No automatic 3 for the absence of a pitch** (U02-09). |

**Boundary rules (reviewer alignment).**
1. Assign each salesperson turn to one criterion and apply the one-incident-once rule (§12.4).
2. Meaning over keywords. A mention of "webinar", "learn" or "FlexiFunnels" outside the behaviour earns nothing. No score may rest on a keyword match or on the mere fact that a question was asked.
3. Wording is never mandatory. S2 question wording is illustrative.
4. A later revisit counts only if it clearly concerns the same topic or the same earlier answer (the contextual-validation principle of §3.1).
5. **Ambiguity tie-break (Q8):** if two adjacent scores both seem plausible because of the salesperson's **wording**, choose the lower and state the ambiguity; if the ambiguity comes from **transcript quality**, report NE.
6. A prospect's uncertainty, general-learning purpose or lack of buying interest never lowers a score by itself (§12.9).
7. No criterion rewards manipulation, pressure or assumed intent: leading and pressuring questions are not qualifying questions, and pressure after a clear decline earns no credit in any criterion.

### 12.7 Evidence requirements

Category 02 follows §6 (fields, timestamp rules, no fabrication, robustness to transcription limits) with these additions.

**Unit of evidence: the exchange.** Record the salesperson's question or statement (exact quote, timestamp, speaker); the prospect's answer (exact quote, timestamp, speaker); the salesperson's next relevant turn (exact quote, timestamp) showing reflection, follow-up or clarification. Evidence may be in different places; each has its own timestamps.

**Fields for every information area (I1 to I5, and D, W, S under C02-03):**
- `question_asked` — yes/no, with quote, timestamp, and whether it passes the qualifying-question test;
- `volunteered` — yes/no, with quote and timestamp;
- `information_established` — yes / partial / no / **not_transcribed**;
- `prospect_quote` and `timestamp` — the prospect's exact words;
- `evidence_confidence` and `transcript_quality_flags`.

**Rules.**
1. **Questions versus information.** A question with no answer in the transcript is `question_asked = yes`, `information_established = no`. A restatement by the salesperson does not establish information. A bare agreement establishes agreement only.
2. **Volunteered information** counts as established; C02-04 then judges whether it was acknowledged and explored.
3. **Silence and missing text are not evidence of behaviour.** If the salesperson's next turn presupposes an answer that is absent from the transcript, set `information_established = not_transcribed` and treat that element as **NE** (U02-12). Never infer or quote words the transcript does not contain.
4. **Revisits.** A later clarification or revisit counts where the context clearly ties it to the earlier answer.
5. **Whole conversation.** Evaluate the complete readable transcript, not keywords (U02-13). Later questions can count for C02-01 to C02-03 where the context is clear; sequence and timing are judged only in C02-06.
6. **Speaker attribution.** State how the speaker was inferred; if an answer cannot be attributed to the prospect reasonably, the element is NE.
7. **Language.** Accept equivalent renderings in Hindi, English or Hinglish and either script; a garbled word is not proof of a missing behaviour (§6.4).

**Absence record for every score of 0 (inherited from §6.2).** No quotation proving absence is ever required or invented.

| Field | Requirement |
|---|---|
| observable_window | The stage window as observed, plus a statement that the whole readable transcript was searched. |
| progression_excerpts | Enough **exact** excerpts, with timestamps and speakers, to show how the conversation progressed from the introduction into the next stage or pitch. Two or more preferred; one permitted if that is all the observable window contains. They show what *was* said, not that something was absent. |
| absence_explanation | What was looked for, that none appears, and what the salesperson did instead. For C02-03, kept per element (D, W, S). |
| whole_transcript_search | The rest of the readable transcript was searched with the contextual validation of §3.1. |
| evidence_confidence, transcript_quality_flags | As §6.2, including every gap over 5 s overlapping the stage window. |

The **zero-eligibility test** of §6.2 applies unchanged (applicability, observability, reliability, whole-transcript search), plus: the area was not **unreached** because the prospect ended the call (U02-16). Sufficiency of excerpts is judged as in §6.2 (no fixed minimum; never fabricated; NE if insufficient).

**Unreached versus skipped record (U02-16).** For any area the evaluator treats as unreached or skipped, state with timestamps and quotes: (a) the prospect's exact words clearly asking to end or decline, with timestamp; (b) what the salesperson said between the end of the introduction and that point; (c) the judgement — **unreached** (the prospect ended the call before the salesperson could reasonably have reached the area in sequence) or **skipped** (the salesperson had the opportunity and did not cover it, including by spending turns on unnecessary delay or unrelated conversation).

**Non-scored flags for human review** (`human_review_flags`):
- `leading_question`, `pressure_to_express_interest`, `ignored_stated_disinterest`, `assumed_intent`, `persistence_after_decline`;
- `possible_interruption` — **only a pointer for audio review (U02-06).** A statement that appears cut off, or missing words, in the transcript can be a chunk-boundary artefact or a transcription omission and must **never** be treated as proof of interruption, and must never be scored from the transcript;
- `misleading_or_unverified_claim` — a non-scripted checkable claim or fabricated urgency, recorded with quote and timestamp and handled as in §5.4 (the evaluator does not assert falsehood without evidence; result provisional pending review);
- call-type conflict (§7).

### 12.8 Applicability, N/A, NE and edge cases

**Applicability (U02-14).** The Category 01 rule is retained: Category 02 applies to **new webinar-attendee prospect calls**. Call type is a human-confirmed input (§13.4); if it is missing or conflicts with other information, the evaluator **holds** the call and asks a human (after a human re-confirms with the conflict visible, the label stands: `call_type_conflict_acknowledged`). A call confirmed as another type is **N/A** with the provisional reason `call_type_not_covered`, per the applicability matrix in §13.5 (U2 and U3 resolved). Separate rubrics for renewal, follow-up and continuation calls are future work.

**N/A reasons.**
- All criteria: `no_conversation`; `call_type_not_covered`.
- C02-04: `no_substantive_answer` — there is genuinely no substantive answer to reflect on or explore (U02-10).
- C02-05: `no_unclear_answer` — no unclear-answer event occurred (U02-10).
- C02-06: `no_transition_observed` — no pitch, offer, price or closing statement and no assumed-intent behaviour in the observable conversation (U02-09).

**N/A must not hide a failure to ask.** C02-01 to C02-03 are **never** N/A for lack of answers or lack of questions; a failure to ask the expected questions is scored there (0 or a low score). `no_substantive_answer` and `no_unclear_answer` apply to C02-04 and C02-05 only, and only after the failure to obtain answers has been recorded in C02-01 to C02-03.

**NE.** As §5.3, including: transcript around the stage window missing, cut off or garbled so the decisive words cannot be read; the recording begins midway and elements are not observable; speaker attribution uncertain and decisive; an answer implied by the salesperson's next turn but absent from the transcript (`not_transcribed`, U02-12); an area judged **unreached** under U02-16; an uncertain element that could change the band. If only some elements are uncertain and the rest settle the band, give the score with `evidence_confidence = low`.

**Edge cases.**

| Situation | Handling |
|---|---|
| The prospect clearly explains their intent without being asked | Counts as volunteered, established information (C02-01 to C02-03 need no question). C02-04 then judges whether the salesperson reflected on and explored it. Re-asking the same thing later fails the understanding check (cap 2, counted once). |
| Vague or contradictory answers | Unclear-answer events for C02-05; contradictions are clarified, not ignored; a later clarification counts if clearly tied. Counted in C02-05 only. |
| The prospect is not interested in purchasing | Scores measure the salesperson's understanding behaviours, never willingness to buy. Evaluate whether the salesperson understood and acknowledged the response accurately and respectfully. Ignoring or pressuring after a stated lack of interest earns no reflection credit, raises `ignored_stated_disinterest` or `persistence_after_decline`, and a pressuring question is not a qualifying question. |
| The prospect attended for general learning rather than to buy | A valid purpose; established and scored normally. Treating attendance as buying intent is assumed intent (C02-06 V2). |
| Relevant questions but the salesperson does not listen | C02-01 to C02-03 may still show established information. The failure is counted once: no reflection or follow-up in C02-04, or re-asking or contradiction in the understanding check. |
| The conversation moves directly into a pitch | C02-06 scores 0 (no attempt to understand the purpose) or 1 (question asked, pitch without answer and without clarification); C02-01 to C02-03 score 0 or low if never asked or volunteered (absence records), in a reliable, observable transcript. |
| The recording begins after the opening portion | Elements in an unobserved part are **not observable**, not "never demonstrated": NE unless the observed elements already reach the top band (logic of §5.3). Elements found later in the transcript still count. |
| Missing, garbled or unreliable transcript sections | NE where the decisive evidence cannot be read; no low score for what cannot be seen (§5.3, §6.4). |
| Call type missing or unconfirmed | Hold, ask a human (§7). |
| The prospect ends or declines to continue the call (U02-16) | If the prospect clearly asks to end the call **before the salesperson had a reasonable opportunity** to cover an expected area, that area is **unreached**: NE, not 0. If the salesperson had the opportunity and skipped it (including through unnecessary delay or unrelated conversation), the omission is scored normally. Areas addressed before the prospect ended the call are scored normally. The evaluator must record the unreached-versus-skipped explanation (§12.7). No credit is given for pressure or persistence after a clear decline. |

### 12.9 Ethical and behavioural safeguards

| Behaviour that must not be rewarded | How the rubric excludes it |
|---|---|
| Leading or manipulative questions | Not qualifying questions; information obtained through them is not "established"; flagged `leading_question`. |
| Interrupting or speaking over the prospect | Not scored from the transcript; `possible_interruption` is a pointer for audio review only (U02-06). |
| Assuming the prospect's intent | C02-06 V2; an assumed statement establishes nothing. |
| Pressuring the prospect to express interest | A pressuring question is not a qualifying question; `pressure_to_express_interest`; poor in C02-05 if used as "clarification"; no credit for persistence after a clear decline. |
| Ignoring stated lack of interest | No reflection credit; `ignored_stated_disinterest`. |
| Treating webinar attendance as buying intent | C02-06 V2. |
| Premature pitching | C02-06 V1 (§12.4). |
| Fabricated urgency, false promises, misleading statements | Flagged with quote and timestamp; the evaluator does not assert falsehood without evidence (§5.4); no credit for an exchange built on pressure; provisional result pending review. |

A prospect expressing uncertainty or having no immediate purchase intention **never** produces a poor score by itself. Prospect personal characteristics are never used (§8, Q10).

### 12.10 Known limitations and assumptions

**Known limitations**
1. **Short replies can be missing from the transcript.** In the Agent 1 experiments, short replies (for example "Yes, right.", "It was one time full.") appeared in the English-only run but were dropped from some Hindi runs. Prospect answers in Category 02 are often short, so missing replies are a real risk; hence `not_transcribed` and NE (U02-12).
2. **No speaker labels or overlap capture.** Attribution is inferred; interruptions cannot be detected from the transcript.
3. **Chunk-boundary artefacts.** Cut-off words at chunk edges can look like interruptions or truncated answers and must not be used as behaviour evidence.
4. **Hindi-English accuracy** is about 2–3 out of 5 in human review (§8).
5. **Calibration rules are provisional.** The 75% reflection threshold (rounded up), the two-answer follow-up condition, the answer-counting convention (U02-17) and the premature-pitch boundaries are owner-approved or drafting calibrations, untested on real calls, and are to be reviewed after real-call evaluation (with U8).
6. **Judgement-based terms.** "Neutral", "specific", "sustained", "brief" and "reasonable opportunity" require judgement and are defined in §12.4; calibration will test them.
7. **Source scope.** The S2 video, the Google Docs linked from the checklist and any unseen versions of the checklist were not reviewed.
8. **Untested.** No call has yet been scored against Category 02.

**Assumptions**
- A4. Category 02 wording is taken from S1 section 2 (verified at this revision, U02-15).
- A5. Hindi, English and Hinglish are equally acceptable (Q14).
- A6. A human supplies call type until metadata rules exist (§7).

### 12.11 Open-question register (U02-01 to U02-18)

All questions are resolved. The original ambiguity is preserved; the final resolution records the project owner's decision or approved interpretation. U02-17 and U02-18 are new issues found during this revision and carry a provisional drafting resolution that the owner may overrule.

| ID | Original ambiguity | Final resolution | Status |
|---|---|---|---|
| U02-01 | May cross-cutting checklist guidelines (Monologue Guidelines, Sales Psychology Parameters, Call recording feedback) define scored Category 02 criteria? Category 01 used them only as conduct references. C02-04, C02-05 and C02-06 depend on them. | **Approved.** Questioning-method guidance may define scored criteria (keyword-based follow-ups; do not move on before the previous answer; rephrase when the prospect avoids answering; do not assume; two-way communication; listen). C02-04, C02-05, C02-06 retained, with the source basis documented and separated from direct checklist requirements (§12.1). The 60-second monologue limit, small-talk restrictions and talk-time balance are **not** introduced. | Resolved — owner decision |
| U02-02 | Is asking all five S1 section 2 items mandatory on every call, or may the salesperson skip items per S2 ("for reference… based on the call you can pick")? | **All five areas are expected.** Exact scripted wording is not required; volunteered information counts as established; a question without a meaningful answer does not; a bare yes/haan establishes agreement only; an area neither asked nor volunteered is missing; natural, conversation-led wording is never penalised (§12.4). | Resolved — owner decision |
| U02-03 | Is "Top 3" literal (three learnings required)? | **One specific learning is sufficient** for the highest score; generic remarks are not specific; fewer than three is never penalised (§12.4, C02-02). | Resolved — owner decision |
| U02-04 | S1 puts "how long followed", "why follow" and "how found the webinar" in Understanding Intent; S2 lists them with the persona questions. Confirm S1 prevails. | **S1 prevails.** D, W and S stay in C02-03 with separate element-level evidence and are not moved to Customer Persona (§12.5). | Resolved — owner decision |
| U02-05 | Prospect expectations from the webinar, call or solution were suggested for investigation but are not in S1 section 2 (the nearest S1 item is section 11). Add a criterion or leave to a later category? | **Excluded** from Category 02: no criterion and no implicit requirement. May be reconsidered when the relevant later category is developed, if the authoritative checklist supports it (§12.2). | Resolved — owner decision |
| U02-06 | "Allow customers to finish speaking", "avoid one-sided conversations" and talk balance exist in S1, but cannot be measured reliably (no speaker labels or overlap). Score, flag only, or reserve for a later category with speaker timing? | **Flag only; not scored from the transcript.** `possible_interruption` remains a human-review pointer for audio review; chunk-boundary artefacts or missing words are never proof of interruption (§12.7). | Resolved — owner decision |
| U02-07 | C02-04 thresholds: "neutral keyword follow-ups on at least two distinct answers" for 3 (or one if only one answer). | Follow-up condition retained. The vague "reflection of most substantive answers" is replaced by the measurable threshold (all if 1–2 answers; ⌈75%⌉ if 3 or more), marked a **provisional owner-approved calibration rule**, not a source quotation (§12.5). | Resolved — owner-approved interpretation (provisional calibration) |
| U02-08 | Premature-pitch definition and thresholds: one brief lapse scores 2; sustained, repeated or assumed intent scores 1. Are early brief answers to prospect questions allowed? | C02-06 scoring revised (§12.6): 3 only if purpose established, or genuinely attempted then respectfully proceeded; 2 for one brief lapse followed by a return to discovery; 1 for sustained or repeated pitching, repeated assumptions, or pitching at length (including an unanswered question followed by a pitch without clarification); 0 for no attempt. A brief factual response to a prospect-initiated question is not automatically a premature pitch if the salesperson returns to discovery. | Resolved — owner-approved interpretation |
| U02-09 | C02-06 when no pitch occurs in the call: N/A or an automatic 3? | **N/A**, reason `no_transition_observed`. No automatic 3 for the absence of a pitch. | Resolved — owner-approved interpretation |
| U02-10 | C02-04 and C02-05 when there is nothing to respond to (no substantive answer, or no unclear answer): N/A or low score? | **N/A** with `no_substantive_answer` (C02-04) and `no_unclear_answer` (C02-05) when genuinely applicable. N/A must not hide a failure to ask: that is scored in C02-01 to C02-03 (§12.8). | Resolved — owner-approved interpretation |
| U02-11 | Is a bare "yes/haan" to a salesperson-supplied purpose enough to establish intent? | **No.** It establishes agreement only, not the prospect's actual intent or reason (§12.4). | Resolved — owner-approved interpretation |
| U02-12 | Answer missing from the transcript but implied by the salesperson's next turn: NE or infer? | **NE** with `not_transcribed`; the missing prospect response is never inferred or fabricated (§12.7). | Resolved — owner-approved interpretation |
| U02-13 | Time scope: C02-01 to C02-03 search the whole call (a question asked later counts); order is judged only by C02-06. | **Retained.** Whole-readable-transcript search; later questions count for C02-01 to C02-03 where the context is clear; sequence and timing are assessed separately in C02-06 (§12.7). | Resolved — owner-approved interpretation |
| U02-14 | Call-type applicability for Category 02: same as Q1 (new webinar-attendee prospect calls). Do renewals and follow-ups get their own intent criteria (ties to U2 and U3)? | **Retained.** Category 02 applies to new webinar-attendee prospect calls; missing or conflicting call type means human hold; confirmed other types are N/A with the provisional `call_type_not_covered`. Rules for other call types remain tracked under U2 and U3 (§9.2) and are not a Category 02 scoring question. | Resolved — owner-approved interpretation |
| U02-15 | Confirm that the S1 section 2 wording used here (five items, including "Top 3 learnings") matches the authoritative checklist text supplied in the conversation. | **Verified at this revision** against the checklist document available in the project materials (the file with the checklist's title): the five items match word for word, as do the cross-cutting guidelines cited. The owner's restatement of the five areas in the Revision 3 instruction is consistent with them. The conversation text itself was not separately re-read. Wording not changed; no items added. | Resolved — verified against available source |
| U02-16 | If the prospect declines or ends the conversation before an item is reached, are unasked items NE or 0? | **Revised rule:** unreached (the prospect clearly ended the call before the salesperson had a reasonable opportunity) is NE, not 0; skipped (the opportunity existed) is scored normally; unnecessary delay or unrelated conversation does not earn unreached status; items addressed earlier are scored normally; no pressure or persistence after a clear decline; the evaluator records why an item was unreached or skipped (§12.4, §12.7, §12.8). | Resolved — owner decision |
| U02-17 *(new)* | **What counts as one substantive answer** for the C02-04 threshold, given that a single prospect turn can contain several ideas and later answers can repeat earlier ones. | Drafting convention (§12.4): count distinct answers in transcript order; two areas in one statement count as two answers; a later answer counts separately only if it adds a new concrete idea; generic, evasive or unclear answers are not substantive. | Resolved provisionally — owner may overrule; review at calibration |
| U02-18 *(new)* | **A single isolated assumed-intent statement.** The owner's C02-06 text names a brief premature-pitch lapse (score 2) and *repeated* assumptions (score 1) but not one isolated assumption. | Treated like a brief lapse (score 2) when it is corrected by a question and discovery resumes; repeated assumptions score 1 (§12.6). This keeps the prior draft's behaviour. | Resolved provisionally — owner may overrule; review at calibration |

*Category 02 status: APPROVED by the project owner on 2026-11-14 (U02-17 and U02-18 remain provisional calibration items).*

## 13. DRAFT PROPOSAL — Call-type applicability and identification (U2, U3)

> **APPROVED by the project owner on 2026-11-14 ("Approve as proposed"). U2 and U3 are resolved (§9.4).** Every recommended default in §13.10 is adopted as the owner's decision, and text below labelled "proposed" or [Recommendation] records the approved rule. This section defines call-type applicability and identification; it does not change any criterion, score table or evidence rule of Category 01 (§3–§9) or Category 02 (§12). The only wording updated elsewhere is the applicability text in §7, §12.8, §1, §9.2, §10 and the revision log (§13.11). Nothing is implemented in code, Callyzer, D1 or Google Sheets.

Evidence labels used below: **[Confirmed]** = verified in the approved document, the project code or data, or the Callyzer documentation read for this proposal. **[Assumption]** = something not verified. **[Recommendation]** = my proposal for the owner to decide.

### 13.1 Currently approved rules [Confirmed]

| Item | Approved rule | Where |
|---|---|---|
| Applicability | Category 01 and Category 02 apply to **new webinar-attendee prospect calls** (Q1, U02-14). | §3, §7, §12.3, §12.8 |
| Call type source | Call type is a **required human-supplied input**; the evaluator does not decide it. | §7, §12.8, A3, A6 |
| Missing or conflicting call type | The call is **held**; the evaluator asks a human. It is **not** scored as 0. Hold is a process state, not a score. | §7 |
| Other confirmed call types | Criteria are **N/A**, reason `call_type_not_covered`. This is **provisional**: it means v1 has no rule for the type, not that such calls need no introduction. | §7, §12.8 |
| No conversation | **N/A**, reason `no_conversation` (unanswered, voicemail, wrong number, immediate disconnect). | §7, §12.8 |
| Zero scores | Require the call to be applicable, observable and reliable (zero-eligibility test, applicability first). | §6.2 |
| Open items | U2 (renewal, follow-up, continuation rules) and U3 (how call type is supplied). | §9.2 |

### 13.2 What the data sources actually contain

**Callyzer API v2.3 documentation** (one documentation page, read for this proposal; parts were read through summaries, so details marked uncertain by the reader are less reliable) [Confirmed]:
- A call record has: `id`, employee fields (`emp_name`, `emp_code`, `emp_number`, `emp_country_code`, `emp_tags`), client fields (`client_name`, `client_country_code`, `client_number`), `duration`, `call_type`, `call_date`, `call_time`, `note`, `call_recording_url`, `lead_id`, `crm_status`, `reminder_date`, `reminder_time`, `synced_at`, `modified_at`, `call_method`, `call_mode`, `ringing_time`.
- Documented `call_type` values: Incoming, Outgoing, Missed, Rejected. This is **call direction and outcome, not business purpose**.
- `crm_status` is documented only as the "status of the lead updated with this call"; its allowed values are **not** documented and appear to be account-specific. `lead_id` links a call to a lead. `note` is free text. `reminder_date` and `reminder_time` are a callback reminder. `emp_tags` are employee-level labels; leads can carry `lead_tags` through the lead endpoints.
- **No field or endpoint is documented as the business purpose of a call** (new prospect, follow-up, renewal, support).

**Project code and data** [Confirmed]: `CallRecord` in `src/callyzer/types.ts` mirrors the same fields. The D1 `calls` table stores Callyzer's `call_type` (direction), `call_method` and `call_mode`; it does not store `crm_status`, `lead_id`, `note` or tags. **Naming risk [Recommendation]:** a future business call-type field must not reuse the name `call_type`.

**Live check of the account's data** (one read-only page of the 50 most recent PhoneCall/Voice records from the last 30 days; counts only, no customer data recorded) [Confirmed, small sample, this account only]:
- `call_type`: Outgoing 30, Incoming 9, Missed 8, Rejected 3.
- `crm_status`, `lead_id`, `note` and `reminder_date`: **empty in all 50 records**.
- `emp_tags`: present on all 50 (employee-level, not call-level).
- 22 of the 50 records shared a client number with another record in the page (repeat contacts are visible in the history).
- Only 8 of the 50 records had a recording URL.

**Process documents** [Confirmed]: no renewal, follow-up or continuation process appears in S1, S2 or S3 as read. S1 describes a first-contact journey. The Google Docs linked from S1 were not accessible.

**Phase 1 calls** [Confirmed]: the five calls were selected on agent, duration (15–30 minutes) and recording availability, **not** call type, so their types are unknown. **Observation, not a source** [Assumption]: the Agent 1 machine transcript, unverified, appears to be a renewal or continuation call.

### 13.3 U2 — Applicability rules for follow-up, renewal and continuation calls

**Exact ambiguity.** Categories 01 and 02 were written for a first conversation with a webinar attendee. What should happen when the call is a follow-up, a renewal, a continuation, a support call, or of unknown type?

**Why it matters.** Applying first-contact criteria to other calls would create false zeros (for example "selected for a 1:1 session" in a follow-up) and could penalise correct behaviour (S1 says "Don't repeat the same questions", so repeating Category 02 questions in a follow-up would be wrong). Leaving the types undefined leaves calls unmeasured.

**Findings by call type.**

| Type | Introduction (C01) | Understanding Intent (C02) | Notes |
|---|---|---|---|
| **A. New webinar-attendee prospect** | Applies (approved). | Applies (approved). | Existing rules. "First" means the first substantive two-way sales conversation; earlier unanswered attempts or a conversation that only rescheduled do not make a later call a follow-up. The threshold for "substantive prior interaction" needs the owner's definition (D-U2-3). |
| **B. Follow-up** (new call after an earlier sales interaction) | The approved criteria fit poorly: the 1:1 selection and 20-minute expectation are first-contact messages. A brief re-identification and statement of purpose is natural, but no source defines it. | Re-asking the five areas is discouraged by S1; what was already established is unknown without the earlier record. | No source defines follow-up behaviour (§13.2). |
| **C. Renewal** (existing customer, renewal of a product, course or service) | The prospect-introduction script does not describe a renewal; the buyer is already a customer. | The webinar-intent questions (why attended, learnings, how found the webinar) are not the renewal discovery questions. | Renewal conversations do not follow the new-prospect journey. A separate renewal rubric is likely needed; its content must come from the owner. |
| **D. Continuation** (continues an earlier discussion, demonstration or consultation) | The introduction already happened; repeating it fully is not required by any source. | Earlier answers may be known; the evaluator cannot tell without the earlier record. | Subtypes: a call resumed after a disconnect, and the next session of a multi-session process. |
| **E. Other or unknown** | See §13.6. | See §13.6. | Support, existing-customer assistance, wrong numbers, unanswered calls, unclear purpose, conflicting evidence. |

**Options for B, C and D.**

| Option | Advantages | Disadvantages |
|---|---|---|
| **X. Apply C01 and C02 with adapted expectations** | No calls left unmeasured. | Needs invented expectations with no source; false zeros and NE; scores would not mean the same thing as first-contact scores. |
| **Y. Do not score C01 and C02 for these types (N/A, `call_type_not_covered`) until type-specific criteria are approved** [Recommendation] | Matches the approved provisional rule; no invented requirements; no false zeros; keeps scores comparable. | These calls are not measured at all until separate criteria exist. |
| **Z. Draft separate follow-up, renewal and continuation rubrics** | Measures the real behaviours of each call. | Needs source material (processes, scripts) the owner has not supplied; more design work. |

**Recommendation [Recommendation].** Adopt **Y now** and treat **Z as future work** for renewal and follow-up when the owner supplies the process. Use the same handling for follow-up and continuation in v1 (neither is scored by C01 or C02), but keep separate labels because they need different history. Calls of these types still receive the call-type-independent safeguards (misleading claims, pressure) as flags (D-U2-8).

**Effect on Category 01 and 02.** No change to criteria, scoring or evidence rules. If approved, only the applicability wording in §7, §12.3 and §12.8 would be updated (§13.10). Calls of types B, C and D move from "held until a human confirms" to "N/A once the type is confirmed".

**Effect on future categories.** Each category should declare which call types it applies to. Information-gathering categories (customer persona, goals, why now and similar) mirror C02 and would be first-contact categories; categories about pitch, objections and closing may apply to more types and must state their own rule.

**Needed to implement (not implemented).** A human-confirmed call-type label (§13.4); the label vocabulary; the N/A and hold reason codes; for any future history-dependent criterion, access to the earlier call records (§13.7).

### 13.4 U3 — How call type is identified and supplied

**Exact ambiguity.** Who or what supplies the call type, how reliable it must be, and what happens when sources disagree or are absent.

**Why it matters.** Applicability, N/A, hold and the zero-eligibility test all depend on call type; a wrong label silently changes what the evaluator scores.

**Source evaluation.**

| Source | What it can reliably tell | Limits | Proposed role |
|---|---|---|---|
| **1. Human-supplied label** | Business purpose of the call, as judged by someone who knows the context. | Manual effort; labeller bias or inconsistency if the salesperson self-labels; needs a controlled vocabulary and an audit trail. Trivial for five Phase 1 calls; needs a workflow at scale. | **Authoritative.** |
| **2. Callyzer metadata** | Direction and outcome (`call_type`), channel, duration, employee, client number; potentially `lead_id`, `crm_status`, `note`, tags if the account uses them. | **No call-purpose field is documented**; in the sampled records `crm_status`, `lead_id` and `note` were empty, so they cannot identify a type; `crm_status` values are account-specific and undocumented; `note` is free text and may contain personal data; `emp_tags` are employee-level. | **Hint only** (for example direction and duration to exclude non-conversations). |
| **3. CRM or customer records** (purchases, subscriptions, webinar attendee lists) | In principle the most reliable way to tell an existing customer or renewal from a prospect, and to confirm webinar attendance. | **Not available in this project**; availability, authorisation and phone-to-account matching (shared or changed numbers) are unknown [Assumption]. The session has connectors to FlexiFunnels account data (customers, orders, subscriptions); I have **not** queried or verified them and make no assumption about their suitability. | **Supporting evidence to pre-fill a suggested label for a human to confirm**, if the owner approves access. |
| **4. Historical call records** (Callyzer history, our own stored calls) | Whether earlier calls with the same client number exist. In the sample, repeat contacts are visible. | Only calls captured in Callyzer; earlier calls may be unanswered or non-sales; other reps or channels may be missing; matching on a phone number is imperfect; recordings may not be retained. | **Hint only**, and the source of earlier recordings for history-dependent checks (§13.7). |
| **5. Transcript-based inference** | Possible indicators: explicit reference to an earlier conversation, renewal or support vocabulary, absence of an introduction. | Keyword and language pitfalls; garbled Hindi-English transcripts; **mentioning the webinar does not make a call a new prospect call**; a follow-up can restate the webinar. | **Indicator only.** It may raise a conflict flag but never classifies a call alone. |

**Proposed source-of-truth hierarchy [Recommendation].**
1. **Human-confirmed label** (authoritative). Recorded with who confirmed it, when, and on what basis.
2. **Authoritative business records** (CRM, purchases, attendee list), if approved. They suggest a label for a human to confirm; they do not label calls by themselves.
3. **Callyzer metadata and call history** (hints).
4. **Transcript inference** (indicators and conflict flags).

Lower levels **never override** higher levels. The evaluator **never silently guesses** the call type.

**Rules [Recommendation, consistent with §7].**
1. **Missing label:** hold. Never score 0, never guess.
2. **Conflicting information** (for example a human label of "new prospect" while the transcript indicates a renewal, or two sources disagreeing): hold and request human review. A human-supplied label is **not** overridden by transcript evidence. After a human has seen the conflict and **re-confirms** the label, the label stands, recorded as `call_type_conflict_acknowledged`, and evaluation proceeds.
3. **A call is not classified as a new prospect call merely because the transcript mentions a webinar.**
4. **Unclassifiable after review:** the human may record `other_unclassified`; the call is not scored (N/A, `call_type_not_covered`) and the reason is recorded.
5. **Not verified:** whether Callyzer exposes a call-type field. The documentation and the sampled data show none for business purpose.

**Proposed label vocabulary (provisional) [Recommendation].** `new_webinar_prospect`, `follow_up`, `renewal`, `continuation`, `support_existing_customer`, `no_conversation`, `other_unclassified`; plus the states `unlabelled` (hold) and `conflict` (hold). This is a label vocabulary for applicability, **not** a set of scoring categories.

**Proposed label record (conceptual, not a schema) [Recommendation].** `business_call_type`, `labelled_by`, `labelled_at`, `basis` (free text or source), `status` (labelled / unlabelled / conflict / conflict_acknowledged), hint signals attached for the reviewer. Name the field so it does not collide with Callyzer's `call_type`.

**Advantages and disadvantages of the recommended approach.** Advantages: clear authority, no silent guessing, an audit trail, works for Phase 1 with five manual labels, and keeps each lower source useful as a hint. Disadvantages: manual effort and delay, dependence on labeller quality, and a hold on every unlabelled call.

**Effect on Category 01 and 02.** None on scoring. The zero-eligibility test already requires applicability; the approved hold and N/A wording stays valid. **Effect on future categories.** Every category inherits the same call-type gate.

**Needed to implement (not implemented).** A place to store the label and its provenance; a labelling step before evaluation; the reason codes in the evaluation output; optional access to business records; a way to attach hints and conflict flags.

### 13.5 Applicability matrix (proposed)

| Call type | Category 01 | Category 02 | Handling |
|---|---|---|---|
| New webinar-attendee prospect | **Applies** (approved rules) | **Applies** (approved rules) | Existing rules: score normally; NE or 0 as defined in §5–§7 and §12.6–§12.8. |
| Follow-up | **N/A** `call_type_not_covered` (proposed) | **N/A** `call_type_not_covered` (proposed) | Not scored in v1. Safeguard flags still apply. Future follow-up criteria need an owner-supplied process. |
| Renewal | **N/A** `call_type_not_covered` (proposed) | **N/A** `call_type_not_covered` (proposed) | Not scored in v1. A separate renewal rubric is likely needed. |
| Continuation | **N/A** `call_type_not_covered` (proposed) | **N/A** `call_type_not_covered` (proposed) | Not scored in v1. Continuity checks need the earlier record (NE `history_unavailable` in any future criterion). |
| Support / existing-customer assistance | **N/A** `call_type_not_covered` (proposed) | **N/A** `call_type_not_covered` (proposed) | Not a sales call; may be excluded from the evaluation queue (D-U2-6). |
| No conversation (wrong number, unanswered, voicemail, immediate disconnect) | **N/A** `no_conversation` (approved) | **N/A** `no_conversation` (approved) | Existing rule. |
| Unknown or conflicting | **Hold** | **Hold** | No scoring until a human clarifies. Never 0. |

**Why each outcome is appropriate.**
- **N/A (not covered)** for follow-up, renewal, continuation and support: the first-contact criteria do not describe the right behaviour, and no approved source defines the right behaviour, so scoring them would measure the wrong thing. The reason is provisional and is not a statement that these calls need no introduction or discovery.
- **N/A (`no_conversation`)**: there was nothing to evaluate; already approved.
- **Hold** for unknown or conflicting: the evaluator cannot tell whether the category applies, so it must not decide. Hold is not N/A (applicability is unknown) and not NE (the problem is metadata, not transcript evidence).
- **NE** is **not** used for call-type problems. It is reserved for a criterion that applies but whose evidence is insufficient (garbled transcript, recording starting midway), and, in future history-dependent criteria, for missing history (`history_unavailable`, §13.7).

### 13.6 Other and unknown call types

| Situation | Proposed handling |
|---|---|
| Support calls | N/A, `call_type_not_covered`; not a sales call. |
| Existing-customer assistance | N/A, `call_type_not_covered`. |
| Wrong number, unanswered, voicemail | N/A, `no_conversation` (approved). Zero-duration or no-recording calls are already skipped upstream. |
| Purpose cannot be established | Hold. If a human also cannot establish it, they record `other_unclassified`; N/A, `call_type_not_covered`; no score. |
| Conflicting metadata and transcript | Hold and human review. The human-supplied label stands once the human re-confirms with the conflict flag visible (`call_type_conflict_acknowledged`). |

No scoring category is invented for any of these.

### 13.7 Historical context

**Which behaviours need history** [Recommendation, based on the checklist's expectations]:

| Behaviour | Needs | Assessable from the current call alone? |
|---|---|---|
| Repeating questions already answered earlier | Earlier transcript or notes | No. Only a statement inside the current call ("as you told me last time") can be seen, and it cannot be verified. |
| Remembering previously discussed requirements | Earlier transcript or notes | No. |
| Following up on an earlier commitment | Earlier record of the commitment | Partly: the salesperson mentioning it is visible; whether it was accurate or fulfilled is not. |
| A change in the prospect's intent since last time | Earlier record | No. |
| Whether an introduction was already given | Earlier record | Only by explicit statements in the call. |
| Whether information (persona, goals) was already established | Earlier record | No; this is why first-contact information-gathering criteria are not applied to later calls. |

**Behaviour when earlier records are unavailable [Recommendation].**
- Do **not** infer, invent or assume what was said earlier.
- Record `history_status` as available, partial or unavailable.
- Criteria that **do not** need history (honesty, pressure and misleading-claim flags, respectful handling) are evaluated normally.
- Any future criterion that **needs** history returns **NE** with reason `history_unavailable`; it is not 0 and not N/A, because the criterion applies but the evidence is missing.
- Statements in the current call about earlier conversations are recorded as claims (like `unverified_claim`, §5.4), not as facts.
- Partial history (an earlier record with poor transcription) lowers evidence confidence.
- Linking an earlier call to the current one (same client number, same lead) is a suggestion for a human to confirm, not an automatic fact.

**Privacy and data-use [Assumption].** Using a prospect's earlier recordings to evaluate a later call is a data-use decision that I have not checked against consent or retention policy.

### 13.8 N/A, NE and hold: definitions to use together

| Outcome | Meaning | Reason codes |
|---|---|---|
| **N/A** | The category genuinely does not apply. | `no_conversation` (approved); `call_type_not_covered` (approved, provisional); criterion-specific codes in §12.8 |
| **NE** | The category applies but evidence is insufficient. | Existing NE reasons (§5.3, §12.8); proposed future code `history_unavailable` for history-dependent criteria |
| **Hold** | The call cannot be evaluated until a human resolves missing or conflicting call-type information. A process state, not a score. | `call_type_unlabelled`, `call_type_conflict` (proposed names) |

### 13.9 Risks and limitations

1. **Unlabelled calls stall.** Until every call has a human label, nothing is scored; at scale a labelling workflow and owners are needed.
2. **Label quality.** A wrong label is silently authoritative; the audit trail helps but does not prevent errors. Self-labelling by the salesperson may be biased.
3. **N/A leaves calls unmeasured.** Option Y means follow-up, renewal and continuation calls get no score until criteria exist.
4. **Boundary between follow-up and continuation, and between "first" and "prior" interaction, is fuzzy** (D-U2-2, D-U2-3).
5. **No verified metadata signal.** The sampled Callyzer fields that could hint at type were empty; other accounts or later data may differ.
6. **One small sample.** The live check covers one page of 50 records.
7. **Business records unverified.** Availability, authorisation and matching of CRM or purchase records are unknown.
8. **Transcript hints are unreliable** on Hindi-English audio and must stay indicators.
9. **Phase 1 calls are of unknown type**; at least one appears to be a renewal or continuation, so some of the five may be N/A or held under these rules.
10. **Source gap.** No source describes follow-up, renewal or continuation behaviour; the linked Google Docs were not reviewed.

### 13.10 Decisions (all recommended defaults approved by the project owner on 2026-11-14)

| ID | Decision needed | Recommended default | Consequence of the default |
|---|---|---|---|
| D-U2-1 | Follow-up, renewal and continuation calls: N/A until type-specific criteria exist (Option Y), or apply adapted C01 and C02 (X), or draft separate rubrics now (Z)? | Y now, Z later. | These calls are unmeasured in v1; no invented criteria. |
| D-U2-2 | Keep follow-up and continuation as separate labels, or merge them for applicability? | Keep separate labels; same v1 handling. | Different history needs stay visible. |
| D-U2-3 | Definition of "first contact": what counts as a prior substantive interaction (unanswered attempts and reschedule-only calls do not count)? | As stated in §13.3 type A. | Fewer first calls mislabelled as follow-ups. |
| D-U2-4 | Is a renewal rubric wanted, and who supplies the renewal process and sources? | Yes, as future work; owner supplies the process. | Needs source documents before drafting. |
| D-U2-5 | Is a follow-up and continuation rubric wanted, and who supplies the process? | Same as D-U2-4. | Same. |
| D-U2-6 | Support and existing-customer assistance calls: exclude from the evaluation queue, or record as N/A? | Record as N/A with `call_type_not_covered`. | Visible in reporting; no scoring. |
| D-U2-7 | Calls resumed after a disconnect: treat as separate calls or link into one logical call? | No linking in Phase 1; each recording judged by its own label. | Possible false NE or N/A for the second part. |
| D-U2-8 | Do the call-type-independent safeguards (misleading claims, pressure, assumed intent) apply as flags to every sales-related call, even when categories are N/A? | Yes, as flags only. | Conduct is monitored on all call types without scoring. |
| D-U3-1 | Approve the source-of-truth hierarchy in §13.4. | Approve. | Human label authoritative; lower sources are hints. |
| D-U3-2 | Who supplies the human label (salesperson, manager, reviewer), when, and with what audit fields? | A reviewer or manager, before evaluation, with `labelled_by`, `labelled_at`, `basis`. | Avoids self-label bias; manual step. |
| D-U3-3 | Phase 1: label each of the five calls manually before any evaluation? | Yes. | The five calls may be N/A or held as appropriate. |
| D-U3-4 | Are business records (purchases, subscriptions, webinar attendee lists) available and authorised as a supporting source? | Decide separately; not assumed. | Without them, renewals rely on human knowledge. |
| D-U3-5 | Does the Callyzer account use `crm_status`, lead tags or notes consistently enough to rely on them as hints? | Not relied on; check the account configuration. | Callyzer stays a hint source. |
| D-U3-6 | May earlier recordings of the same prospect be used for evaluation (consent, retention, matching)? | Not assumed; decide with privacy review. | History-dependent criteria return `history_unavailable` until decided. |
| D-U3-7 | Conflict handling: a human label stands after the human re-confirms with the conflict visible. | Approve. | Prevents indefinite holds while keeping human authority. |
| D-U3-8 | Field naming: a distinct name for the business call-type label (not `call_type`). | `business_call_type`. | Avoids confusion with Callyzer's `call_type`. |

### 13.11 Wording changes applied after approval

- §7 and §12.8: replace "until separate rules are written" with the approved applicability matrix and reason codes; record `call_type_conflict_acknowledged` and `history_unavailable`.
- §9.2: mark U2 and U3 resolved, with the owner's decisions.
- §10 template: add "applies to which call types" to each category's definition.
- No change to any criterion, score table, evidence rule or approved decision.

*Section 13 status: APPROVED by the project owner on 2026-11-14. U2 and U3 resolved (§9.4). Rubrics for renewal, follow-up and continuation calls, and any integration of business records, remain future work needing owner-supplied sources.*

---

*Version: v1, Revision 4. Category 01 approved 2026-11-14. Category 02 approved 2026-11-14. Call-type applicability and identification (U2, U3; §13) approved 2026-11-14. Categories 03 onward not started. Open items: Category 01 U4, U5, U6 and U8 (§9.2); Category 02 has no unresolved critical scoring question (U02-17 and U02-18 provisional, §12.11). Author: Claude (draft).*
