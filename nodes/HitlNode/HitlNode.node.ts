import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
	INodePropertyOptions,
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
						action: 'Send request and return immediately',
					},
					{
						name: 'Send and Wait',
						value: 'sendAndWait',
						description: 'Send request and wait for human response',
						action: 'Send request and wait for human response',
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

					if (!response.error && response.data && response.data.loops) {
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
			// Note: If multiple input items, the throw will pause after processing the first. Consider single-item use or refactor for batching.
			let responseType = '';
			let responseConfig: any = {};
			let responseOptions = '';
			let defaultResponse = '';
			let formattedDefaultResponse: any = '';

			try {
				// Get parameters
				const operation = this.getNodeParameter('operation', i) as string;
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

				// Only include optional fields if they have values
				if (contentType === 'image' && imageUrl && imageUrl.trim()) {
					payload.image_url = imageUrl.trim();
				}

				if (context && context.trim() && context.trim() !== '{}') {
					payload.context = parsedContext;
				}

				if (processingType === 'time-sensitive' && timeoutSeconds) {
					payload.timeout_seconds = timeoutSeconds;
				}

				// For sendAndWait, we'll use polling instead of webhooks
				// Don't include callback_url - we'll poll for completion

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

				// Handle operations
				if (operation === 'send') {
					// For 'send', return creation details immediately
					const responseData: any = {
						request_id: response.data.request_id,
						status: response.data.status,
						processing_type: response.data.processing_type,
						priority: response.data.priority,
						timeout_at: response.data.timeout_at,
						broadcasted_to: response.data.broadcasted_to,
						notifications_sent: response.data.notifications_sent,
						polling_url: response.data.polling_url,
						message: 'Request created successfully.',
						instructions: 'Request created and workflow completed.',
					};
					returnData.push({ json: responseData });
				} else if (operation === 'sendAndWait') {
					// For 'sendAndWait' - use polling instead of webhooks
					const requestId = response.data.request_id;
					let pollingUrl = response.data.polling_url;
					
					if (!pollingUrl) {
						// Construct polling URL if not provided
						pollingUrl = `${credentials.baseUrl}/v1/api/requests/${requestId}`;
					}
					
					// Ensure polling URL is absolute
					if (!pollingUrl.startsWith('http')) {
						pollingUrl = `${credentials.baseUrl}${pollingUrl.startsWith('/') ? '' : '/'}${pollingUrl}`;
					}
					
					// Poll for completion with timeout
					const maxWaitTime = processingType === 'time-sensitive' ? timeoutSeconds * 1000 : 3600000; // 1 hour default
					const pollInterval = 5000; // 5 seconds
					const startTime = Date.now();
					
					let hitlResponse: any = null;
					let isCompleted = false;
					
					while (!isCompleted && (Date.now() - startTime) < maxWaitTime) {
						// Wait before polling using a simple delay
						const endTime = Date.now() + pollInterval;
						while (Date.now() < endTime) {
							// Simple busy wait for delay
							await new Promise(resolve => resolve(null));
						}
						
						try {
							const pollOptions: IHttpRequestOptions = {
								method: 'GET',
								url: pollingUrl,
								headers: {
									Authorization: `Bearer ${credentials.apiKey}`,
									'Content-Type': 'application/json',
								},
								json: true,
							};
							
							hitlResponse = await this.helpers.httpRequest(pollOptions);
							
							if (hitlResponse.error) {
								throw new NodeOperationError(
									this.getNode(),
									`Polling error: ${hitlResponse.msg || 'Unknown error'}`
								);
							}
							
							const status = hitlResponse.data?.request?.status || hitlResponse.data?.status;
							
							// Check for completed status - be more permissive with status values
							if (status === 'completed' || status === 'answered' || status === 'resolved' || 
								status === 'failed' || status === 'timeout' || status === 'cancelled') {
								isCompleted = true;
							}
							
							// Also check if there's a response_data field indicating completion
							const responseData = hitlResponse.data?.request?.response_data || hitlResponse.data?.response_data;
							if (responseData !== undefined && responseData !== null) {
								isCompleted = true;
							}
							
						} catch (pollError: any) {
							// Continue polling on transient errors, but log them
							if ((Date.now() - startTime) >= maxWaitTime - pollInterval) {
								// If we're near timeout, throw the error
								throw new NodeOperationError(
									this.getNode(),
									`Polling failed: ${pollError.message}`
								);
							}
							// Otherwise continue polling
						}
					}
					
					if (!isCompleted) {
						// Timeout - use default response
						hitlResponse = {
							data: {
								status: 'timeout',
								response: formattedDefaultResponse,
								message: 'Request timed out, using default response'
							}
						};
					}
					
					const finalStatus = hitlResponse.data?.request?.status || hitlResponse.data?.status || 'completed';
					const finalResponse = hitlResponse.data?.request?.response_data || hitlResponse.data?.response_data || formattedDefaultResponse;
					const responseBy = hitlResponse.data?.request?.response_by_user;
					
					const responseData: any = {
						request_id: requestId,
						status: finalStatus,
						response: finalResponse,
						response_by: responseBy,
						response_time_seconds: hitlResponse.data?.request?.response_time_seconds,
						message: hitlResponse.data?.msg || 'Request completed via polling',
						polling_used: true,
						polling_duration_ms: Date.now() - startTime,
						full_response: hitlResponse.data?.request || hitlResponse.data,
						original_request: {
							processing_type: response.data.processing_type,
							priority: response.data.priority,
							timeout_at: response.data.timeout_at,
							broadcasted_to: response.data.broadcasted_to,
							notifications_sent: response.data.notifications_sent,
							polling_url: response.data.polling_url,
						}
					};
					returnData.push({ json: responseData });
				}
			} catch (error: any) {
				// Enhanced error handling
				let errorMessage = error.message;
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
					returnData.push({ json: { error: errorMessage } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), errorMessage);
			}
		}

		return [returnData];
	}
}
