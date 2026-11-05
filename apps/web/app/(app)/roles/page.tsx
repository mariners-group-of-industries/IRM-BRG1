'use client';

import * as React from 'react';
import { Check, Minus } from 'lucide-react';
import { PERMISSION_DESCRIPTIONS, ROLE_DEFINITIONS, type Permission } from '@irm/shared';
import { Badge, Panel, PanelHeader } from '@irm/ui';
import { PageHeader } from '@/components/shell/app-shell';

/** Groups permissions by their resource prefix for readability. */
const GROUPS: { label: string; prefixes: string[] }[] = [
  { label: 'Platform', prefixes: ['platform.', 'tenant.'] },
  { label: 'Company & access', prefixes: ['company.', 'user.', 'role.', 'audit.'] },
  { label: 'Shareholders', prefixes: ['shareholder.'] },
  { label: 'Meetings', prefixes: ['meeting.', 'agenda.', 'document.', 'announcement.', 'attendance.'] },
  { label: 'Participation', prefixes: ['proposal.', 'seconding.', 'polldemand.', 'vote.', 'question.submit'] },
  { label: 'Moderation', prefixes: ['question.moderate', 'question.forwarded'] },
  { label: 'Voting & reports', prefixes: ['voting.', 'ballot.', 'report.'] },
];

const SHORT: Record<string, string> = {
  PLATFORM_SUPER_ADMIN: 'Platform admin',
  COMPANY_ADMIN: 'Company admin',
  MEETING_ADMIN: 'Meeting admin',
  BOARD_MEMBER: 'Board',
  MODERATOR: 'Moderator',
  COMPANY_OFFICIAL: 'Official',
  SHAREHOLDER: 'Shareholder',
  CORPORATE_REPRESENTATIVE: 'Corporate rep.',
  PROXY_REPRESENTATIVE: 'Proxy',
};

export default function RolesPage() {
  const all = Object.keys(PERMISSION_DESCRIPTIONS) as Permission[];
  const grouped = GROUPS.map((g) => ({ ...g, perms: all.filter((p) => g.prefixes.some((pre) => p.startsWith(pre))) }));

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="The permission matrix enforced on every API request. Participant roles also require a verified entitlement before any vote or submission is accepted."
      />

      <Panel className="mb-6">
        <PanelHeader title="Roles" />
        <ul className="grid divide-line sm:grid-cols-2 lg:grid-cols-3 [&>li]:border-b [&>li]:border-line">
          {ROLE_DEFINITIONS.map((r) => (
            <li key={r.key} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-ink">{r.name}</p>
                {r.participant && <Badge tone="accent">Participant</Badge>}
              </div>
              <p className="mt-1 text-[0.8125rem] text-ink-3">{r.description}</p>
              <p className="mt-2 text-xs text-ink-4">
                Assignable at {r.allowedScopes.map((s) => (s === 'TENANT' ? 'group' : s.toLowerCase())).join(' or ')} scope
              </p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title="Permission matrix" description="Individual ballot access is never part of a role. It needs an audited, time-limited privileged grant." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line">
                <th scope="col" className="w-[30%] px-4 py-2.5 text-left text-xs font-medium text-ink-3">Permission</th>
                {ROLE_DEFINITIONS.map((r) => (
                  <th key={r.key} scope="col" className="px-2 py-2.5 text-center text-xs font-medium text-ink-3">
                    {SHORT[r.key] ?? r.name}
                  </th>
                ))}
              </tr>
            </thead>
            {grouped.map((g) => (
              <tbody key={g.label}>
                <tr className="bg-subtle/60">
                  <th colSpan={ROLE_DEFINITIONS.length + 1} scope="colgroup" className="px-4 py-1.5 text-left text-2xs font-medium tracking-wide text-ink-3 uppercase">
                    {g.label}
                  </th>
                </tr>
                {g.perms.map((p) => (
                  <tr key={p} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-2 text-left font-normal">
                      <span className="block text-ink-2">{PERMISSION_DESCRIPTIONS[p]}</span>
                      <code className="text-2xs text-ink-4">{p}</code>
                    </th>
                    {ROLE_DEFINITIONS.map((r) => {
                      const has = r.permissions.includes(p);
                      return (
                        <td key={r.key} className="px-2 py-2 text-center">
                          {has ? (
                            <Check className="mx-auto size-4 text-accent" aria-label="Granted" />
                          ) : (
                            <Minus className="mx-auto size-3.5 text-line-strong" aria-label="Not granted" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Panel>
    </>
  );
}
