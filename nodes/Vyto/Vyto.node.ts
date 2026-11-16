import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';
import { CASE_STATUSES, listCases, multipartBody, vytoErrorMessage, vytoRequest } from './GenericFunctions';

// Programmatic style: uploads send a binary file as multipart/form-data and "Get Many" pages through a cursor,
// both of which are easier to get right in code than with declarative routing.
export class Vyto implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'vyto',
		name: 'vyto',
		icon: { light: 'file:vyto.svg', dark: 'file:vyto.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Traffic fines for rental and fleet operators: read cases and upload notices',
		defaults: { name: 'vyto' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'vytoApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Case', value: 'case' },
					{ name: 'Notice', value: 'document' },
				],
				default: 'case',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['case'] } },
				options: [
					{ name: 'Get Many', value: 'getAll', description: 'Get many cases', action: 'Get many cases' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['document'] } },
				options: [
					{
						name: 'Upload',
						value: 'upload',
						description: 'Upload a notice (PDF); vyto reads it like an e-mail to the account inbox',
						action: 'Upload a notice',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get the processing status of an uploaded notice and the resulting case',
						action: 'Get an uploaded notice',
					},
				],
				default: 'upload',
			},

			// Case → Get Many
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				displayOptions: { show: { resource: ['case'], operation: ['getAll'] } },
				default: false,
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				displayOptions: { show: { resource: ['case'], operation: ['getAll'], returnAll: [false] } },
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				displayOptions: { show: { resource: ['case'], operation: ['getAll'] } },
				default: {},
				options: [
					{
						displayName: 'License Plate',
						name: 'licensePlate',
						type: 'string',
						default: '',
						description: 'Any spelling; spaces and dashes are ignored',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'multiOptions',
						options: CASE_STATUSES.map((s) => ({ name: s, value: s })),
						default: [],
					},
					{
						displayName: 'Updated Since',
						name: 'updatedSince',
						type: 'dateTime',
						default: '',
						description: 'Only cases changed at or after this time',
					},
				],
			},

			// Notice → Upload
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['upload'] } },
				default: 'data',
				hint: 'The name of the input binary field containing the PDF',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				displayOptions: { show: { resource: ['document'], operation: ['upload'] } },
				default: {},
				options: [
					{
						displayName: 'External Reference',
						name: 'externalRef',
						type: 'string',
						default: '',
						description: 'Your ID for this upload. Uploading again with the same reference returns the first upload.',
					},
					{
						displayName: 'License Plate',
						name: 'licensePlate',
						type: 'string',
						default: '',
						description: 'Used if vyto finds no license plate in the document',
					},
				],
			},

			// Notice → Get
			{
				displayName: 'Notice ID',
				name: 'documentId',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['get'] } },
				default: '',
				description: 'The ID returned by "Upload"',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'case' && operation === 'getAll') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const filters = this.getNodeParameter('filters', i) as IDataObject;
					const cases = await listCases.call(
						this,
						{
							license_plate: filters.licensePlate as string | undefined,
							status: ((filters.status as string[] | undefined) ?? []).join(','),
							updated_since: filters.updatedSince ? new Date(filters.updatedSince as string).toISOString() : undefined,
						},
						returnAll ? undefined : (this.getNodeParameter('limit', i) as number),
					);
					for (const c of cases) returnData.push({ json: c, pairedItem: { item: i } });
					continue;
				}

				if (resource === 'document' && operation === 'upload') {
					const property = this.getNodeParameter('binaryPropertyName', i) as string;
					const fields = this.getNodeParameter('additionalFields', i) as IDataObject;
					const binary = this.helpers.assertBinaryData(i, property);
					const buffer = await this.helpers.getBinaryDataBuffer(i, property);
					const { body, contentType } = multipartBody(
						{ buffer, fileName: binary.fileName ?? 'notice.pdf', mimeType: binary.mimeType || 'application/pdf' },
						{ license_plate: (fields.licensePlate as string) ?? '', external_ref: (fields.externalRef as string) ?? '' },
					);
					const doc = await vytoRequest.call(this, 'POST', '/documents', {
						body,
						headers: { 'Content-Type': contentType },
						json: false,
					});
					returnData.push({ json: doc, pairedItem: { item: i } });
					continue;
				}

				if (resource === 'document' && operation === 'get') {
					const id = (this.getNodeParameter('documentId', i) as string).trim();
					if (!/^[0-9a-f-]{36}$/i.test(id)) {
						throw new NodeOperationError(this.getNode(), 'The notice ID must be the UUID returned by "Upload"', { itemIndex: i });
					}
					returnData.push({ json: await vytoRequest.call(this, 'GET', `/documents/${id}`), pairedItem: { item: i } });
					continue;
				}

				throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}" for "${resource}"`, { itemIndex: i });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: vytoErrorMessage(error) ?? (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i, message: vytoErrorMessage(error) });
			}
		}

		return [returnData];
	}
}
