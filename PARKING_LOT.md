# realcode — Parking Lot

Out-of-scope ideas logged during build work. Each entry is a one-liner with the story that logged it and the reason it's parked.

---

## Subpath mounting for the opencode-config mount (post-MVP hardening)

**Logged by:** Story A4.3 (issue #4)
**Reason:** Mounting only `opencode.json` + `agent/` + `skills/` (excluding `node_modules/`, `plugins/`, and anything else in the config dir) would reduce the trust-boundary surface of the opencode-config mount. The MVP mounts the whole config dir read-only + runs a startup `scanForSecrets` guard (plan §4.6.1). Subpath mounting requires enumerating every needed file (fragile to config changes) and opencode's plugin resolution needs the full config dir structure. Revisit when the operator's config grows to include files that should NOT be reachable from sandboxed agents.
