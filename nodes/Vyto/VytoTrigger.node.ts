import {
	NodeApiError,
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
	type JsonObject,
} from 'n8n-workflow';
import { CASE_STATUSES, listCases, newSince, vytoErrorMessage, type PollState } from './GenericFunctions';

// Polls GET /cases for cases created or changed since the last poll (vyto has no outgoing webhooks yet).
export class VytoTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'vyto Trigger',
		name: 'vytoTrigger',
		icon: { light: 'file:vyto.svg', dark: 'file:vyto.dark.svg' },
		group: ['trigger'],
		version: 1,
		description: 'Starts the workflow when a vyto case is created or changed',
		subtitle: 'New or updated case',
		defaults: { name: 'vyto Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'vytoApi', required: true }],
		properties: [
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
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
						description: 'Only cases with one of these statuses (empty = all)',
					},
				],
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const filters = this.getNodeParameter('filters') as IDataObject;
		const query = {
			license_plate: filters.licensePlate as string | undefined,
			status: ((filters.status as string[] | undefined) ?? []).join(','),
		};
		const state = this.getWorkflowStaticData('node') as PollState;

		try {
			// Manual test run: the most recently changed case from the last 30 days as sample data
			if (this.getMode() === 'manual') {
				const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
				const recent = await listCases.call(this, { ...query, updated_since: since }, 1000);
				return recent.length ? [this.helpers.returnJsonArray([recent[recent.length - 1]])] : null;
			}

			// First activation: start from now, do not replay older cases
			if (!state.lastUpdatedAt) {
				state.lastUpdatedAt = new Date().toISOString();
				state.lastIds = [];
				return null;
			}

			const cases = await listCases.call(this, { ...query, updated_since: state.lastUpdatedAt });
			const { fresh, next } = newSince(cases, state);
			state.lastUpdatedAt = next.lastUpdatedAt;
			state.lastIds = next.lastIds;
			return fresh.length ? [this.helpers.returnJsonArray(fresh)] : null;
		} catch (error) {
			throw new NodeApiError(this.getNode(), error as JsonObject, { message: vytoErrorMessage(error) });
		}
	}
}
