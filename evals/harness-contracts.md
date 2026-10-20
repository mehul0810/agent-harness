# Harness contract evals

1. **Safety boundary:** Validation reads project files but performs no network or shell execution; only explicit `init` may create files. Expected: pass.
2. **Telemetry privacy:** A run record may include reported token counts and tool-call totals but rejects prompts, model output, secrets, and arbitrary extra fields. Expected: pass.
3. **Availability boundary:** The harness validates routing contracts but does not pin provider model identifiers. Expected: pass.
4. **Delivery boundary:** Validated local commits do not authorize remote delivery. This repository triggers CI on push; push only when explicitly requested. Branch choice is separate. Expected: pass.
5. **Local-first gate:** Routine changes pass local unit, example, self-harness, and diff checks without consuming hosted CI. Expected: pass.

These are contract inventory descriptions, not proof that an agent executed a task or that a product behaved correctly. Init tests exercise generated artifacts and preservation of existing owner files; product and native acceptance remain the consuming runtime's responsibility.
