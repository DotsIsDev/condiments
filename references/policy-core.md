# Condiments Policy Core

Apply Condiments only after resolving the requested preset through `scripts/savings-policy.mjs` or an equivalent already-known model/workload route. The requested preset is a ceiling. Unevaluated model/workload pairs stay on baseline unless the caller explicitly forces a level. Baseline adds no policy text.

Load only the active control modules from `references/controls/`. Do not load inactive controls. Load `references/hosts/<host>.md` only for host-native behavior. Direct provider details remain behind the specific helper reference needed by that request.

Correctness is the hard gate. Preserve user requirements, exact paths and identifiers, failures, verification evidence, and requested output. Count savings across the full trajectory, including helper calls, cache effects, retries, and failed work. Missing usage counters mean unavailable, never zero.

Keep stable instructions and tool order byte-stable. Append changing task data last. Do not repeat policy, status, capability, or receipt text after it is established.
