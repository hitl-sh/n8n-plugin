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
	type INodeType,
	type INodeTypeBaseDescription,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type JsonObject,
	type ResourceMapperFields,
	type ResourceMapperValue,
} from 'n8n-workflow';
import {
	baseUrlFor,
	callbackId,
	chooseWait,
	fieldLabel,
	inputPaths,
	nestInput,
	parseObject,
	pollUntil,
	requestError,
	requestFinished,
	runFinished,
	unwrap,
	type WaitMode,
	apiReason,
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

const readRequest = async (context: ApiContext, id: string) => {
	const data = await api.call(context, 'GET', `/api/requests/${id}`);
	return (data.request ?? data) as IDataObject;
};

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

function runInput(context: IExecuteFunctions, item: number): IDataObject {
	if (context.getNodeParameter('inputMode', item, 'fields') === 'json') {
		return parseObject(context.getNodeParameter('input', item, '{}'), 'Input', operationFailer(context, item));
	}
	const form = context.getNodeParameter('inputFields', item, null) as ResourceMapperValue | null;
	return nestInput(form?.value);
}

function runWorkflow(context: IExecuteFunctions, item: number): Promise<Waited> {
	const id = checkId(context, locator(context, 'workflowId', item), 'Workflow', item);
	const input = runInput(context, item);
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

function requestBody(context: IExecuteFunctions, item: number): IDataObject {
	const responseType = context.getNodeParameter('responseType', item) as string;
	const fallback = (context.getNodeParameter('defaultResponse', item) as string).trim();
	const choices =
		responseType === 'single_select' || responseType === 'multi_select'
			? (context.getNodeParameter('responseOptions', item) as string)
					.split(',')
					.map((choice) => choice.trim())
					.filter(Boolean)
			: [];
	const responseConfig: IDataObject = {
		single_select: { options: choices },
		multi_select: { options: choices, max_selections: choices.length },
		rating: { scale_min: 1, scale_max: 5, scale_step: 1 },
		number: { min_value: 0, max_value: 1000000, decimal_places: 2, allow_negative: true },
		text: { min_length: 0, max_length: 5000 },
		editable_text: { min_length: 0, max_length: 5000 },
	}[responseType] ?? {};
	const defaultResponse: unknown =
		responseType === 'boolean'
			? /^(true|yes|1)$/i.test(fallback)
			: responseType === 'number' || responseType === 'rating'
				? Number(fallback)
				: responseType === 'multi_select'
					? fallback.split(',').map((choice) => choice.trim()).filter(Boolean)
					: fallback;
	return {
		processing_type: 'time-sensitive',
		type: 'markdown',
		priority: context.getNodeParameter('priority', item),
		request_text: context.getNodeParameter('requestText', item),
		response_type: responseType,
		response_config: responseConfig,
		default_response: defaultResponse as IDataObject,
		timeout_seconds: context.getNodeParameter('timeoutSeconds', item),
		platform: 'n8n',
		...parseObject(
			context.getNodeParameter('additional', item, '{}'),
			'Additional Fields',
			operationFailer(context, item),
		),
	};
}

function createRequest(context: IExecuteFunctions, item: number): Promise<Waited> {
	const loopId = checkId(context, locator(context, 'loopId', item), 'Loop', item);
	const body = requestBody(context, item);
	return startAndWait(
		context,
		item,
		async (callbackUrl) =>
			await api.call(context, 'POST', `/api/loops/${loopId}/requests`, {
				body: { ...body, ...(callbackUrl ? { callback_url: callbackUrl } : {}) },
			}),
		async (started, maxMs) => {
			const { value, finished } = await pollUntil(
				() => readRequest(context, String(started.request_id)),
				requestFinished,
				{ maxMs, sleep: (ms) => sleep(Math.max(ms, 5000)), fail: failer(context, item) },
			);
			return finished ? value : { ...value, stopped_waiting: true };
		},
		undefined,
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
		case 'request.create':
			return await createRequest(context, item);
		case 'request.get':
			return await readRequest(
				context,
				checkId(context, context.getNodeParameter('requestId', item) as string, 'Request', item),
			);
		default:
			throw new NodeOperationError(context.getNode(), `Unknown operation ${resource}.${operation}`, {
				itemIndex: item,
			});
	}
}

const isWaited = (value: unknown): value is Waited =>
	typeof value === 'object' && value !== null && ('paused' in value || 'value' in value);

export class HitlNodeV3 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			version: 3,
			icon: 'file:hitl.svg',
			subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
			defaults: { name: 'HITL' },
			usableAsTool: true,
			inputs: [NodeConnectionTypes.Main],
			outputs: [NodeConnectionTypes.Main],
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
		resourceMapping: {
			async getInputFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const id = String(this.getNodeParameter('workflowId', undefined, { extractValue: true }) ?? '').trim();
				if (!OBJECT_ID.test(id)) return { fields: [], emptyFieldsNotice: 'Pick a workflow first.' };
				const data = await api.call(this, 'GET', `/api/workflows/${id}/input`);
				return {
					fields: inputPaths(data).map((path) => ({
						id: path,
						displayName: fieldLabel(path),
						required: false,
						defaultMatch: false,
						canBeUsedToMatch: false,
						display: true,
						type: 'string',
					})),
				};
			},
		},
		listSearch: {
			async searchWorkflows(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const data = await api.call(this, 'GET', '/api/workflows', { qs: { status: 'active' } });
				const wanted = (filter ?? '').toLowerCase();
				return {
					results: ((data.workflows ?? []) as IDataObject[])
						.filter((w) => String(w.name).toLowerCase().includes(wanted))
						.map((w) => ({ name: String(w.name), value: String(w.id) })),
				};
			},
			async searchLoops(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const data = await api.call(this, 'GET', '/api/loops');
				const wanted = (filter ?? '').toLowerCase();
				return {
					results: ((data.loops ?? []) as IDataObject[])
						.filter((l) => String(l.name).toLowerCase().includes(wanted))
						.map((l) => ({ name: String(l.name), value: String(l.id) })),
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		for (let item = 0; item < items.length; item++) {
			try {
				const result = await runOperation(this, resource, operation, item);
				if (isWaited(result)) {
					if (result.paused) return [items];
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
		return [out];
	}

	/**
	 * Wakes a paused execution when HITL calls back. The body is only a hint of which run ended: the
	 * answer is read from the API with the node's own key, so a stray POST cannot fake a decision.
	 */
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const resource = this.getNodeParameter('resource') as string;
		const id = callbackId(resource, this.getBodyData());
		if (!id) return { webhookResponse: { received: false } };
		const answer =
			resource === 'request' ? await readRequest(this, id) : await readRun(this, id, 0);
		const finished = resource === 'request' ? requestFinished(answer) : runFinished(answer);
		if (!finished) return { webhookResponse: { received: true, finished: false } };
		return { workflowData: [this.helpers.returnJsonArray(answer)] };
	}
}
