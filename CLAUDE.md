# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Planning documents

All design specs and implementation plans live under `plans/`, **not** in
`docs/` or anywhere else. Use one directory per topic:

```
plans/<topic>/
  design.md               # the design spec (from brainstorming)
  implementation-plan.md  # the step-by-step implementation plan
```

- When the brainstorming skill says to write a design to
  `docs/superpowers/specs/...`, write it to `plans/<topic>/design.md` instead.
- When the writing-plans skill produces an implementation plan, write it to
  `plans/<topic>/implementation-plan.md`.
- Use a short kebab-case `<topic>` directory name (no date prefix); record the
  date inside the document.
- Add a one-line entry for each new topic to `plans/README.md`.
