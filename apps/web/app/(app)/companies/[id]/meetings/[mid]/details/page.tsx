'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Scale } from 'lucide-react';
import { EDITABLE_STATES, RULES_EDITABLE_STATES, type MeetingRules } from '@irm/shared';
import { Button, Field, Input, Panel, PanelHeader, Select, Textarea } from '@irm/ui';
import { api, ApiError } from '@/lib/api';
import { dhakaLocalToIso, isoToDhakaLocal } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCompany } from '../../../company-context';
import { useMeeting } from '../meeting-context';

export default function DetailsPage() {
  const m = useMeeting();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <DetailsForm />
      <RulesForm key={m.version} />
    </div>
  );
}

function DetailsForm() {
  const c = useCompany();
  const m = useMeeting();
  const { can } = useSession();
  const qc = useQueryClient();
  const editable = EDITABLE_STATES.includes(m.state) && can('meeting.update', c.scope);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [mode, setMode] = React.useState(m.mode);

  const save = useMutation({
    mutationFn: (body: object) => api.patch(`/companies/${c.id}/meetings/${m.id}`, body),
    onSuccess: () => {
      toast.success('Meeting details saved');
      setErrors({});
      qc.invalidateQueries({ queryKey: ['meetings', c.id] });
    },
    onError: (e) => {
      setErrors(e instanceof ApiError ? e.fieldErrors : {});
      if (!(e instanceof ApiError) || Object.keys(e.fieldErrors).length === 0) toast.error(e.message);
    },
  });
  const err = (k: string) => errors[k]?.[0];

  return (
    <Panel>
      <PanelHeader title="Meeting and notice" description={editable ? 'Shareholders see this once the notice is published.' : undefined} />
      {!EDITABLE_STATES.includes(m.state) && (
        <p className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-xs text-ink-3"><Lock className="size-3.5" aria-hidden /> Locked after registration opened.</p>
      )}
      <form
        key={m.version}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save.mutate({
            title: String(f.get('title')),
            description: String(f.get('description') ?? ''),
            noticeText: String(f.get('noticeText') ?? ''),
            scheduledStart: dhakaLocalToIso(String(f.get('scheduledStart'))),
            recordDate: String(f.get('recordDate')),
            mode,
            venue: String(f.get('venue') ?? ''),
          });
        }}
      >
        <fieldset disabled={!editable} className="flex flex-col gap-4 px-5 py-5">
          <Field label="Title" htmlFor="title" error={err('title')}>
            <Input id="title" name="title" defaultValue={m.title} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date and time (Dhaka)" htmlFor="scheduledStart" error={err('scheduledStart')}>
              <Input id="scheduledStart" name="scheduledStart" type="datetime-local" defaultValue={isoToDhakaLocal(m.scheduledStart)} />
            </Field>
            <Field label="Record date" htmlFor="recordDate" error={err('recordDate')}>
              <Input id="recordDate" name="recordDate" type="date" defaultValue={m.recordDate} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Format" htmlFor="mode">
              <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value as 'VIRTUAL' | 'HYBRID')}>
                <option value="VIRTUAL">Virtual</option>
                <option value="HYBRID">Hybrid</option>
              </Select>
            </Field>
            {mode === 'HYBRID' && (
              <Field label="Venue" htmlFor="venue" error={err('venue')}>
                <Input id="venue" name="venue" defaultValue={m.venue ?? ''} />
              </Field>
            )}
          </div>
          <Field label="Short description" htmlFor="description" optional>
            <Input id="description" name="description" defaultValue={m.description ?? ''} />
          </Field>
          <Field label="Notice of meeting" htmlFor="noticeText" hint="The full notice text, as sent to members. Bangla is supported." error={err('noticeText')}>
            <Textarea id="noticeText" name="noticeText" rows={12} defaultValue={m.noticeText ?? ''} className="leading-relaxed" />
          </Field>
        </fieldset>
        {editable && (
          <div className="flex justify-end border-t border-line px-5 py-3.5">
            <Button type="submit" loading={save.isPending}>Save details</Button>
          </div>
        )}
      </form>
    </Panel>
  );
}

const FRACTIONS = [
  { label: 'More than 1/2', value: '1/2' },
  { label: 'At least 2/3', value: '2/3' },
  { label: 'At least 3/4', value: '3/4' },
];

function RulesForm() {
  const c = useCompany();
  const m = useMeeting();
  const { can } = useSession();
  const qc = useQueryClient();
  const editable = RULES_EDITABLE_STATES.includes(m.state) && can('meeting.update', c.scope);
  const [rules, setRules] = React.useState<MeetingRules>(m.rules);
  const set = <K extends keyof MeetingRules>(k: K, v: MeetingRules[K]) => setRules((r) => ({ ...r, [k]: v }));
  const frac = (f: { numerator: number; denominator: number }) => `${f.numerator}/${f.denominator}`;
  const parseFrac = (v: string) => {
    const [n, d] = v.split('/').map(Number);
    return { numerator: n!, denominator: d! };
  };

  const save = useMutation({
    mutationFn: () => api.put(`/companies/${c.id}/meetings/${m.id}/rules`, rules),
    onSuccess: () => {
      toast.success('Governance rules saved');
      qc.invalidateQueries({ queryKey: ['meetings', c.id] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? (Object.values(e.fieldErrors).flat()[0] ?? e.message) : e.message),
  });

  const check = (label: string, value: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
      <span>
        <span className="text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
    </label>
  );

  return (
    <Panel>
      <PanelHeader title="Governance rules" description="Used by proposals, poll demand and voting in later stages." />
      <div className="flex items-start gap-3 border-b border-line bg-warning-soft/50 px-5 py-3 text-xs text-ink-2">
        <Scale className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        These settings are configuration, not legal advice. Have the company&apos;s legal adviser confirm them against the Companies Act, BSEC rules where applicable, and the Articles of Association.
      </div>
      {!RULES_EDITABLE_STATES.includes(m.state) && (
        <p className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-xs text-ink-3"><Lock className="size-3.5" aria-hidden /> Locked once the meeting started.</p>
      )}
      <fieldset disabled={!editable} className="flex flex-col gap-5 px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Voting method" htmlFor="votingMethod">
            <Select id="votingMethod" value={rules.votingMethod} onChange={(e) => set('votingMethod', e.target.value as MeetingRules['votingMethod'])}>
              <option value="SHARE_WEIGHTED">Poll: one vote per share</option>
              <option value="ONE_MEMBER_ONE_VOTE">Show of hands: one vote per member</option>
            </Select>
          </Field>
          <Field label="Proposal acceptance" htmlFor="proposalMode">
            <Select id="proposalMode" value={rules.proposal.mode} onChange={(e) => set('proposal', { ...rules.proposal, mode: e.target.value as 'FIRST_ACCEPTED' | 'COLLECT_ALL' })}>
              <option value="FIRST_ACCEPTED">First valid proposer is accepted</option>
              <option value="COLLECT_ALL">Collect all, the chair accepts one</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ordinary resolution passes with" htmlFor="ordinary">
            <Select id="ordinary" value={frac(rules.ordinaryMajority)} onChange={(e) => set('ordinaryMajority', parseFrac(e.target.value))}>
              {FRACTIONS.map((f) => <option key={f.value} value={f.value}>{f.label} of votes cast</option>)}
            </Select>
          </Field>
          <Field label="Special resolution passes with" htmlFor="special">
            <Select id="special" value={frac(rules.specialMajority)} onChange={(e) => set('specialMajority', parseFrac(e.target.value))}>
              {FRACTIONS.map((f) => <option key={f.value} value={f.value}>{f.label} of votes cast</option>)}
            </Select>
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 text-sm font-medium text-ink">Voting</legend>
          {check('Offer "Abstain"', rules.choices.includes('ABSTAIN'), (v) => set('choices', v ? ['FOR', 'AGAINST', 'ABSTAIN'] : ['FOR', 'AGAINST']))}
          {check('Count abstentions in the base', rules.abstainCountsInBase, (v) => set('abstainCountsInBase', v))}
          {check('Allow voters to change their vote before voting closes', rules.allowVoteChange, (v) => set('allowVoteChange', v), 'Off by default. Only the voter can change their own ballot.')}
        </fieldset>
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 text-sm font-medium text-ink">Poll demand and proxies</legend>
          {check('Members may demand a poll', rules.pollDemand.enabled, (v) => set('pollDemand', { ...rules.pollDemand, enabled: v }))}
          {check('Proxies may attend and vote', rules.proxy.allowed, (v) => set('proxy', { ...rules.proxy, allowed: v }))}
          {check('Proxies may speak', rules.proxy.canSpeak, (v) => set('proxy', { ...rules.proxy, canSpeak: v }))}
          {check('Corporate representatives need a board resolution', rules.corporateRep.requireBoardResolution, (v) => set('corporateRep', { requireBoardResolution: v }))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proxy lodgement deadline (hours before)" htmlFor="lodgement">
            <Input id="lodgement" type="number" min={0} max={720} value={rules.proxy.lodgementDeadlineHours} onChange={(e) => set('proxy', { ...rules.proxy, lodgementDeadlineHours: Number(e.target.value) })} />
          </Field>
          <Field label="Audio question limit (seconds)" htmlFor="audio">
            <Input id="audio" type="number" min={120} max={180} value={rules.audioQuestionMaxSeconds} onChange={(e) => set('audioQuestionMaxSeconds', Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Results visibility" htmlFor="visibility">
          <Select id="visibility" value={rules.results.visibility} onChange={(e) => set('results', { ...rules.results, visibility: e.target.value as MeetingRules['results']['visibility'] })}>
            <option value="ALL_AFTER_RELEASE">Everyone, after the meeting admin releases them</option>
            <option value="STAFF_AFTER_CLOSE">Staff only, once voting closes</option>
          </Select>
        </Field>
      </fieldset>
      {editable && (
        <div className="flex justify-end border-t border-line px-5 py-3.5">
          <Button onClick={() => save.mutate()} loading={save.isPending}>Save rules</Button>
        </div>
      )}
    </Panel>
  );
}
