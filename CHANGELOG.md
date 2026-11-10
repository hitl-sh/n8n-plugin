# Changelog

## 0.4.1

- The credential no longer has an Environment option: the node always uses the production API (`api.hitl.sh`)
  and links to `my.hitl.sh`. Credentials saved with Development now use production too.

## 0.4.0

- Run a workflow: Request Details lists the fields the picked workflow reads, so you map your data into named
  boxes instead of writing JSON (Map Automatically sends the item as it is). Additional Input (JSON) still sends
  anything else.
- Answer Outputs: pick the workflow's answers (its select options, or the two labels of a yes or no step) and each
  gets its own output, plus Other for any other answer, no answer in time or a failed run. Empty keeps one output.
- The workflow list links each workflow to the HITL editor and ends with Create a workflow in HITL.
- New node version 3, the default for new nodes: pick a HITL workflow from a list and run it, wait for the
  people in it without holding an n8n worker, and read runs and workflows.
- Version 3 runs HITL workflows only. Loops and loop requests are being retired, so it has no Request resource
  or loop picker.
- Version 1, as shipped in 0.1.6, stays so saved workflows, including their loop requests, still load. Its
  polling no longer spins the CPU, and it now sends the key through n8n's credential handling.
- The credential has an Environment field in place of a hidden base URL. The key only goes to `api.hitl.sh` or
  `dev.api.hitl.sh`. Saved credentials keep working and use production.
- Version 2 (a webhook URL field), which was on `main` but never published, is gone: version 3 replaces it.
