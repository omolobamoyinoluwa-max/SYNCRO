/**
 * Contract Event Types
 * Standardized types for events emitted by the Soroban contract
 */

export interface ContractEvent {
  type: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topics: string[];
  value: any;
}

export interface ProcessedEvent {
  sub_id: number;
  event_type: string;
  ledger: number;
  tx_hash: string;
  event_data: any;
}

export interface DBContractEvent extends ProcessedEvent {
  id: string;
  processed_at: string;
}

export enum EventType {
  RENEWAL_SUCCESS = 'renewal_success',
  RENEWAL_FAILED = 'renewal_failed',
  DUPLICATE_RENEWAL_REJECTED = 'duplicate_renewal_rejected',
  STATE_TRANSITION = 'state_transition',
  APPROVAL_CREATED = 'approval_created',
  APPROVAL_REJECTED = 'approval_rejected',
  EXECUTOR_ASSIGNED = 'executor_assigned',
  EXECUTOR_REMOVED = 'executor_removed',
  LIFECYCLE_TIMESTAMP_UPDATED = 'lifecycle_timestamp_updated',
}
