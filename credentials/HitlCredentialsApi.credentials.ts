import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class HitlCredentialsApi implements ICredentialType {
	name = 'hitlCredentialsApi';
	displayName = 'HITL Platform API';
	documentationUrl = 'https://github.com/hitl-sh/n8n-plugin?tab=readme-ov-file';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
		},
	];
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			// Can be body, header, qs or auth
			qs: {
				// Use the value from `apiKey` above
				api_key: '={{$credentials.apiKey}}',
			},
		},
	};
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials?.domain}}',
			url: '/bearer',
		},
	};
}
