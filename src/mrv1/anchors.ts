// Criterion-specific scoring anchors for C03-C19 (MRV1.0). They refine, never replace, the universal 0-3 / N/A / NE framework.
// C01 and C02 keep their approved Revision 4 rules (src/evaluation/rubric.ts). Anchors are model guidance; the guards that can be enforced in code
// (prospect-sourced answers, flag-linked caps) live in validate.ts / engine.ts and are driven by the sets exported here.
import { CATEGORIES } from "./rubric.ts";

export interface Anchor {
  s3: string;
  s2: string;
  s1: string;
  s0: string;
  na: string;
  ne: string;
  evidence: string;
  avoid: string;
}

const NE_STD = "Decisive words are garbled or missing, the speaker cannot be told apart and it matters, a transcript gap overlaps where the behaviour would be, or the next salesperson turn presupposes an answer that is absent from the transcript. A transcript problem is never a 0.";
const ZERO_STD = "A reasonable opportunity existed and the behaviour never occurred anywhere in the readable transcript (absence record required), or it was materially mishandled.";

/** Information the PROSPECT must supply. A question alone never earns more than 1; a usable prospect answer is required for 2 or 3. */
function gather(o: { thing: string; usable: string; vague: string; na: string; avoid?: string; ne?: string }): Anchor {
  return {
    s3: `The prospect's own statement establishes ${o.usable} (asked by the salesperson or volunteered), specific enough to record, and the salesperson responds to it accurately.`,
    s2: `${o.thing} is established but incompletely or generically (${o.vague}) and the salesperson did not clarify the missing detail.`,
    s1: `The topic is raised but no usable answer results (no reply, evasive, off-topic), or the only content is the salesperson's own assumption met with a bare "yes".`,
    s0: ZERO_STD,
    na: o.na,
    ne: o.ne ?? NE_STD,
    evidence: `An exact prospect quotation (or volunteered statement) stating ${o.usable}; plus the salesperson's question when one was asked.`,
    avoid: `A question alone is not an answer. Never infer ${o.thing} from other facts, from the webinar topic or from the salesperson's restatement. ${o.avoid ?? ""}`.trim(),
  };
}

const NO_BUSINESS = "N/A (prospect_has_no_business) only if the prospect has clearly said they have no business or offer yet.";
const DECLINED = "N/A (topic_declined_by_prospect) only if the salesperson asked respectfully and the prospect declined; pressing after a decline earns no credit.";

export const ANCHORS: Record<string, Anchor> = {
  // ---- C03 Customer Persona ----
  "C03-01": gather({ thing: "current occupation", usable: "what the prospect currently does for a living or as a role", vague: "e.g. only 'I work in marketing'", na: "Never N/A: occupation always applies." }),
  "C03-02": gather({ thing: "business and offer", usable: "what business the prospect runs and what product or service they sell", vague: "business named, offer unclear", na: NO_BUSINESS, avoid: "A planned idea is not an existing business (it may count in C04)." }),
  "C03-03": gather({ thing: "marketing channels", usable: "how the prospect currently finds customers (channels used, or that there are none)", vague: "e.g. only 'online'", na: NO_BUSINESS }),
  "C03-04": gather({ thing: "target customers", usable: "who the prospect sells to (a specific audience)", vague: "e.g. 'everyone'", na: NO_BUSINESS }),
  "C03-05": gather({ thing: "sales channels", usable: "where and how sales happen (website, WhatsApp, calls, marketplace, in person)", vague: "e.g. 'people contact me'", na: NO_BUSINESS }),
  "C03-06": gather({ thing: "price range", usable: "the price or price range of the prospect's product or service", vague: "e.g. 'affordable' with no figure", na: `${NO_BUSINESS} Also N/A (not_applicable_to_prospect) if no priced offer exists yet.`, avoid: "Never estimate a price from the type of offer." }),
  "C03-07": gather({ thing: "monthly customers served", usable: "a number or range of customers per month", vague: "e.g. 'a few' or 'some'", na: NO_BUSINESS, avoid: "Never infer customer counts from revenue or team size." }),
  "C03-08": gather({ thing: "annual revenue", usable: "an annual revenue figure or range stated by the prospect", vague: "only a monthly or approximate figure; the salesperson did not confirm the annual figure", na: `${NO_BUSINESS} ${DECLINED}`, avoid: "Never annualise or estimate a figure the prospect did not give; a question about revenue earns nothing without a usable answer." }),
  "C03-09": gather({ thing: "team size", usable: "how many people work in the business (including 'just me')", vague: "e.g. 'a small team'", na: NO_BUSINESS }),
  // ---- C04 Online Business Plan of Action ----
  "C04-01": gather({ thing: "proposed online business plan", usable: "what online business or growth direction the prospect intends", vague: "e.g. 'something online'", na: "N/A (not_applicable_to_prospect) only if the prospect states no intention of an online business and the salesperson acknowledges it.", avoid: "Do not assume a course-based model." }),
  "C04-02": gather({ thing: "offer or course direction", usable: "what the prospect plans to sell (course, coaching, service, product) or that the direction is undecided", vague: "idea named without detail", na: "N/A (not_applicable_to_prospect) if the prospect's model genuinely has no offer to define.", avoid: "Do not force a course-launch discussion on a prospect whose model is not course-based." }),
  "C04-03": {
    s3: "At least two relevant follow-up questions that build on the prospect's own words (audience, pricing, launch, timeline) and the prospect answers them.",
    s2: "One relevant follow-up built on the prospect's words that the prospect answers.",
    s1: "Follow-ups are generic, scripted, leading, or unrelated to what the prospect just said.",
    s0: "The plan is stated and the salesperson moves on with no follow-up despite a clear opportunity.",
    na: "N/A (no_opportunity_arose) if the prospect gave no plan to follow up on (see C04-01).",
    ne: NE_STD,
    evidence: "The prospect's plan statement and the salesperson's follow-up question(s) that reuse its content.",
    avoid: "A scripted next question that ignores the answer is not a follow-up. Depth means specifics, not question count.",
  },
  // ---- C05 Monetary Goals ----
  "C05-01": gather({ thing: "revenue goal", usable: "the income or revenue target (amount and period)", vague: "e.g. 'good income'", na: DECLINED, avoid: "A figure supplied by the salesperson and accepted with 'yes' is not the prospect's goal." }),
  "C05-02": gather({ thing: "goal timeline", usable: "by when the prospect wants to reach the goal", vague: "e.g. 'soon'", na: DECLINED }),
  "C05-03": gather({ thing: "current financial baseline", usable: "the prospect's current income or revenue level (or that it is nil)", vague: "approximate or relative ('okay', 'not much')", na: DECLINED, avoid: "Never infer the baseline from occupation, lifestyle or business type." }),
  "C05-04": gather({ thing: "six-to-twelve-month growth target", usable: "the growth the prospect expects over the next six to twelve months", vague: "direction without a number or period", na: DECLINED }),
  "C05-05": gather({ thing: "financial constraints", usable: "what the prospect can invest or what limits them (budget, obligations, cash flow)", vague: "e.g. 'money is tight' without specifics", na: DECLINED, avoid: "Encouraging the prospect to borrow, use savings or essential funds, or to ignore a stated limit earns nothing (cap at 1) and must be flagged financial_pressure." }),
  // ---- C06 Emotional WHY ----
  "C06-01": gather({ thing: "personal significance", usable: "why the goal matters to the prospect personally, in their own words", vague: "a generic reason ('to be successful')", na: DECLINED, avoid: "Guilt, shame or manufactured emotion earns nothing (flag coercive_emotional_pressure). The salesperson stating the prospect's feelings is not evidence." }),
  "C06-02": gather({ thing: "life or family impact", usable: "how the goal affects the prospect's life or family, in their own words", vague: "mentions family without any impact", na: `${DECLINED} Personal and family information is optional and sensitive: not volunteering it is never a failure.`, avoid: "Never reward probing after the prospect avoids family topics or any use of family as pressure." }),
  // ---- C07 Why Now? ----
  "C07-01": gather({ thing: "current motivation", usable: "what led the prospect to consider action now", vague: "e.g. 'want to grow'", na: DECLINED, avoid: "A deadline or urgency introduced by the salesperson is not the prospect's motivation and earns nothing." }),
  "C07-02": gather({ thing: "timing and previous delay", usable: "why the prospect has not acted earlier and what is different now", vague: "no reason for the delay", na: DECLINED, avoid: "Manufactured urgency or fake deadlines earn nothing (flag fake_urgency)." }),
  // ---- C08 Plan Analysis ----
  "C08-01": gather({ thing: "existing plan", usable: "the steps the prospect currently plans to reach the goal (or that there is no plan)", vague: "a goal restated as a plan", na: "Never N/A: whether a plan exists can always be asked." }),
  "C08-02": {
    s3: "The salesperson explores at least two aspects of the plan (steps, timeline, resources, feasibility) and the prospect answers each.",
    s2: "One aspect explored and answered; others left unexplored.",
    s1: "The plan is acknowledged but only superficially ('okay, good plan') or the salesperson judges it without asking.",
    s0: "A plan was stated and the salesperson never examined it despite a clear opportunity (absence record).",
    na: "N/A (not_applicable_to_prospect) if the prospect states there is no plan (C08-01).",
    ne: NE_STD,
    evidence: "The prospect's plan statement plus the salesperson's questions and the prospect's answers about steps, timing or resources.",
    avoid: "Do not replace the prospect's plan with the salesperson's assumptions. Declaring a plan impractical without asking earns nothing.",
  },
  "C08-03": {
    s3: "A gap between the goal and the plan is articulated, grounded in facts the prospect actually gave, and the prospect acknowledges it or engages with it.",
    s2: "A grounded gap is articulated but the prospect's acknowledgement is unclear or absent.",
    s1: "A gap is asserted from the salesperson's assumptions or the product pitch rather than the prospect's facts.",
    s0: "Goal and plan were both established and no gap discussion took place (absence record).",
    na: "N/A (no_opportunity_arose) if no goal or no plan was established in the transcript.",
    ne: NE_STD,
    evidence: "The prospect's goal and plan statements, the salesperson's statement of the gap, and the prospect's reaction.",
    avoid: "A gap invented to sell the product is not credited. Do not treat 'yes' to a leading gap statement as the prospect recognising it.",
  },
  // ---- C09 Challenges ----
  "C09-01": gather({ thing: "challenges", usable: "the obstacles the prospect names in their own words", vague: "'many problems' without specifics", na: "Never N/A.", avoid: "A challenge suggested by the salesperson and accepted with 'yes' is not established. Do not credit manufactured problems." }),
  "C09-02": gather({ thing: "impact of challenges", usable: "how the challenges affect the prospect's results, time, income or life", vague: "impact implied but not stated", na: "N/A (no_opportunity_arose) if no challenge was established (C09-01).", avoid: "Impact described only by the salesperson is not evidence." }),
  "C09-03": gather({ thing: "independent execution", usable: "why the prospect has not overcome the challenges alone", vague: "e.g. 'no time' without explanation", na: "N/A (no_opportunity_arose) if no challenge was established (C09-01).", avoid: "Do not infer incapacity; the reason must be the prospect's." }),
  // ---- C10 Knowledge Gap ----
  "C10-01": gather({ thing: "missing knowledge or resources", usable: "what knowledge, tools, mentorship, support or community the prospect lacks", vague: "'need guidance' without specifics", na: "Never N/A.", avoid: "Do not assume the prospect needs every resource; a gap the salesperson names and the prospect merely accepts is not established." }),
  "C10-02": {
    s3: "The salesperson links the prospect's stated gap to why the goal has not been reached, using the prospect's words, and the prospect agrees or elaborates.",
    s2: "A link is made but generic, or the prospect's reaction is unclear.",
    s1: "A link is asserted that is not grounded in what the prospect said.",
    s0: "A gap was established and the salesperson never connected it to the lack of progress (absence record).",
    na: "N/A (no_opportunity_arose) if no gap was established (C10-01).",
    ne: NE_STD,
    evidence: "The prospect's gap statement, the salesperson's linking statement and the prospect's response.",
    avoid: "Do not reward a causal story the prospect never accepted.",
  },
  // ---- C11 How Will FlexiFunnels Help? ----
  "C11-01": {
    s3: "The salesperson asks how the prospect thinks FlexiFunnels could help, and the prospect answers in their own words with something specific.",
    s2: "The question is asked and the prospect answers only generically ('it will help my business').",
    s1: "The question is asked but no usable answer results, or the salesperson answers it for the prospect.",
    s0: "The salesperson presents the product and never asks the prospect's view (absence record).",
    na: "N/A (no_opportunity_arose) only if the prospect clearly ended or declined this discussion.",
    ne: NE_STD,
    evidence: "The salesperson's question and the prospect's answer, both quoted.",
    avoid: "A feature list is not the prospect's view. A bare 'yes' to 'do you think it will help?' is not a specific answer.",
  },
  "C11-02": {
    s3: "The salesperson links the prospect's own stated view to two or more specifically established needs, quoting or paraphrasing the prospect accurately.",
    s2: "The prospect's view is linked to one established need, or the link is accurate but general.",
    s1: "Product features are mentioned with only a loose or generic connection to the prospect.",
    s0: "No connection to established needs, or the salesperson misstates what the prospect said (absence record).",
    na: "N/A (no_opportunity_arose) if no needs were established anywhere in the call.",
    ne: NE_STD,
    evidence: "The established need (prospect quote) and the salesperson statement connecting it to FlexiFunnels help.",
    avoid: "Mentioning a feature never earns full credit. Do not assume every prospect needs every feature or support resource.",
  },
  // ---- C12 Past Experiences ----
  "C12-01": gather({ thing: "previous attempts", usable: "what the prospect has already tried toward the goal (or that nothing has been tried)", vague: "'tried a few things'", na: "Never N/A: 'nothing tried' is itself a usable answer." }),
  "C12-02": gather({ thing: "previous solution experiences", usable: "which tools, platforms, courses or agencies the prospect used", vague: "'used some tools'", na: "N/A (no_opportunity_arose) if the prospect has used none (C12-01).", avoid: "Do not credit unsupported statements about competitors." }),
  "C12-03": gather({ thing: "lessons and dissatisfaction", usable: "what worked, what did not and why, from the prospect's experience", vague: "'it was okay'", na: "N/A (no_opportunity_arose) if the prospect has no previous solution experience (C12-02).", avoid: "Disparaging a competitor without basis earns nothing and may be flagged misleading_product_claim." }),
  // ---- C13 Pain Exaggeration ----
  "C13-01": {
    s3: "The salesperson asks what happens if nothing changes and the prospect states realistic consequences in their own words.",
    s2: "The question is asked and the prospect's answer is generic or short.",
    s1: "The salesperson states the consequences for the prospect (assumed) or poses only hypotheticals the prospect does not engage with.",
    s0: ZERO_STD + " Fearmongering, shame or fabricated consequences also score 0 and must be flagged.",
    na: "N/A (no_opportunity_arose) only if the prospect ended or declined the discussion.",
    ne: NE_STD,
    evidence: "The salesperson's question and the prospect's stated consequences.",
    avoid: "Never reward fear, shame, exaggerated or invented consequences, or consequences the salesperson asserts.",
  },
  "C13-02": {
    s3: "The salesperson accurately reflects the prospect's stated consequences and asks whether they want that future, and the prospect responds.",
    s2: "A reflection or question is present but the other is missing, or the response is unclear.",
    s1: "The salesperson moves on after the consequences without reflecting or asking.",
    s0: "No reflection or future-state question despite established consequences, or the reflection distorts what was said.",
    na: "N/A (no_opportunity_arose) if no consequences were established (C13-01).",
    ne: NE_STD,
    evidence: "The reflection and the future-state question with the prospect's reply.",
    avoid: "A leading 'you don't want that, right?' answered 'yes' is weak evidence of the prospect's own view.",
  },
  // ---- C14 Testimonials ----
  "C14-01": {
    s3: "A customer example is chosen that matches the prospect's established situation (business type, goal or challenge) and the match is stated.",
    s2: "The example is relevant in part (e.g. same goal, different business).",
    s1: "A generic or loosely related example is given.",
    s0: "An example is clearly mismatched or appears invented, or proof was requested and none was offered (absence record).",
    na: "N/A (no_relevant_testimonial_available) if no relevant testimonial is available and none was claimed, or N/A (sharing_inappropriate) if sharing was inappropriate (e.g. the prospect declined).",
    ne: NE_STD + " Whether a testimonial is genuine cannot be verified from audio: put it under human verification.",
    evidence: "The salesperson's statement of the example and the prospect statement it was matched to.",
    avoid: "Never reward invented testimonials or guaranteed similar outcomes (flag fabricated_social_proof / false_earnings_promise). 'I sent it on WhatsApp' is not proof of delivery.",
  },
  "C14-02": {
    s3: "The testimonial is shared accurately at a suitable moment, with factual results and no promise that the prospect will get the same.",
    s2: "Shared appropriately but with minor overstatement or poor timing.",
    s1: "Shared vaguely, with inflated or unverifiable figures, or at an unsuitable moment.",
    s0: "Fabricated, guaranteed-result or misleading testimonial use (flag), or a clearly available relevant example was withheld after the prospect asked for proof.",
    na: "N/A (no_relevant_testimonial_available / sharing_inappropriate) as in C14-01.",
    ne: NE_STD,
    evidence: "The exact words used to share the example.",
    avoid: "Unverifiable numbers are not 'false': mark them for human verification. Never reward 'you will also get this result'.",
  },
  "C14-03": {
    s3: "The salesperson explains why the example is relevant to this prospect and its context (starting point, time, effort), and checks the prospect's reaction.",
    s2: "Relevance or context is explained, but not both, or the reaction is not checked.",
    s1: "The example is stated without explaining how it relates to the prospect.",
    s0: "The example is dropped into the call with no relevance or context at all.",
    na: "N/A (no_relevant_testimonial_available / sharing_inappropriate) as in C14-01.",
    ne: NE_STD,
    evidence: "The salesperson's explanation linking the example to the prospect.",
    avoid: "Do not reward claims that the prospect will have the same outcome.",
  },
  // ---- C15 USP ----
  "C15-01": {
    s3: "At least one differentiator is explained and tied to a specific, established prospect need, consistent with https://sb.flexifunnels.com/advanced-features.",
    s2: "Relevant differentiators are explained but generically, without tying them to the prospect's stated needs.",
    s1: "A generic list of strengths with no relevance to the prospect.",
    s0: "No differentiation offered despite opportunity, or an invented or false claim is made.",
    na: "N/A (no_opportunity_arose) only if the prospect ended the call before product discussion.",
    ne: NE_STD + " Feature accuracy that cannot be checked from the transcript goes to human verification.",
    evidence: "The salesperson statement naming the differentiator and the prospect need it addresses.",
    avoid: "'ONLY solution' means relevant best-fit positioning, not a claim that no competitor exists. Do not reward invented features, availability, prices or launch dates.",
  },
  "C15-02": {
    s3: "Two or more features are each explained as a concrete benefit for a need the prospect stated.",
    s2: "One feature is explained as a benefit for a stated need.",
    s1: "Features are mentioned without a benefit for this prospect.",
    s0: "No feature-to-benefit explanation, or features are described inaccurately.",
    na: "N/A (no_opportunity_arose) only if no product discussion occurred.",
    ne: NE_STD,
    evidence: "The feature statement and the benefit linked to the prospect's need.",
    avoid: "Naming a feature is not explaining its benefit.",
  },
  "C15-03": {
    s3: "Monetisation opportunities relevant to the prospect's model (courses, memberships, funnels, payments) are explained without promised figures.",
    s2: "Opportunities are explained but generically.",
    s1: "A vague reference to 'earning more' with no mechanism.",
    s0: "None explained despite opportunity, or an earnings promise or guarantee is made (flag false_earnings_promise).",
    na: "N/A (not_applicable_to_prospect) if the prospect's goal is unrelated to monetisation.",
    ne: NE_STD,
    evidence: "The salesperson's description of the monetisation mechanism.",
    avoid: "Never reward guaranteed or implied income figures.",
  },
  "C15-04": {
    s3: "Training, support or community offered is matched to the prospect's need and limited to the approved offering.",
    s2: "Matched to the need but described broadly.",
    s1: "Support is mentioned with no link to the prospect's need.",
    s0: "No support fit discussed despite opportunity, or unapproved promises are made (custom development, personal mentoring or direct access to Saurabh Bhatnagar, unapproved response times, unapproved training; flag misrepresented_support).",
    na: "N/A (no_opportunity_arose) only if no support or training discussion occurred.",
    ne: NE_STD + " Whether a support claim is part of the approved offering goes to human verification.",
    evidence: "The salesperson's description of the support and the need it addresses.",
    avoid: "Do not assume every prospect needs every resource. Do not invent support commitments.",
  },
  "C15-05": {
    s3: "Best-fit positioning against the alternatives the prospect used or considered, accurate and tied to the prospect's situation.",
    s2: "Positioning is accurate but generic or not tied to alternatives the prospect named.",
    s1: "Vague superiority claims.",
    s0: "No positioning when the prospect asked about alternatives, or unsupported claims that competitors do not exist or cannot do something (flag misleading_product_claim).",
    na: "N/A (no_opportunity_arose) if alternatives were never raised by either side.",
    ne: NE_STD,
    evidence: "The salesperson's comparison statement and the alternative it refers to.",
    avoid: "Disparagement without basis is not positioning.",
  },
  // ---- C16 YES Mode ----
  "C16-01": yes("confirms understanding of the explanation so far ('does this make sense?')", "the prospect restates or confirms in their own words"),
  "C16-02": yes("asks whether the prospect agrees the challenge is a roadblock", "the prospect confirms or disagrees in their own words"),
  "C16-03": yes("asks whether the prospect sees how solving the challenge helps the goal", "the prospect explains or confirms the connection"),
  "C16-04": yes("asks whether the prospect wants to address the barrier", "the prospect states a willingness or reservation"),
  "C16-05": {
    s3: "The salesperson asks whether, once the challenges are addressed, the prospect is ready for an appropriate next step, and the prospect answers; any hesitation is acknowledged.",
    s2: "The readiness question is asked and answered, but hesitation or conditions are not acknowledged.",
    s1: "A leading or pressured close ('you are ready, right?') with only a bare yes.",
    s0: "No readiness check before moving to payment or close, or readiness is assumed (absence record).",
    na: "N/A (prospect_not_ready) if the prospect is clearly not interested and the salesperson appropriately does not ask.",
    ne: NE_STD,
    evidence: "The salesperson's readiness question and the prospect's answer.",
    avoid: "A prospect saying no is not a salesperson failure. Pressure after a refusal earns nothing (flag refusal_not_respected).",
  },
  // ---- C17 Closing Questions ----
  "C17-01": gather({ thing: "reason for non-enrolment", usable: "why the prospect did not enrol during the webinar", vague: "'will see later'", na: DECLINED }),
  "C17-02": gather({ thing: "preferred starting approach", usable: "how and when the prospect would like to start or proceed", vague: "'let me think'", na: "N/A (prospect_not_ready) if the prospect is clearly not ready and the salesperson appropriately does not push." }),
  "C17-03": {
    s3: "Payment options that actually exist are explained relevantly to the prospect's stated constraint and the prospect responds.",
    s2: "Options are explained but not tied to the prospect's constraint, or the response is unclear.",
    s1: "Payment is mentioned vaguely or pressed before the prospect's constraint was understood.",
    s0: "Payment is never discussed although the prospect asked and was ready, or non-existent options are described (flag misleading_product_claim).",
    na: "N/A (prospect_not_ready) if the prospect is not ready or declined and the salesperson appropriately does not request payment.",
    ne: NE_STD + " Which payment options exist goes to human verification.",
    evidence: "The salesperson's description of the payment options and the prospect's reaction.",
    avoid: "Not requesting payment from a prospect who is not ready is never a failure. Never reward pressure to borrow.",
  },
  "C17-04": {
    s3: "A specific next step (what, when, who) is stated and the prospect agrees to it.",
    s2: "A next step is stated but the prospect's agreement or the timing is unclear.",
    s1: "A vague next step ('I will call you').",
    s0: "The call ends with no next step despite opportunity (absence record).",
    na: "N/A (no_opportunity_arose) only if the call ended abruptly by the prospect before this stage.",
    ne: NE_STD,
    evidence: "The statement of the next step and the prospect's response.",
    avoid: "A step the salesperson announces alone is not 'agreed'. Pressure after a refusal earns nothing.",
  },
  // ---- C18 Objection Handling (approved Objection Doc not supplied: policy compliance needs human verification) ----
  "C18-01": objection("identifies the prospect's actual objection and checks it", "names or restates the objection accurately and checks it with the prospect", "acknowledges the objection only vaguely", "mishears or reframes the objection into a different one", "ignores or talks over a clearly stated objection"),
  "C18-02": objection("clarifies the concern behind the objection", "asks at least one neutral probing question and the prospect's answer reveals the concern", "asks, but the question is leading or generic", "assumes the underlying concern without asking", "makes no attempt to understand the concern"),
  "C18-03": objection("responds with relevant, accurate information", "gives accurate information relevant to the stated concern, with no invented facts", "gives relevant information that is incomplete or only partly accurate", "gives generic or irrelevant answers", "gives no response, or a materially inaccurate or invented one"),
  "C18-04": objection("confirms resolution or the remaining concern", "asks whether the concern is resolved, the prospect answers, and any remaining concern is addressed or acknowledged", "asks but does not act on the answer", "assumes the concern is resolved", "moves on without checking"),
  // ---- C19 Their Objections = Best Case Scenario ----
  "C19-01": reframe("identifies a concern where a genuine alternative perspective exists", "recognises the concern accurately and the reframe rests on a real resource or fact", "recognises it but the reframe is generic", "reframes with no real basis", "misses an evident reframing opportunity or reframes harmfully (e.g. turns financial inability into a reason to borrow; flag financial_pressure)"),
  "C19-02": reframe("provides a relevant example or explanation", "gives a real, relevant example or explanation without guaranteeing results", "gives a relevant but thin example", "gives an unsupported or generic story", "gives none, or a fabricated or guaranteed-result example (flag fabricated_social_proof / false_earnings_promise)"),
  "C19-03": reframe("connects the example to support actually available", "links the example to training or support in the approved offering", "links it loosely", "mentions support without linking it to the concern", "misrepresents training, support or product capability (flag misrepresented_support)"),
  "C19-04": reframe("preserves the prospect's freedom of choice", "lets the prospect decide, accepts a decline gracefully and leaves the door open", "respects the decision but with some repeated nudging", "applies mild repeated pressure", "keeps pressing after a refusal (flag refusal_not_respected)"),
};

function yes(what: string, answer: string): Anchor {
  return {
    s3: `The salesperson ${what} with a non-leading question and ${answer}.`,
    s2: `The question is asked non-leadingly and answered, but only briefly ('yes' with a little context), or the salesperson does not respond to a reservation.`,
    s1: `The question is leading or closed ('you agree, right?') and only a bare 'yes' follows: this is not independent agreement.`,
    s0: `The alignment check never occurs although a long explanation or pitch preceded it (absence record).`,
    na: "N/A (no_opportunity_arose) only if the call ended before this stage or the prospect clearly declined to continue.",
    ne: NE_STD,
    evidence: "The salesperson's question and the prospect's reply, both quoted.",
    avoid: "Do not treat a leading-question 'yes' as independent agreement. Do not penalise the salesperson because the prospect disagrees: score the salesperson's behaviour, not the prospect's answer.",
  };
}
function objection(what: string, s3: string, s2: string, s1: string, s0: string): Anchor {
  return {
    s3: `The salesperson ${s3}.`,
    s2: `The salesperson ${s2}.`,
    s1: `The salesperson ${s1}.`,
    s0: `The salesperson ${s0} (absence record).`,
    na: "N/A (no_material_objection) when the prospect raises no material objection. Do not invent one.",
    ne: NE_STD + " Whether a response matches approved objection guidance cannot be judged: the approved Objection Doc has not been supplied.",
    evidence: `The prospect's objection and the salesperson statement that ${what}.`,
    avoid: "The approved Objection Doc is unavailable: do not reward or invent 'approved' wording and do not claim policy compliance. Judge identification, clarification, relevance and accuracy, and add the human_review_flag objection_policy_unverified for every scored C18 criterion.",
  };
}
function reframe(what: string, s3: string, s2: string, s1: string, s0: string): Anchor {
  return {
    s3: `The salesperson ${s3}.`,
    s2: `The salesperson ${s2}.`,
    s1: `The salesperson ${s1}.`,
    s0: `The salesperson ${s0} (absence record).`,
    na: "N/A (no_material_objection or no_opportunity_arose) when no concern arose that a genuine reframe could address. Not reframing a concern with no supporting example is not a failure.",
    ne: NE_STD,
    evidence: `The prospect's concern and the salesperson statement that ${what}.`,
    avoid: "Reframe only with a genuine, relevant example or resource. Never reward turning financial inability into a reason to borrow, guaranteeing another customer's result, pressure after a refusal, emotional coercion or misrepresenting training, support or the product.",
  };
}

/** Criteria whose answer must come from the PROSPECT: a score of 2 or 3 needs at least one verified prospect-attributed evidence item (code-enforced). */
export const PROSPECT_ANSWER_REQUIRED: string[] = [
  "C03-01", "C03-02", "C03-03", "C03-04", "C03-05", "C03-06", "C03-07", "C03-08", "C03-09", "C04-01", "C04-02", "C05-01", "C05-02", "C05-03", "C05-04", "C05-05",
  "C06-01", "C06-02", "C07-01", "C07-02", "C08-01", "C09-01", "C09-02", "C09-03", "C10-01", "C12-01", "C12-02", "C12-03", "C17-01", "C17-02", "C11-01",
];

/** A confirmed, verified flag caps the score of criteria whose cited evidence overlaps the flagged segments at 1 (never rewarded). */
export const FLAG_CRITERIA: Record<string, string[]> = {
  fake_urgency: ["C07-01", "C07-02", "C13-01", "C13-02", "C17-02", "C17-04", "C19-01", "C19-04"],
  financial_pressure: ["C05-05", "C17-03", "C19-01", "C19-02", "C19-04"],
  coercive_emotional_pressure: ["C06-01", "C06-02", "C13-01", "C13-02", "C19-04"],
  fabricated_social_proof: ["C14-01", "C14-02", "C14-03", "C19-02"],
  false_earnings_promise: ["C14-02", "C15-03", "C19-02", "C19-03"],
  misrepresented_support: ["C15-04", "C19-03"],
  misleading_product_claim: ["C15-01", "C15-02", "C15-05", "C17-03", "C11-02"],
  refusal_not_respected: ["C17-04", "C16-05", "C19-04"],
};

export function anchorText(id: string): string {
  const a = ANCHORS[id];
  if (!a) return "";
  return `  3 = ${a.s3}\n  2 = ${a.s2}\n  1 = ${a.s1}\n  0 = ${a.s0}\n  N/A: ${a.na}\n  NE: ${a.ne}\n  Evidence: ${a.evidence}\n  Do not: ${a.avoid}`;
}

export function criteriaNeedingAnchors(): string[] {
  return CATEGORIES.filter((c) => c.id !== "C01" && c.id !== "C02").flatMap((c) => c.criteria.map((k) => k.id));
}
