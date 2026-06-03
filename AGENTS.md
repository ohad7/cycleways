# AGENTS.md

Guidance for coding agents working in this repository.

## Planning Documents

All design specs and implementation plans live under `plans/`, not under
`docs/` or ad hoc locations. Use one directory per topic:

```text
plans/<topic>/
  design.md
  implementation-plan.md
```

- Use a short kebab-case `<topic>` directory name with no date prefix.
- Record the date inside each document.
- Put product/architecture decisions in `design.md`.
- Put ordered implementation tasks, validation steps, and test expectations in
  `implementation-plan.md`.
- Add a one-line entry for each new topic to `plans/README.md`.

