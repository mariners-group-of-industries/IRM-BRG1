import { Badge } from '@irm/ui';

export function CompanyStatusBadge({ status }: { status: string }) {
  return status === 'ACTIVE' ? (
    <Badge tone="success" dot>
      Active
    </Badge>
  ) : (
    <Badge tone="warning" dot>
      Suspended
    </Badge>
  );
}

export function UserStatusBadge({ status }: { status: string }) {
  return status === 'ACTIVE' ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Disabled</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === 'SUCCESS') return <Badge tone="success">Success</Badge>;
  if (outcome === 'DENIED') return <Badge tone="warning">Denied</Badge>;
  return <Badge tone="danger">Failed</Badge>;
}

export function ScopeBadge({ scope }: { scope: string }) {
  const label = scope === 'PLATFORM' ? 'Platform' : scope === 'TENANT' ? 'Group' : 'Company';
  return <Badge tone={scope === 'PLATFORM' ? 'info' : scope === 'TENANT' ? 'accent' : 'neutral'}>{label}</Badge>;
}

export function ImportStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'COMMITTED':
      return <Badge tone="success" dot>Committed</Badge>;
    case 'VALIDATED':
      return <Badge tone="info" dot>Ready to commit</Badge>;
    case 'UPLOADED':
      return <Badge tone="neutral" dot>Needs mapping</Badge>;
    case 'CANCELLED':
      return <Badge tone="neutral">Cancelled</Badge>;
    default:
      return <Badge tone="danger">Failed</Badge>;
  }
}

export function AuthorizationStatusBadge({ status, effective }: { status: string; effective?: boolean }) {
  if (status === 'APPROVED') return effective ? <Badge tone="success" dot>Active</Badge> : <Badge tone="warning" dot>Approved, outside dates</Badge>;
  if (status === 'PENDING') return <Badge tone="warning" dot>Awaiting approval</Badge>;
  if (status === 'REJECTED') return <Badge tone="danger">Rejected</Badge>;
  return <Badge tone="neutral">Revoked</Badge>;
}

const MEETING_TONES: Record<string, 'neutral' | 'info' | 'accent' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  REGISTRATION_OPEN: 'accent',
  LIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'neutral',
  ARCHIVED: 'neutral',
};
const MEETING_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  REGISTRATION_OPEN: 'Registration open',
  LIVE: 'Live',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

export function MeetingStateBadge({ state }: { state: string }) {
  return (
    <Badge tone={MEETING_TONES[state] ?? 'neutral'} dot={state !== 'COMPLETED' && state !== 'ARCHIVED'}>
      {MEETING_LABELS[state] ?? state}
    </Badge>
  );
}
