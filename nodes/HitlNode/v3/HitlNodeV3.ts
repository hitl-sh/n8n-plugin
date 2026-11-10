import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestOptions,
	type IHttpRequestMethods,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodeListSearchResult,
	type INodeOutputConfiguration,
	type INodeParameters,
	type INodePropertyOptions,
	type INodeType,
	type ResourceMapperFields,
	type INodeTypeBaseDescription,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type JsonObject,
} from 'n8n-workflow';
import {
	baseUrlFor,
	callbackId,
	chooseWait,
	parseObject,
	pollUntil,
	requestError,
	runFinished,
	unwrap,
	type WaitMode,
	apiReason,
	decodeAnswer,
	encodeAnswer,
	fieldLabel,
	nestInput,
	outputFor,
	portalUrlFor,
	workflowAnswers,
	type Answer,
} from './logic';
import { properties } from './properties';

type ApiContext = IExecuteFunctions | ILoadOptionsFunctions | IWebhookFunctions;

const CREDENTIAL = 'hitlCredentialsApi';
const OBJECT_ID = /^[0-9a-f]{24}$/;
/** One long-poll: the API answers as soon as the run ends, and after this many seconds otherwise. */
const LONG_POLL_SECONDS = 30;
/** Runs without a human finish quickly, before this execution could be paused to receive the callback. */
const QUICK_CHECK_SECONDS = 5;

async function api(
	this: ApiContext,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: IDataObject; qs?: IDataObject; timeout?: number } = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials(CREDENTIAL);
	const request: IHttpRequestOptions = {
		method,
		url: `${baseUrlFor(credentials.environment)}${path}`,
		json: true,
		...(options.body ? { body: options.body } : {}),
		...(options.qs ? { qs: options.qs } : {}),
		...(options.timeout ? { timeout: options.timeout } : {}),
	};
	return unwrap(await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL, request));
}

const readRun = (context: ApiContext, id: string, waitSeconds: number) =>
	api.call(context, 'GET', `/api/executions/${id}`, {
		qs: { wait: waitSeconds },
		timeout: (waitSeconds + 15) * 1000,
	});

function checkId(context: IExecuteFunctions, id: string, what: string, item: number): string {
	const value = id.trim();
	if (!OBJECT_ID.test(value)) {
		throw new NodeOperationError(context.getNode(), `${what} is not a valid ID: "${id}"`, {
			itemIndex: item,
		});
	}
	return value;
}

/** The error a node throws for an API or other failure. */
function nodeError(context: IExecuteFunctions, error: unknown, item: number) {
	if (error instanceof NodeOperationError) return error;
	if (error instanceof NodeApiError) {
		// n8n's request helper replaces the API's reason with a generic line for the status.
		const reason = apiReason(error);
		if (reason) error.message = reason;
		return error;
	}
	const { message, status } = requestError(error);
	if (status === undefined) {
		return new NodeOperationError(context.getNode(), message, { itemIndex: item });
	}
	return new NodeApiError(context.getNode(), error as JsonObject, {
		message,
		httpCode: String(status),
		itemIndex: item,
	});
}

const failer = (context: IExecuteFunctions, item: number) => (error: unknown): never => {
	throw nodeError(context, error, item);
};

const operationFailer = (context: IExecuteFunctions, item: number) => (message: string): never => {
	throw new NodeOperationError(context.getNode(), message, { itemIndex: item });
};

const locator = (context: IExecuteFunctions, name: string, item: number) =>
	context.getNodeParameter(name, item, '', { extractValue: true }) as string;

/**
 * This execution's resume address, with its token. n8n only accepts getSignedResumeUrl() from its own
 * send-and-wait operations, so a node like this one uses the same address the Wait node documents.
 */
function resumeUrl(context: IExecuteFunctions, item: number): string | undefined {
	const url = context.evaluateExpression('{{ $execution?.resumeUrl }}', item);
	return typeof url === 'string' && url !== '' ? url : undefined;
}

const hoursToMs = (hours: number) => Math.max(hours, 0.01) * 3_600_000;

/** The API checks the callback address before starting anything, so asking again without one is safe. */
const refusedCallback = (error: unknown) => {
	const { status, message } = requestError(error);
	return status === 400 && /callback_url/i.test(message);
};

interface Waited {
	/** The answer for this item. */
	value?: IDataObject;
	/** The execution has been paused: return the input items as they are. */
	paused?: boolean;
}

async function startAndWait(
	context: IExecuteFunctions,
	item: number,
	start: (callbackUrl?: string) => Promise<IDataObject>,
	follow: (started: IDataObject, maxMs: number) => Promise<IDataObject>,
	quick: ((started: IDataObject) => Promise<IDataObject | undefined>) | undefined,
): Promise<Waited> {
	const mode = context.getNodeParameter('waitMode', item, 'auto') as WaitMode;
	const url = mode === 'auto' || mode === 'callback' ? resumeUrl(context, item) : undefined;
	const { wait, problem } = chooseWait(mode, {
		resumeUrl: url,
		itemCount: context.getInputData().length,
		isTool: context.isToolExecution?.() ?? false,
	});
	if (problem) throw new NodeOperationError(context.getNode(), problem, { itemIndex: item });
	if (wait === 'none') return { value: await start() };

	const maxMs = hoursToMs(context.getNodeParameter('maxWaitHours', item, 24) as number);
	let started: IDataObject;
	let waitBy = wait;
	if (wait === 'callback') {
		try {
			started = await start(url);
		} catch (error) {
			if (mode !== 'auto' || !refusedCallback(error)) throw nodeError(context, error, item);
			started = await start();
			waitBy = 'poll';
		}
	} else {
		started = await start();
	}
	if (waitBy === 'poll') return { value: await follow(started, maxMs) };

	const already = quick ? await quick(started) : undefined;
	if (already) return { value: already };
	await context.putExecutionToWait(new Date(Date.now() + maxMs));
	return { paused: true };
}

/** The run's input: Additional Input, with the Request Details on top. Empty details are left out. */
function workflowInput(context: IExecuteFunctions, item: number): IDataObject {
	const extra = parseObject(
		context.getNodeParameter('input', item, '{}'),
		'Additional Input',
		operationFailer(context, item),
	);
	const mode = context.getNodeParameter('fields.mappingMode', item, 'defineBelow') as string;
	const mapped =
		mode === 'autoMapInputData'
			? context.getInputData()[item].json
			: ((context.getNodeParameter('fields.value', item, {}) ?? {}) as IDataObject);
	const filled: IDataObject = {};
	for (const [key, value] of Object.entries(mapped)) {
		if (value !== null && value !== undefined && value !== '') filled[key] = value;
	}
	return { ...extra, ...nestInput(filled) };
}

/** The answers that have their own output, in output order. Empty means one output. */
function pickedAnswers(context: IExecuteFunctions | IWebhookFunctions): Answer[] {
	const parameters = context.getNode().parameters;
	if (configuredOutputs(parameters).length === 1) return [];
	// An AI agent's tool has one output: it gets the answer as is.
	if ('isToolExecution' in context && context.isToolExecution?.()) return [];
	return ((parameters.answerOutputs ?? []) as string[])
		.map(decodeAnswer)
		.filter((answer): answer is Answer => answer !== undefined);
}

/**
 * The node's outputs. n8n evaluates this from the parameters, as text, so it uses nothing from outside
 * itself. Parameters left at their default can be missing.
 */
export const configuredOutputs = (parameters: INodeParameters): INodeOutputConfiguration[] => {
	const resource = parameters.resource === undefined ? 'workflow' : parameters.resource;
	const operation = parameters.operation === undefined ? 'run' : parameters.operation;
	const waitMode = parameters.waitMode === undefined ? 'auto' : parameters.waitMode;
	const picked = parameters.answerOutputs;
	if (
		resource !== 'workflow' ||
		operation !== 'run' ||
		waitMode === 'none' ||
		!Array.isArray(picked) ||
		picked.length === 0
	) {
		return [{ type: 'main' }];
	}
	const outputs: INodeOutputConfiguration[] = picked.map((raw) => {
		let label = String(raw);
		try {
			const parsed = JSON.parse(String(raw));
			if (parsed && parsed.l) label = String(parsed.l);
		} catch {
			// a value typed by hand
		}
		return { type: 'main', displayName: label };
	});
	outputs.push({ type: 'main', displayName: 'Other' });
	return outputs;
};

/** Puts each answer on its output. */
function route(rows: INodeExecutionData[], answers: Answer[]): INodeExecutionData[][] {
	const outputs: INodeExecutionData[][] = Array.from({ length: answers.length + 1 }, () => []);
	if (answers.length === 0) return [rows];
	for (const row of rows) outputs[outputFor(row.json, answers)].push(row);
	return outputs;
}

function runWorkflow(context: IExecuteFunctions, item: number): Promise<Waited> {
	const id = checkId(context, locator(context, 'workflowId', item), 'Workflow', item);
	const input = workflowInput(context, item);
	return startAndWait(
		context,
		item,
		async (callbackUrl) =>
			await api.call(context, 'POST', `/api/workflows/${id}/run`, {
				body: { input, ...(callbackUrl ? { callback_url: callbackUrl } : {}) },
			}),
		async (started, maxMs) => {
			const { value, finished } = await pollUntil(
				() => readRun(context, String(started.id), LONG_POLL_SECONDS),
				runFinished,
				{ maxMs, sleep, fail: failer(context, item) },
			);
			return finished ? value : { ...value, stopped_waiting: true };
		},
		async (started) => {
			const run = await readRun(context, String(started.id), QUICK_CHECK_SECONDS);
			return runFinished(run) ? run : undefined;
		},
	);
}

async function runOperation(
	context: IExecuteFunctions,
	resource: string,
	operation: string,
	item: number,
): Promise<IDataObject | IDataObject[] | Waited> {
	const workflowId = () => checkId(context, locator(context, 'workflowId', item), 'Workflow', item);
	switch (`${resource}.${operation}`) {
		case 'workflow.getAll': {
			const status = context.getNodeParameter('status', item, '') as string;
			const data = await api.call(context, 'GET', '/api/workflows', {
				qs: status ? { status } : {},
			});
			return (data.workflows ?? []) as IDataObject[];
		}
		case 'workflow.get':
			return await api.call(context, 'GET', `/api/workflows/${workflowId()}`);
		case 'workflow.getInput':
			return await api.call(context, 'GET', `/api/workflows/${workflowId()}/input`);
		case 'workflow.run':
			return await runWorkflow(context, item);
		case 'run.get':
			return await api.call(
				context,
				'GET',
				`/api/executions/${checkId(context, context.getNodeParameter('runId', item) as string, 'Run', item)}`,
			);
		case 'run.getAll': {
			const status = context.getNodeParameter('status', item, '') as string;
			const limit = context.getNodeParameter('limit', item, 50) as number;
			const data = await api.call(context, 'GET', `/api/workflows/${workflowId()}/executions`, {
				qs: { limit, ...(status ? { status } : {}) },
			});
			return (data.executions ?? []) as IDataObject[];
		}
		default:
			throw new NodeOperationError(context.getNode(), `Unknown operation ${resource}.${operation}`, {
				itemIndex: item,
			});
	}
}

/** The workflow picked in the node, while the editor loads its fields and answers. */
function selectedWorkflow(context: ILoadOptionsFunctions): string | undefined {
	const raw = context.getNodeParameter('workflowId', '', { extractValue: true });
	const id = typeof raw === 'string' ? raw.trim() : '';
	return OBJECT_ID.test(id) ? id : undefined;
}

const isWaited = (value: unknown): value is Waited =>
	typeof value === 'object' && value !== null && ('paused' in value || 'value' in value);

export class HitlNodeV3 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			version: 3,
			icon: { light: 'file:hitl.svg', dark: 'file:hitl.dark.svg' },
			subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
			defaults: { name: 'HITL' },
			usableAsTool: true,
			inputs: [NodeConnectionTypes.Main],
			outputs: `={{(${configuredOutputs})($parameter)}}`,
			credentials: [{ name: CREDENTIAL, required: true }],
			webhooks: [
				{
					name: 'default',
					httpMethod: 'POST',
					responseMode: 'onReceived',
					responseData: '',
					path: '',
					restartWebhook: true,
					isFullPath: true,
				},
			],
			properties,
		};
	}

	methods = {
		listSearch: {
			async searchWorkflows(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const credentials = await this.getCredentials(CREDENTIAL);
				const portal = portalUrlFor(credentials.environment);
				const data = await api.call(this, 'GET', '/api/workflows', { qs: { status: 'active' } });
				const wanted = (filter ?? '').toLowerCase();
				return {
					results: ((data.workflows ?? []) as IDataObject[])
						.filter((w) => String(w.name).toLowerCase().includes(wanted))
						.map((w) => ({
							name: String(w.name),
							value: String(w.id),
							description: typeof w.description === 'string' && w.description ? w.description : undefined,
							url: `${portal}/workflows/${String(w.id)}`,
						})),
				};
			},
		},
		loadOptions: {
			async getAnswers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const id = selectedWorkflow(this);
				if (!id) return [];
				const workflow = await api.call(this, 'GET', `/api/workflows/${id}`);
				return workflowAnswers(workflow.nodes).map((answer) => ({
					name: answer.label,
					value: encodeAnswer(answer),
					description: answer.label === answer.value ? undefined : `Answer value: ${answer.value}`,
				}));
			},
		},
		resourceMapping: {
			async getInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const id = selectedWorkflow(this);
				if (!id) return { fields: [], emptyFieldsNotice: 'Pick a workflow first' };
				const data = await api.call(this, 'GET', `/api/workflows/${id}/input`);
				const fields = (Array.isArray(data.fields) ? data.fields : []) as IDataObject[];
				return {
					fields: fields
						.map((field) => String(field.path ?? ''))
						.filter(Boolean)
						.map((path) => ({
							id: path,
							displayName: fieldLabel(path),
							required: false,
							defaultMatch: false,
							canBeUsedToMatch: false,
							display: true,
						})),
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const answers = pickedAnswers(this);
		for (let item = 0; item < items.length; item++) {
			try {
				const result = await runOperation(this, resource, operation, item);
				if (isWaited(result)) {
					if (result.paused) return route(items, []).concat(answers.map(() => []));
					out.push({ json: result.value ?? {}, pairedItem: { item } });
				} else {
					const rows = Array.isArray(result) ? result : [result];
					for (const row of rows) out.push({ json: row, pairedItem: { item } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({
						json: { error: requestError(error).message },
						pairedItem: { item },
					});
					continue;
				}
				throw nodeError(this, error, item);
			}
		}
		return route(out, answers);
	}

	/**
	 * Wakes a paused execution when HITL calls back. The body is only a hint of which run ended: the
	 * answer is read from the API with the node's own key, so a stray POST cannot fake a decision.
	 */
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const id = callbackId(this.getBodyData());
		if (!id) return { webhookResponse: { received: false } };
		const answer = await readRun(this, id, 0);
		if (!runFinished(answer)) return { webhookResponse: { received: true, finished: false } };
		return { workflowData: route(this.helpers.returnJsonArray(answer), pickedAnswers(this)) };
	}
}
