import type { INodeProperties } from 'n8n-workflow';

const show = (resource: string, operation: string[]) => ({ show: { resource: [resource], operation } });

const WAIT_OPTIONS = [
	{
		name: 'Automatic',
		value: 'auto',
		description: 'Use a callback when HITL can reach this n8n, otherwise poll',
	},
	{
		name: 'Callback',
		value: 'callback',
		description:
			'Pause this execution and free the worker until HITL calls back. Needs a public https n8n and one item at a time.',
	},
	{
		name: 'Poll',
		value: 'poll',
		description: 'Keep this execution running and check for the answer. Works on any n8n.',
	},
	{ name: "Don't Wait", value: 'none', description: 'Continue right away' },
];

const waitFields = (resource: string, operation: string): INodeProperties[] => [
	{
		displayName: 'Wait for Answer',
		name: 'waitMode',
		type: 'options',
		noDataExpression: true,
		displayOptions: show(resource, [operation]),
		options: WAIT_OPTIONS,
		default: 'auto',
		description: 'What this node does while people decide',
	},
	{
		displayName: 'Stop Waiting After (Hours)',
		name: 'maxWaitHours',
		type: 'number',
		typeOptions: { minValue: 0.01 },
		displayOptions: { show: { resource: [resource], operation: [operation], waitMode: ['auto', 'callback', 'poll'] } },
		default: 24,
		description:
			'Polling answers with what it has so far. A paused execution continues with its input data, so check for the status field in the next step.',
	},
];

const workflowLocator = (operations: string[], resource = 'workflow'): INodeProperties => ({
	displayName: 'Workflow',
	name: 'workflowId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	displayOptions: show(resource, operations),
	description: 'The HITL workflow',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a workflow...',
			typeOptions: {
				searchListMethod: 'searchWorkflows',
				searchable: true,
				allowNewResource: { label: 'Create a workflow in HITL', url: 'https://my.hitl.sh/workflows' },
			},
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			placeholder: '6726aaaaaaaaaaaaaaaaaaaa',
			validation: [
				{
					type: 'regex',
					properties: { regex: '^[0-9a-f]{24}$', errorMessage: 'Not a workflow ID' },
				},
			],
		},
	],
});

export const properties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Workflow', value: 'workflow' },
			{ name: 'Run', value: 'run' },
			{ name: 'Request', value: 'request' },
		],
		default: 'workflow',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['workflow'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get a workflow',
				description: 'Get one workflow and its steps',
			},
			{
				name: 'Get Input Fields',
				value: 'getInput',
				action: 'Get the input fields of a workflow',
				description: 'See which input fields its steps read',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many workflows',
				description: 'List your workflows',
			},
			{
				name: 'Run',
				value: 'run',
				action: 'Run a workflow',
				description: 'Start a workflow and optionally wait for the people in it to decide',
			},
		],
		default: 'run',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['run'] } },
		options: [
			{ name: 'Get', value: 'get', action: 'Get a run', description: 'Get one run of a workflow' },
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many runs',
				description: 'List the runs of a workflow, newest first',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['request'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a request',
				description: 'Ask the people in a loop and optionally wait for the answer',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a request',
				description: 'Get one request and its answer',
			},
		],
		default: 'create',
	},

	// Workflow
	workflowLocator(['get', 'getInput', 'run']),
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		displayOptions: show('workflow', ['getAll']),
		options: [
			{ name: 'Active', value: 'active' },
			{ name: 'All', value: '' },
			{ name: 'Draft', value: 'draft' },
			{ name: 'Paused', value: 'paused' },
		],
		default: '',
		description: 'Only workflows with this status',
	},
	{
		displayName: 'Request Details',
		name: 'fields',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		displayOptions: show('workflow', ['run']),
		description: 'The fields this workflow reads, filled from your data',
		typeOptions: {
			loadOptionsDependsOn: ['workflowId.value'],
			resourceMapper: {
				resourceMapperMethod: 'getInputFields',
				mode: 'add',
				valuesLabel: 'Request Details',
				fieldWords: { singular: 'field', plural: 'fields' },
				addAllFields: true,
				supportAutoMap: true,
				allowEmptyValues: true,
				noFieldsError:
					"This workflow doesn't read any fields. Use Additional Input to send data anyway.",
			},
		},
	},
	{
		displayName: 'Additional Input (JSON)',
		name: 'input',
		type: 'json',
		displayOptions: show('workflow', ['run']),
		default: '{}',
		description:
			'Anything else to send with the run. Request Details win when both set a field. Up to 64 KB with the details.',
	},
	...waitFields('workflow', 'run'),
	{
		displayName: 'Answer Output Names or IDs',
		name: 'answerOutputs',
		type: 'multiOptions',
		noDataExpression: true,
		displayOptions: {
			show: { resource: ['workflow'], operation: ['run'], waitMode: ['auto', 'callback', 'poll'] },
		},
		typeOptions: { loadOptionsMethod: 'getAnswers', loadOptionsDependsOn: ['workflowId.value'] },
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		hint: 'Each answer picked here gets its own output. Other answers, no answer in time and failed runs go to Other. Leave empty for one output.',
	},

	// Run
	{
		displayName: 'Run ID',
		name: 'runId',
		type: 'string',
		required: true,
		displayOptions: show('run', ['get']),
		default: '',
		description: 'The ID the Run operation answered with',
	},
	workflowLocator(['getAll'], 'run'),
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		displayOptions: show('run', ['getAll']),
		options: [
			{ name: 'All', value: '' },
			{ name: 'Completed', value: 'completed' },
			{ name: 'Failed', value: 'failed' },
			{ name: 'Pending Review', value: 'pending_review' },
			{ name: 'Running', value: 'running' },
			{ name: 'Timed Out', value: 'timed_out' },
		],
		default: '',
		description: 'Only runs with this status',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		displayOptions: show('run', ['getAll']),
		default: 50,
		description: 'Max number of results to return',
	},

	// Request
	{
		displayName: 'Loop',
		name: 'loopId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: show('request', ['create']),
		description: 'The group of people to ask',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a loop...',
				typeOptions: { searchListMethod: 'searchLoops', searchable: true },
			},
			{ displayName: 'ID', name: 'id', type: 'string', placeholder: '6726aaaaaaaaaaaaaaaaaaaa' },
		],
	},
	{
		displayName: 'Request Text',
		name: 'requestText',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		displayOptions: show('request', ['create']),
		default: '',
		description: 'What to ask. Markdown works. Up to 2000 characters.',
	},
	{
		displayName: 'Response Type',
		name: 'responseType',
		type: 'options',
		displayOptions: show('request', ['create']),
		options: [
			{ name: 'Boolean', value: 'boolean', description: 'Yes or no' },
			{ name: 'Editable Text', value: 'editable_text', description: 'Edit a draft' },
			{ name: 'Multi Select', value: 'multi_select', description: 'Several of the options' },
			{ name: 'Number', value: 'number', description: 'A number' },
			{ name: 'Rating', value: 'rating', description: 'A score' },
			{ name: 'Single Select', value: 'single_select', description: 'One of the options' },
			{ name: 'Text', value: 'text', description: 'Free text' },
		],
		default: 'boolean',
	},
	{
		displayName: 'Options',
		name: 'responseOptions',
		type: 'string',
		required: true,
		displayOptions: {
			show: {
				resource: ['request'],
				operation: ['create'],
				responseType: ['single_select', 'multi_select'],
			},
		},
		default: '',
		placeholder: 'Approve, Reject, Escalate',
		description: 'The choices, separated by commas',
	},
	{
		displayName: 'Default Response',
		name: 'defaultResponse',
		type: 'string',
		required: true,
		displayOptions: show('request', ['create']),
		default: 'false',
		description:
			'The answer to use if nobody responds in time: true or false, one of the options, a number, or text. For multi select, separate with commas.',
	},
	{
		displayName: 'Priority',
		name: 'priority',
		type: 'options',
		displayOptions: show('request', ['create']),
		options: [
			{ name: 'Critical', value: 'critical' },
			{ name: 'High', value: 'high' },
			{ name: 'Low', value: 'low' },
			{ name: 'Medium', value: 'medium' },
		],
		default: 'medium',
	},
	{
		displayName: 'Timeout (Seconds)',
		name: 'timeoutSeconds',
		type: 'number',
		typeOptions: { minValue: 60, maxValue: 86400 },
		displayOptions: show('request', ['create']),
		default: 3600,
		description: 'How long people have to answer, 60 to 86400',
	},
	{
		displayName: 'Additional Fields (JSON)',
		name: 'additional',
		type: 'json',
		displayOptions: show('request', ['create']),
		default: '{}',
		description:
			'Any other request field, such as context, image_url or response_config. These win over the fields above. See docs.hitl.sh.',
	},
	...waitFields('request', 'create'),
	{
		displayName: 'Request ID',
		name: 'requestId',
		type: 'string',
		required: true,
		displayOptions: show('request', ['get']),
		default: '',
		description: 'The ID the Create operation answered with',
	},
];
