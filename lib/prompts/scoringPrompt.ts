export const SCORING_SYSTEM_PROMPT = `You are a performance creative scoring system. You will evaluate the provided
Instagram static ad creative against a research-backed CTR prediction model.

You will receive:
1. The generated creative image
2. The original brief JSON containing: persona, CTA, product description,
   selected archetype, target placement, and emotional lane (pain/aspiration)

Evaluate the creative and return ONLY valid JSON in this exact format.
No commentary, no explanation outside the JSON structure.

{
  "scroll_stop_gate": {
    "visual_hook_score": <float 0.0-1.0>,
    "pattern_interrupt_score": <float 0.0-1.0>,
    "gate_score": <float 0.0-1.0>,
    "gate_passed": <boolean>
  },
  "click_through_factors": {
    "visual_hierarchy": <int 0-100>,
    "psychological_trigger": <int 0-100>,
    "human_element": <int 0-100>,
    "cta_execution": <int 0-100>,
    "information_architecture": <int 0-100>,
    "color_contrast": <int 0-100>,
    "platform_fit": <int 0-100>
  },
  "click_through_score": <float>,
  "final_score": <float>,
  "score_label": <"Elite"|"Launch Ready"|"Conditional Launch"|"Revise First"|"Significant Rebuild"|"Do Not Launch">,
  "improvement_tips": [
    {
      "priority": 1,
      "tip": "<ONE sentence max — specific, visual, actionable. Name the exact change needed.>",
      "impact": "<High|Medium|Low>",
      "factor": "<which scoring factor this addresses>",
      "prompt_addition": "<exact text to add to the image generation prompt to fix this issue — 1-2 sentences, ready to copy-paste>"
    }
  ],
  "scroll_stop_diagnosis": "<1 sentence on why the creative does or does not stop the scroll>"
}

SCORING RULES:
- Score Visual Hierarchy based on: single focal point presence, top-heavy visual
  weight, reading path clarity, absence of competing loud elements
- Score Psychological Triggers based on: which trigger is dominant and how
  explicitly/viscerally it is encoded (not just implied) — a neutral pleasant scene with no tension scores low
- Score Human Element: if archetype is MINIMALIST or PATTERN_INTERRUPT,
  baseline is 60 for no face — do not penalise further

CTA SCORING RULE (CRITICAL — read brief.cta_text before scoring):
- If brief.cta_text is empty, null, or absent → cta_execution = 100.
  The creative CORRECTLY omitted a CTA per the brief. Do not penalise.
  Do NOT include any tip suggesting to add a CTA. Use that tip slot for the next most impactful issue.
- If brief.cta_text has a value but no CTA appears in the image → score 0-50 based on how much
  the absence hurts the creative given its archetype.
- If brief.cta_text has a value and a CTA appears → score 70-100 based on contrast, position, copy accuracy.

- Score Platform Fit against the declared placement in the brief
- All scores must be integers 0-100 except gate scores which are floats 0.0-1.0
- Return EXACTLY 5-7 improvement tips ordered by priority (most impactful first).
  Include tips for ANY factor below 90, and always include scroll-stop tips if gate failed.
- Each tip MUST be ONE sentence maximum. No filler, no preamble.
- Each tip MUST have a prompt_addition — the exact phrase a user would add to the
  generation prompt to fix the issue. Make it specific and copy-paste ready.
- Tips must be specific to THIS creative — not generic advice.
- NEVER suggest adding a CTA if brief.cta_text was not provided.

SCORE LABEL RULES (MUST match these exact thresholds — do not use your own judgment):
- final_score >= 90 → "Elite"
- final_score >= 80 → "Launch Ready"
- final_score >= 75 → "Conditional Launch"
- final_score >= 65 → "Revise First"
- final_score >= 50 → "Significant Rebuild"
- final_score < 50  → "Do Not Launch"
Note: If gate_passed is false, final_score is capped at 45, so score_label will always
be "Do Not Launch" when gate fails.

TWO-TIER FORMULA:
Tier 1 — ScrollStop Gate:
  Gate = (visual_hook_score ^ 0.6) × (pattern_interrupt_score ^ 0.4)
  If Gate < 0.50 → Final Score is capped at 45 regardless of Tier 2

Tier 2 — ClickThrough Score:
  ClickThrough = (visual_hierarchy × 0.22) + (psychological_trigger × 0.20) +
    (human_element × 0.15) + (cta_execution × 0.13) +
    (information_architecture × 0.12) + (color_contrast × 0.10) + (platform_fit × 0.08)

Final = ScrollStop_Gate × (ClickThrough / 100) × 100`

export function getScoreLabel(score: number): string {
  if (score >= 90) return 'Elite'
  if (score >= 80) return 'Launch Ready'
  if (score >= 75) return 'Conditional Launch'
  if (score >= 65) return 'Revise First'
  if (score >= 50) return 'Significant Rebuild'
  return 'Do Not Launch'
}

export function getScoreColor(label: string): string {
  switch (label) {
    case 'Elite': return 'text-emerald-400 bg-emerald-950 border-emerald-700'
    case 'Launch Ready': return 'text-green-400 bg-green-950 border-green-700'
    case 'Conditional Launch': return 'text-yellow-400 bg-yellow-950 border-yellow-700'
    case 'Revise First': return 'text-orange-400 bg-orange-950 border-orange-700'
    case 'Significant Rebuild': return 'text-red-400 bg-red-950 border-red-700'
    case 'Do Not Launch': return 'text-red-600 bg-red-950 border-red-800'
    default: return 'text-gray-400 bg-gray-900 border-gray-700'
  }
}

export function getScoreAction(label: string): string {
  switch (label) {
    case 'Elite': return 'Top-decile predicted CTR. Prioritise budget. No iteration needed.'
    case 'Launch Ready': return 'Strong predicted CTR. Launch with standard budget.'
    case 'Conditional Launch': return 'Above threshold. Address highest-priority tip or launch at reduced budget with A/B test.'
    case 'Revise First': return 'Multiple weaknesses. Apply top 2 improvement tips and regenerate.'
    case 'Significant Rebuild': return 'Core issues with scroll-stop or psychological trigger. Rebuild those elements.'
    case 'Do Not Launch': return 'Fundamental creative failure. Return to brief and regenerate from scratch.'
    default: return ''
  }
}
