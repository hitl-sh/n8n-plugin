import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
	INodePropertyOptions,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export class HitlNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HITL Platform',
		icon: 'file:hitl.svg',
		name: 'hitlNode',
		group: ['transform'],
		version: 1,
		description: 'Create human-in-the-loop decision requests and wait for responses',
		defaults: {
			name: 'HITL Platform',
		},
		credentials: [
			{
				name: 'hitlCredentialsApi',
				required: true,
			},
		],
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'hitl-response',
				limitWaitTime: true, // Enable timeout
				resumeUnit: 'seconds',
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Send',
						value: 'send',
						description: 'Send request and return immediately',
					},
					{
						name: 'Send and Wait',
						value: 'sendAndWait',
						description: 'Send request and wait for human response',
					},
				],
				default: 'sendAndWait',
			},
			{
				displayName: 'Loop Name or ID',
				name: 'loopId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getLoops',
				},
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Processing Type',
				name: 'processingType',
				type: 'options',
				default: 'deferred',
				options: [
					{ name: 'Deferred', value: 'deferred' },
					{ name: 'Time-Sensitive', value: 'time-sensitive' },
				],
				description: 'Type of request processing',
			},
			{
				displayName: 'Content Type',
				name: 'contentType',
				type: 'options',
				default: 'markdown',
				options: [
					{ name: 'Text/Markdown', value: 'markdown' },
					{ name: 'Image', value: 'image' },
				],
				description: 'Type of content in the request',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				default: 'medium',
				options: [
					{ name: 'Low', value: 'low' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'High', value: 'high' },
					{ name: 'Critical', value: 'critical' },
				],
				description: 'Priority level for the request',
			},
			{
				displayName: 'Request Text',
				name: 'requestText',
				type: 'string',
				required: true,
				default: '',
				description: 'The question or task for the human to respond to',
				typeOptions: {
					rows: 4,
				},
			},
			{
				displayName: 'Image URL',
				name: 'imageUrl',
				type: 'string',
				default: '',
				description: 'URL of image to include with the request',
				displayOptions: {
					show: {
						contentType: ['image'],
					},
				},
			},
			{
				displayName: 'Context',
				name: 'context',
				type: 'json',
				default: '{}',
				required: false,
				description: 'Optional additional context data for the request (JSON format)',
				typeOptions: {
					rows: 3,
				},
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeoutSeconds',
				type: 'number',
				default: 600,
				description: 'Timeout in seconds for time-sensitive requests (60-86400)',
				displayOptions: {
					show: {
						processingType: ['time-sensitive'],
					},
				},
				typeOptions: {
					minValue: 60,
					maxValue: 86400,
				},
			},
			{
				displayName: 'Response Type',
				name: 'responseType',
				type: 'options',
				required: true,
				default: 'text',
				options: [
					{ name: 'Multi Select', value: 'multi_select' },
					{ name: 'Number', value: 'number' },
					{ name: 'Rating', value: 'rating' },
					{ name: 'Single Select', value: 'single_select' },
					{ name: 'Text', value: 'text' },
					{ name: 'Yes/No', value: 'boolean' },
				],
				description: 'Type of response expected from the human',
			},
			{
				displayName: 'Response Options',
				name: 'responseOptions',
				type: 'string',
				default: '',
				description: 'Comma-separated options (e.g., "Yes,No,Maybe")',
				displayOptions: {
					show: {
						responseType: ['single_select', 'multi_select'],
					},
				},
			},
			{
				displayName: 'Rating Minimum',
				name: 'ratingMin',
				type: 'number',
				default: 1,
				displayOptions: {
					show: {
						responseType: ['rating'],
					},
				},
				description: 'Minimum rating value',
			},
			{
				displayName: 'Rating Maximum',
				name: 'ratingMax',
				type: 'number',
				default: 5,
				displayOptions: {
					show: {
						responseType: ['rating'],
					},
				},
				description: 'Maximum rating value',
			},
			{
				displayName: 'Default Response',
				name: 'defaultResponse',
				type: 'string',
				required: true,
				default: '',
				description: 'Default response if request times out or fails',
			},
		],
	};

	methods = {
		loadOptions: {
			async getLoops(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const credentials = await this.getCredentials('hitlCredentialsApi');
					const options: IHttpRequestOptions = {
						method: 'GET',
						url: `${credentials.baseUrl}/v1/api/loops`,
						headers: {
							Authorization: `Bearer ${credentials.apiKey}`,
							'Content-Type': 'application/json',
						},
						json: true,
					};

					const response = await this.helpers.httpRequest(options);

					if (response.error === false && response.data && response.data.loops) {
						return response.data.loops.map((loop: any) => ({
							name: `${loop.name} (${loop.member_count || 0} members)${loop.description ? ' - ' + loop.description : ''}`,
							value: loop.id,
						}));
					}

					return [];
				} catch (error) {
					throw new NodeOperationError(this.getNode(), `Failed to load loops: ${error.message}`);
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			// Declare variables outside try block for error handling
			let responseType = '';
			let responseConfig: any = {};
			let responseOptions = '';
			let defaultResponse = '';
			let formattedDefaultResponse: any = '';

			try {
				// Get parameters
				const loopId = this.getNodeParameter('loopId', i) as string;
				const processingType = this.getNodeParameter('processingType', i) as string;
				const contentType = this.getNodeParameter('contentType', i) as string;
				const priority = this.getNodeParameter('priority', i) as string;
				const requestText = this.getNodeParameter('requestText', i) as string;
				const context = this.getNodeParameter('context', i) as string;
				responseType = this.getNodeParameter('responseType', i) as string;
				defaultResponse = this.getNodeParameter('defaultResponse', i) as string;

				// Get conditional parameters only if needed
				const imageUrl =
					contentType === 'image' ? (this.getNodeParameter('imageUrl', i) as string) : '';
				const timeoutSeconds =
					processingType === 'time-sensitive'
						? (this.getNodeParameter('timeoutSeconds', i) as number)
						: 600;
				responseOptions =
					responseType === 'single_select' || responseType === 'multi_select'
						? (this.getNodeParameter('responseOptions', i) as string)
						: '';
				const ratingMin =
					responseType === 'rating' ? (this.getNodeParameter('ratingMin', i) as number) : 1;
				const ratingMax =
					responseType === 'rating' ? (this.getNodeParameter('ratingMax', i) as number) : 5;

				// Get operation parameter
				const operation = this.getNodeParameter('operation', i) as string;

				// Validate inputs
				let parsedContext;
				try {
					parsedContext = JSON.parse(context || '{}');
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Invalid JSON format for context: ${error.message}`,
					);
				}

				// Validate required fields
				if (!loopId) {
					throw new NodeOperationError(this.getNode(), 'Loop selection is required');
				}

				if (!requestText.trim()) {
					throw new NodeOperationError(this.getNode(), 'Request text is required');
				}

				if (contentType === 'image' && !imageUrl) {
					throw new NodeOperationError(
						this.getNode(),
						'Image URL is required when content type is image',
					);
				}

				// Operation-based validation
				if (operation === 'sendAndWait') {
					// For sendAndWait, we'll use n8n's built-in webhook system
					// The webhook URL will be generated automatically by n8n
				}

				// Build response config - web portal compatible format
				responseConfig = {};
				if (responseType === 'single_select' || responseType === 'multi_select') {
					if (!responseOptions || !responseOptions.trim()) {
						throw new NodeOperationError(
							this.getNode(),
							'Response options are required for select types',
						);
					}
					const optionsArray = responseOptions
						.split(',')
						.map((opt) => opt.trim())
						.filter((opt) => opt.length > 0);
					if (optionsArray.length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'At least one response option is required for select types',
						);
					}

					// Format options to match web portal format: {value, label}
					const formattedOptions = optionsArray.map((option) => ({
						value: option.toLowerCase().replace(/\s+/g, '_'), // Convert to snake_case for value
						label: option, // Keep original text as label
					}));

					responseConfig = {
						prompt: '',
						options: formattedOptions,
						required: true,
					};

					// For multi_select, add selection limits
					if (responseType === 'multi_select') {
						responseConfig.min_selections = 1;
						responseConfig.max_selections = formattedOptions.length;
					}
				} else if (responseType === 'rating') {
					// Validate rating range
					if (ratingMax <= ratingMin) {
						throw new NodeOperationError(
							this.getNode(),
							`Rating maximum (${ratingMax}) must be greater than minimum (${ratingMin})`,
						);
					}

					responseConfig = {
						prompt: '',
						min: ratingMin,
						max: ratingMax,
						required: true,
					};
				} else if (responseType === 'number') {
					responseConfig = {
						required: true,
						prompt: '',
						min_value: 0,
						max_value: 1000000,
						decimal_places: 0,
						allow_negative: false,
					};
				} else if (responseType === 'text') {
					responseConfig = {
						prompt: '',
						placeholder: 'Enter your response...',
						min_length: 0,
						max_length: 1000,
						required: true,
					};
				} else if (responseType === 'boolean') {
					responseConfig = {
						prompt: '',
						required: true,
					};
				} else {
					// Fallback
					responseConfig = {
						required: true,
					};
				}

				// For now, we'll create without callback and let user poll separately
				// Future versions can implement webhook pattern

				// Format default response to match expected format
				formattedDefaultResponse = defaultResponse;

				if (responseType === 'single_select' || responseType === 'multi_select') {
					// For select types, convert the default response to use the value format
					if (typeof defaultResponse === 'string') {
						const options = responseConfig.options as any[];
						let matchingOption;

						// Try multiple matching strategies in order:
						// 1. Exact label match (case sensitive)
						matchingOption = options.find((opt: any) => opt.label === defaultResponse);

						// 2. Case-insensitive label match
						if (!matchingOption) {
							matchingOption = options.find(
								(opt: any) => opt.label.toLowerCase() === defaultResponse.toLowerCase(),
							);
						}

						// 3. Exact value match (case sensitive)
						if (!matchingOption) {
							matchingOption = options.find((opt: any) => opt.value === defaultResponse);
						}

						// 4. Case-insensitive value match
						if (!matchingOption) {
							matchingOption = options.find(
								(opt: any) => opt.value.toLowerCase() === defaultResponse.toLowerCase(),
							);
						}

						// 5. Try converting default response to snake_case and match value
						if (!matchingOption) {
							const normalizedDefault = defaultResponse.toLowerCase().replace(/\s+/g, '_');
							matchingOption = options.find((opt: any) => opt.value === normalizedDefault);
						}

						if (matchingOption) {
							formattedDefaultResponse = matchingOption.value;
						} else {
							// If no match found, use the first option's value
							formattedDefaultResponse = options[0]?.value || defaultResponse;
						}
					}

					if (responseType === 'multi_select' && typeof formattedDefaultResponse === 'string') {
						// Multi-select expects array format
						formattedDefaultResponse = [formattedDefaultResponse];
					}
				} else if (responseType === 'number') {
					// For number type, convert string to number
					if (typeof defaultResponse === 'string') {
						const numberValue = parseFloat(defaultResponse);
						if (!isNaN(numberValue)) {
							formattedDefaultResponse = numberValue;
						} else {
							throw new NodeOperationError(
								this.getNode(),
								`Default response must be a valid number for number type, got: ${defaultResponse}`,
							);
						}
					} else if (typeof defaultResponse === 'number') {
						formattedDefaultResponse = defaultResponse;
					}
				} else if (responseType === 'rating') {
					// For rating type, convert string to number
					if (typeof defaultResponse === 'string') {
						const ratingValue = parseFloat(defaultResponse);
						if (!isNaN(ratingValue)) {
							// Validate that default response is within rating range
							if (ratingValue < ratingMin || ratingValue > ratingMax) {
								throw new NodeOperationError(
									this.getNode(),
									`Default response ${ratingValue} must be between ${ratingMin} and ${ratingMax}`,
								);
							}
							formattedDefaultResponse = ratingValue;
						} else {
							throw new NodeOperationError(
								this.getNode(),
								`Default response must be a valid number for rating type, got: ${defaultResponse}`,
							);
						}
					} else if (typeof defaultResponse === 'number') {
						// Validate that default response is within rating range
						if (defaultResponse < ratingMin || defaultResponse > ratingMax) {
							throw new NodeOperationError(
								this.getNode(),
								`Default response ${defaultResponse} must be between ${ratingMin} and ${ratingMax}`,
							);
						}
						formattedDefaultResponse = defaultResponse;
					}
				} else if (responseType === 'boolean') {
					// For boolean type, convert string to boolean
					if (typeof defaultResponse === 'string') {
						const lowerDefault = defaultResponse.toLowerCase();
						if (lowerDefault === 'true' || lowerDefault === '1' || lowerDefault === 'yes') {
							formattedDefaultResponse = true;
						} else if (lowerDefault === 'false' || lowerDefault === '0' || lowerDefault === 'no') {
							formattedDefaultResponse = false;
						} else {
							throw new NodeOperationError(
								this.getNode(),
								`Default response must be true/false, yes/no, or 1/0 for boolean type, got: ${defaultResponse}`,
							);
						}
					} else if (typeof defaultResponse === 'boolean') {
						formattedDefaultResponse = defaultResponse;
					}
				}
				// For text type, keep as string (no conversion needed)

				// Prepare request payload - use original format that worked
				const payload: any = {
					processing_type: processingType,
					type: contentType,
					priority: priority,
					request_text: requestText,
					response_type: responseType,
					response_config: responseConfig,
					default_response: formattedDefaultResponse,
					platform: 'n8n',
					platform_version: '1.0.0',
				};

				// For sendAndWait operation, use n8n's resume webhook pattern
				if (operation === 'sendAndWait') {
					// Use the resume webhook pattern like n8n's Wait node
					const executionId = this.getExecutionId();
					const baseUrl = 'https://833ae1ffe9df.ngrok-free.app';
					const webhookUrl = `${baseUrl}/webhook-waiting/${executionId}`;
					payload.callback_url = webhookUrl;
				}

				// Only include optional fields if they have values
				if (contentType === 'image' && imageUrl && imageUrl.trim()) {
					payload.image_url = imageUrl.trim();
				}

				// Include optional fields
				if (context && context.trim() && context.trim() !== '{}') {
					payload.context = parsedContext;
				}

				if (processingType === 'time-sensitive' && timeoutSeconds) {
					payload.timeout_seconds = timeoutSeconds;
				}

				// Make API request
				const credentials = await this.getCredentials('hitlCredentialsApi');
				const options: IHttpRequestOptions = {
					method: 'POST',
					url: `${credentials.baseUrl}/v1/api/loops/${loopId}/requests`,
					headers: {
						Authorization: `Bearer ${credentials.apiKey}`,
						'Content-Type': 'application/json',
					},
					body: payload,
					json: true,
				};

				const response = await this.helpers.httpRequest(options);

				if (response.error === true) {
					throw new NodeOperationError(
						this.getNode(),
						`API Error: ${response.msg || 'Unknown error'}${response.data ? ' - ' + JSON.stringify(response.data) : ''}`,
					);
				}

				const requestId = response.data.request_id;

				// Return request creation result with webhook information
				const responseData: any = {
					request_id: requestId,
					status: response.data.status,
					processing_type: response.data.processing_type,
					priority: response.data.priority,
					timeout_at: response.data.timeout_at,
					broadcasted_to: response.data.broadcasted_to,
					notifications_sent: response.data.notifications_sent,
					polling_url: response.data.polling_url,
					operation: operation,
				};

				if (operation === 'sendAndWait') {
					responseData.message =
						'Request created successfully. Workflow will wait for human response.';
					responseData.instructions =
						'This workflow will continue when a human provides their response.';
				} else {
					responseData.message = 'Request created successfully.';
					responseData.instructions = 'Request created and workflow completed.';
				}

				// Add debug information
				responseData.debug_payload_sent = {
					response_type: responseType,
					response_config: responseConfig,
					response_options_input:
						responseType === 'single_select' || responseType === 'multi_select'
							? responseOptions
							: undefined,
					default_response_original: defaultResponse,
					default_response_formatted: formattedDefaultResponse,
					available_options: responseConfig.options || [],
					operation: operation,
				};

				// For sendAndWait operation, use n8n's resume webhook system
				if (operation === 'sendAndWait') {
					responseData.message = 'Request created successfully. Waiting for human response.';
					responseData.instructions =
						'This workflow will continue when a human provides their response.';

					// Put execution to wait - this registers the /webhook-waiting/{executionId} endpoint
					await this.putExecutionToWait(new Date(Date.now() + 3600 * 1000)); // Wait up to 1 hour

					// Execution resumes here when webhook is called
					// Get the webhook data that resumed the execution
					const resumeData = this.getInputData();
					const webhookResponse = resumeData[0]?.json || {};

					// Handle the response
					if (!webhookResponse || Object.keys(webhookResponse).length === 0) {
						responseData.webhook_response = {
							response: formattedDefaultResponse,
							status: 'timed_out',
						};
						responseData.message = 'Request timed out, using default response';
						responseData.status = 'timed_out';
					} else {
						responseData.webhook_response = webhookResponse;
						responseData.status = webhookResponse.status || 'completed';
						responseData.message = 'Request completed with human response';
					}
				} else {
					responseData.message = 'Request created successfully.';
					responseData.instructions = 'Request created and workflow completed.';
				}

				returnData.push({
					json: responseData,
				});
			} catch (error: any) {
				// Enhanced error handling for debugging
				let errorMessage = error.message;

				// If it's an HTTP error, try to get more details
				if (error.response?.data) {
					try {
						const apiError = error.response.data;
						errorMessage += ` | API Response: ${JSON.stringify(apiError)}`;
					} catch (e) {
						errorMessage += ` | API Response: ${error.response.data}`;
					}
				}

				if (error.response?.status) {
					errorMessage = `HTTP ${error.response.status}: ${errorMessage}`;
				}

				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: errorMessage,
							debug_payload_sent: {
								response_type: responseType,
								response_config: responseConfig,
								response_options_input:
									responseType === 'single_select' || responseType === 'multi_select'
										? responseOptions
										: undefined,
								default_response_original: defaultResponse,
								default_response_formatted: formattedDefaultResponse,
								available_options: responseConfig.options || [],
							},
						},
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), errorMessage);
			}
		}

		return [returnData];
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData();

		// Validate webhook data
		if (!bodyData.request_id || !bodyData.response) {
			throw new NodeOperationError(
				this.getNode(),
				'Invalid webhook data: request_id and response are required',
			);
		}

		// Format the response to include only relevant data
		const responseData = {
			request_id: bodyData.request_id,
			response: bodyData.response,
			status: bodyData.status || 'completed',
			timestamp: new Date().toISOString(),
		};

		return {
			workflowData: [this.helpers.returnJsonArray([responseData])],
		};
	}
}
