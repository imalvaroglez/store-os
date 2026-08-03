---
name: store-os-review
description: Review Store OS changes for design-system adherence, Spanish-only UI, mobile-first, and no UI bypass. Dispatch as a subagent before merging or finishing a feature.
---

# Store OS Review

A project-specific reviewer for the Store OS codebase. Dispatch it as a subagent
(general-purpose, ultra effort) to check finished work against the project's hard
rules before it ships. The reviewer gets a self-contained prompt — never the
session history — so it evaluates the work product, not the thought process.

## When to Use

- After finishing a feature or screen.
- Before committing or merging.
- When touching anything under `src/features`, `src/app`, or `src/design-system`.

## The Hard Rules (what the reviewer enforces)

1. **No UI bypass.** Feature (`src/features/**`) and app (`src/app/**`) files must
   import UI only from `src/design-system`. They must NOT render raw
   `<button>`, `<select>`, or `<input>`, and must NOT duplicate the image,
   status-pill, or select patterns that the DS already provides
   (`ProductImage`, `Badge`, `SelectField`). The gate test
   `src/design-system/design-system-gate.test.ts` automates the raw-element +
   import-source checks; the reviewer also looks for *semantic* duplication the
   gate can't catch (e.g. hand-rolled card markup that should use `Card`).
2. **Spanish-only UI.** Every user-visible string is Spanish (Mexico). Code,
   types, identifiers, comments stay English. No enterprise jargon (CRM, SKU,
   pipeline, fulfillment, gross margin) in UI copy.
3. **Mobile-first.** Layouts assume a narrow phone. Tap targets ≥ ~40px. Inputs
   render at ≥16px (no iOS zoom-on-focus). Safe-area insets respected where the
   shell already handles them.
4. **Local-first correctness.** No component touches `localStorage` except
   `src/lib/storage.ts` (via `StoreProvider`). Store data is isolated by
   `storeId` — selectors in `src/lib/selectors.ts` are the only path.
5. **Behavior-preserving polish.** Visual changes come through the DS tokens /
   primitives only; they must not change product behavior or data shapes.
6. **Green gates.** `npm run typecheck`, `npm test` (incl. the design-system
   gate), `npm run build` must pass.

## How to Dispatch

```
Task tool (general-purpose, model opus, ultra effort):
  description: "Review Store OS change"
  prompt: |
    You are the Store OS reviewer. Review the change described below against the
    project's hard rules. Be specific and adversarial; cite file:line for every
    finding. Classify each as Critical / Important / Nit.

    ## Hard rules
    1. No UI bypass in src/features/** or src/app/**: no raw <button>/<select>/<input>,
       all UI imported from src/design-system, no duplicated image/pill/select patterns.
    2. Spanish-only UI strings; English code/types/comments. No enterprise jargon.
    3. Mobile-first: narrow-phone layouts, ≥40px tap targets, ≥16px inputs.
    4. Local-first: only src/lib/storage.ts (via StoreProvider) touches localStorage;
       store isolation via src/lib/selectors.ts only.
    5. Polish is behavior-preserving and flows through DS tokens/primitives.
    6. `npm run typecheck`, `npm test`, `npm run build` pass.

    ## What changed
    {DESCRIPTION}

    ## Git range
    Base: {BASE_SHA}  Head: {HEAD_SHA}
    Run: git diff --stat {BASE_SHA}..{HEAD_SHA} ; git diff {BASE_SHA}..{HEAD_SHA}

    ## Output
    - Plan/rules alignment: does it match the intent?
    - Findings: Critical / Important / Nit, each with file:line + suggested fix.
    - Verification: run typecheck/test/build; report exact results.
    - Verdict: APPROVE / REQUEST CHANGES, with the blocking issues listed.
```

## After the Review

- **Critical / Important** → fix before continuing. Apply the fix, re-run the
  gates, optionally re-review.
- **Nit** → apply if cheap, else note and move on.
- If the reviewer is wrong, push back with code/tests that prove it — don't
  cave to invalid feedback, but verify before disagreeing.
