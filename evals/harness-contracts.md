# Harness contract evals

1. **Safety boundary:** Validation reads project files but performs no network or shell execution; only explicit `init` may create files. Expected: pass.
2. **Telemetry privacy:** A run record may include reported token counts and tool-call totals but rejects prompts, model output, secrets, and arbitrary extra fields. Expected: pass.
3. **Availability boundary:** The harness validates routing contracts but does not pin provider model identifiers. Expected: pass.
4. **Publication route:** A scoped validated change publishes directly to `main`; a branch or PR requires an explicit review exception. Expected: pass.
5. **Local-first gate:** Routine changes pass local unit, example, self-harness, and diff checks without consuming hosted CI. Expected: pass.
