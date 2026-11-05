'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserCheck } from 'lucide-react';
import type { MeetingParticipantDto, MeetingStaffDto } from '@irm/shared';
import { Alert, Badge, Button, EmptyState, Panel, PanelHeader, Skeleton, Table, TBody, TD, TH, THead, TR } from '@irm/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatShares } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCompany } from '../../../company-context';
import { useMeeting } from '../meeting-context';

const KIND_LABEL = { SHAREHOLDER: 'Shareholder', CORPORATE_REPRESENTATIVE: 'Corporate rep.', PROXY_REPRESENTATIVE: 'Proxy' } as const;

export default function PeoplePage() {
  const c = useCompany();
  const { can } = useSession();
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <StaffPanel />
      <div className="xl:col-span-2">{can('attendance.read', c.scope) ? <Registrations /> : null}</div>
    </div>
  );
}

function StaffPanel() {
  const c = useCompany();
  const m = useMeeting();
  const { can } = useSession();
  const qc = useQueryClient();
  const key = ['meetings', c.id, m.id, 'staff'];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<MeetingStaffDto>(`/companies/${c.id}/meetings/${m.id}/staff`) });
  const [board, setBoard] = React.useState<string[] | null>(null);
  const [mods, setMods] = React.useState<string[] | null>(null);
  // Until the user edits, show what the server has.
  const boardIds = board ?? q.data?.boardMembers.map((b) => b.userId) ?? [];
  const modIds = mods ?? q.data?.moderators.map((b) => b.userId) ?? [];
  const editable = can('meeting.update', c.scope) && !['COMPLETED', 'ARCHIVED'].includes(m.state);
  const save = useMutation({
    mutationFn: () => api.put<MeetingStaffDto>(`/companies/${c.id}/meetings/${m.id}/staff`, { boardMemberIds: boardIds, moderatorIds: modIds }),
    onSuccess: (d) => (qc.setQueryData(key, d), setBoard(null), setMods(null), toast.success('Meeting staff saved')),
    onError: (e) => toast.error(e.message),
  });

  const group = (title: string, role: string, value: string[], set: (v: string[]) => void) => {
    const people = q.data?.candidates.filter((x) => x.roles.includes(role)) ?? [];
    return (
      <fieldset className="px-5 py-4">
        <legend className="mb-2 text-sm font-medium text-ink">{title}</legend>
        {people.length === 0 ? (
          <p className="text-sm text-ink-3">Nobody in this company holds this role yet. Add members from the company overview.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {people.map((p) => (
              <label key={p.userId} className="flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={value.includes(p.userId)}
                  onChange={(e) => set(e.target.checked ? [...value, p.userId] : value.filter((x) => x !== p.userId))}
                  className="accent-[var(--color-accent)]"
                />
                <span className="text-ink">{p.fullName}</span>
                <span className="truncate text-xs text-ink-3">{p.email}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    );
  };

  return (
    <Panel>
      <PanelHeader title="Meeting staff" description="Who joins the board room and who moderates questions" />
      {q.isPending ? <Skeleton className="m-5 h-24" /> : q.isError ? <div className="p-5"><Alert tone="danger">{q.error.message}</Alert></div> : (
        <div className="divide-y divide-line">
          {group('Board members', 'BOARD_MEMBER', boardIds, setBoard)}
          {group('Moderators', 'MODERATOR', modIds, setMods)}
        </div>
      )}
      {editable && q.data && (
        <div className="flex justify-end border-t border-line px-5 py-3.5">
          <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>Save staff</Button>
        </div>
      )}
    </Panel>
  );
}

function Registrations() {
  const c = useCompany();
  const m = useMeeting();
  const q = useQuery({ queryKey: ['meetings', c.id, m.id, 'participants'], queryFn: () => api.get<MeetingParticipantDto[]>(`/companies/${c.id}/meetings/${m.id}/participants`), refetchInterval: 15_000 });
  const total = q.data?.reduce((s, r) => s + BigInt(r.votes), 0n).toString();
  return (
    <Panel>
      <PanelHeader
        title="Registrations"
        description={m.snapshotTakenAt ? 'Participants who registered for this meeting' : 'Registration opens with the record-date snapshot.'}
        actions={q.data && q.data.length > 0 && <span className="text-xs text-ink-3 tabular">{q.data.length} registered · {formatShares(total)} votes</span>}
      />
      {q.isPending ? <Skeleton className="m-5 h-24" /> : q.isError ? <div className="p-5"><Alert tone="danger">{q.error.message}</Alert></div> : q.data.length === 0 ? (
        <EmptyState icon={<UserCheck />} title="No registrations yet" />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Participant</TH>
              <TH>Capacity</TH>
              <TH className="text-right">Votes</TH>
              <TH className="hidden md:table-cell">Registered</TH>
            </tr>
          </THead>
          <TBody>
            {q.data.map((r) => (
              <TR key={r.id}>
                <TD>
                  <p className="font-medium text-ink">{r.participantName}</p>
                  {r.kind !== 'SHAREHOLDER' && <p className="text-xs text-ink-3">for {r.representing}</p>}
                </TD>
                <TD><Badge tone={r.kind === 'SHAREHOLDER' ? 'accent' : 'info'}>{KIND_LABEL[r.kind]}</Badge></TD>
                <TD className="text-right tabular">{formatShares(r.votes)}</TD>
                <TD className="hidden md:table-cell tabular">{formatDateTime(r.registeredAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}
