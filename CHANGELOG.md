# Changelog

## 0.4.0

- New node version 3, the default for new nodes: pick a HITL workflow from a list and run it, wait for the
  people in it without holding an n8n worker, read runs and workflows, and create or read requests in a loop.
- Version 1, as shipped in 0.1.6, stays for saved workflows. Its polling no longer spins the CPU, and it now
  sends the key through n8n's credential handling.
- The credential has an Environment field in place of a hidden base URL. The key only goes to `api.hitl.sh` or
  `dev.api.hitl.sh`. Saved credentials keep working and use production.
- Version 2 (a webhook URL field), which was on `main` but never published, is gone: version 3 replaces it.
