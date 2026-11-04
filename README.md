# n8n-nodes-human-in-the-loop

Add human approval to n8n. This node runs [HITL](https://hitl.sh) workflows and asks people for decisions on
their phones, then continues your n8n workflow with their answer.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Waiting for the answer](#waiting-for-the-answer) · [Compatibility](#compatibility)

## Installation

Follow the [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/) and install
`n8n-nodes-human-in-the-loop`.

## Credentials

Create an API key under Settings at [my.hitl.sh](https://my.hitl.sh), and add it to a **HITL.sh Human Approval
API** credential. Leave Environment on Production. The key is only ever sent to `api.hitl.sh`, or
`dev.api.hitl.sh` if you choose Development.

## Operations

| Resource | Operation | What it does |
|---|---|---|
| Workflow | Run | Start a workflow and optionally wait for the people in it to decide |
| Workflow | Get Many, Get | Your workflows and their steps |
| Workflow | Get Input Fields | Which input fields a workflow's steps read |
| Run | Get, Get Many | One run, or a workflow's runs |
| Request | Create | Ask the people in a loop and optionally wait for the answer |
| Request | Get | One request and its answer |

The node also works as a tool for the AI Agent node, where it polls for the answer.

### Example: approve a refund

1. Build a workflow with a review step in HITL, read `{{trigger.body.amount}}` in it, and activate it.
2. In n8n, add this node after your trigger. Choose Workflow, Run, pick the workflow, and set Input to
   `{"amount": {{ $json.amount }}}`.
3. Branch on the output with an If node: `status` is `completed`, `failed` or `timed_out`, and `result` holds the
   last decision, such as `{"selected_value": "approve"}`. `decisions` lists who decided what.

## Waiting for the answer

| Wait for Answer | What happens |
|---|---|
| Automatic | A callback when HITL can reach your n8n, otherwise polling |
| Callback | The execution pauses and frees the worker until HITL calls back. Needs a public `https` n8n address (`WEBHOOK_URL`) and one item at a time |
| Poll | The execution stays running and checks for the answer. Works on any n8n |
| Don't Wait | Continues right away. Read the result later with Run: Get |

**Stop Waiting After** limits the wait. When polling, the node answers with the run so far and
`stopped_waiting: true`. A paused execution continues with its input data, so the next step should check for a
`status` field.

A callback only wakes the execution. The node then reads the answer from the HITL API with your key, so a request
to the resume address cannot supply a decision.

## Compatibility

Tested with n8n 2.x.

Workflows saved with version 0.1.6 of this package keep using version 1 of the node and work as before.

## Resources

- [HITL documentation](https://docs.hitl.sh)
- [n8n community nodes](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE.md)
