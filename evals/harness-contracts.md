# Harness contract evals

1. **Safety boundary:** Validation reads project files but performs no network or shell execution; only explicit `init` may create files. Expected: pass.
2. **Telemetry privacy:** A run record may include reported token counts and tool-call totals but rejects prompts, model output, secrets, and arbitrary extra fields. Expected: pass.
3. **Availability boundary:** The harness validates routing contracts but does not pin provider model identifiers. Expected: pass.
4. **Delivery boundary:** Scoped, validated changes in owner-managed `agent-*` repositories may be pushed directly to `main` under standing owner authorization, after inspecting actual branch protection and downstream effects. Preserve required checks; this does not authorize package/release publication, deployment, protection bypass or unrelated client pushes. Expected: pass.
5. **Local-first gate:** Routine changes pass local unit, example, self-harness, and diff checks without consuming hosted CI. Expected: pass.

These are contract inventory descriptions, not proof that an agent executed a task or that a product behaved correctly. Init tests exercise generated artifacts and preservation of existing owner files; product and native acceptance remain the consuming runtime's responsibility.
