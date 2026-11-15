# Call-type confirmation needed (illustrative, synthetic)

This document describes the process by which a human confirms the business type of a transcribed call before any evaluation runs. The calls below are **synthetic examples** (`SYNTHETIC-CALL-001` to `SYNTHETIC-CALL-005`); real call details are kept out of the repository.

**No call type is ever inferred by the system and no evaluation runs for a call until a human has confirmed its type.**
The notes in the table are *indicators from a transcript*, not classifications. A reviewer confirms each call as one of:
`new_webinar_prospect`, `follow_up`, `renewal`, `continuation`, `support_existing_customer`, `no_conversation`, or `other_unclassified`.

Confirm with one command per call, where `--agent` is the call number in the local approved-call selection and `--basis` says what the reviewer checked:

```bash
npm run label:call -- --agent 3 --call-type new_webinar_prospect --labelled-by "<your name>" --basis "<what you checked>"
```

| Call | Duration | Transcript | Example indicators a reviewer might note |
|---|---|---|---|
| SYNTHETIC-CALL-001 | about 20 min | complete | The agent refers to an earlier conversation: likely a `continuation`; Categories 01 and 02 are not applicable. |
| SYNTHETIC-CALL-002 | about 18 min | language label disagrees with the script: **transcript quality is poor** | A transcript produced under the wrong language label gives low confidence in any reading; re-transcription is needed first. |
| SYNTHETIC-CALL-003 | about 17 min | complete | The agent refers to a form filled earlier and to an earlier session: may be a post-webinar follow-up rather than a first sales conversation. |
| SYNTHETIC-CALL-004 | about 17 min | complete, mixed languages | A requirements conversation with an existing contact: may not be a webinar attendee. |
| SYNTHETIC-CALL-005 | about 28 min | **incomplete**: the stored recording covers only a fraction of the logged duration | Must not be evaluated until the full recording is obtained (see the transcript quality gate). |

A call whose type is unknown, unconfirmed or conflicting is held: it receives no score and is never treated as a zero.
