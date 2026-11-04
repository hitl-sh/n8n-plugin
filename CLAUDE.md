# CLAUDE.md

n8n community node `n8n-nodes-human-in-the-loop`, one node `hitlNode` with one credential.

- `nodes/HitlNode/HitlNode.node.ts` is a versioned node. `v1/` is the node as 0.1.6 shipped it; saved workflows depend on its field names, so do not change them. `v3/` is the default: `logic.ts` has what can be tested without n8n, `properties.ts` the fields, `HitlNodeV3.ts` the calls.
- Version 2 was never published.
- It talks to the public API only (`api.hitl.sh/v1/api/...`, see `WORKFLOWS_API.md` in api.hitl.sh). The host comes from the credential's Environment field through `baseUrlFor`, never from anything a user types.
- Waiting: Callback pauses the execution (`putExecutionToWait`, `$execution.resumeUrl` as `callback_url`; `getSignedResumeUrl` only works for n8n's own send-and-wait operations), and `webhook()` re-reads the answer from the API instead of trusting the body. Poll long-polls with bounded retries.

Use Node 24. `npm ci --ignore-scripts`, `npm run lint`, `npm run build`, `npm test`. n8n verification needs: the `n8n-node` lint passing, no runtime dependencies, no environment or file access, English, MIT, and publishing with provenance from `.github/workflows/publish.yml`.
