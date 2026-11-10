<p align="center">
  <img src="https://docs.hitl.sh/images/readme/n8n/banner.png" alt="HITL for n8n: pause an n8n workflow until a person approves" width="900">
</p>

**Add human approval to n8n.** This node runs a [HITL](https://hitl.sh) workflow, a person decides on their
phone, in the web inbox or in Telegram, and your n8n workflow continues on their answer.

<p align="center">
  <img src="https://docs.hitl.sh/images/readme/n8n/how-it-works.png" alt="n8n runs a HITL workflow, a person decides in the HITL app, n8n follows the approve, reject or Other output" width="900">
</p>

[Install](#install) · [Connect](#connect-your-hitl-account) · [Use it](#use-it) · [Waiting](#waiting-for-the-answer) · [Operations](#operations) · [Compatibility](#compatibility)

## Install

Settings → Community nodes → Install, then enter `n8n-nodes-human-in-the-loop`
([n8n guide](https://docs.n8n.io/integrations/community-nodes/installation/)).

<img src="https://docs.hitl.sh/images/n8n/install.png" alt="n8n Install community nodes dialog with n8n-nodes-human-in-the-loop" width="800">

## Connect your HITL account

Create an API key under Settings at [my.hitl.sh](https://my.hitl.sh) and paste it into a **HITL.sh Human Approval API**
credential. The key is only ever sent to `api.hitl.sh`.

<img src="https://docs.hitl.sh/images/n8n/credential.png" alt="HITL credential in n8n: Connection tested successfully" width="800">

## Use it

Pick a HITL workflow and fill in the fields it reads. They are loaded from the workflow itself.

<img src="https://docs.hitl.sh/images/n8n/node-form.png" alt="The HITL node: pick the workflow, fill its input fields, optional extra JSON" width="800">

Pick answers under **Answer Output Names or IDs** to get one output per answer (such as `approve` and `reject`).
Other answers, no answer in time and failed runs go to **Other**.
Or keep one output and branch on `status` (`completed`, `failed`, `timed_out`) and `result` with an If node.
`decisions` lists who decided what.

## Waiting for the answer

| Wait for Answer | What happens |
|---|---|
| Automatic | A callback when HITL can reach your n8n, otherwise polling |
| Callback | The execution pauses and frees the worker until HITL calls back. Needs a public `https` n8n address (`WEBHOOK_URL`) |
| Poll | The execution keeps running and checks for the answer. Works on any n8n |
| Don't Wait | Continues right away. Read the result later with Run → Get |

**Stop Waiting After (Hours)** limits the wait. A callback only wakes the execution: the node then reads the answer from
the HITL API with your key, so a request to the resume address cannot supply a decision.

## Operations

| Resource | Operation | What it does |
|---|---|---|
| Workflow | Run | Start a workflow and optionally wait for the people in it to decide |
| Workflow | Get, Get Many | Your workflows and their steps |
| Workflow | Get Input Fields | Which input fields a workflow's steps read |
| Run | Get, Get Many | One run, or a workflow's runs |

The node also works as a tool for the AI Agent node.

## Compatibility

Tested with n8n 2.x. Workflows saved with version 0.1.6 keep using version 1 of the node and work as before. New
nodes run HITL workflows only.

## Resources

- [HITL docs](https://docs.hitl.sh) · [n8n community nodes](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE.md)
