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
