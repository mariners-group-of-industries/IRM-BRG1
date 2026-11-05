'use client';

import * as React from 'react';
import type { MeetingDetail } from '@irm/shared';

const MeetingContext = React.createContext<MeetingDetail | null>(null);
export const MeetingProvider = MeetingContext.Provider;

/** The meeting open in the workspace. Loaded once by the meeting layout. */
export function useMeeting(): MeetingDetail {
  const m = React.useContext(MeetingContext);
  if (!m) throw new Error('useMeeting must be used inside the meeting layout');
  return m;
}

export const meetingKey = (companyId: string, meetingId: string) => ['meetings', companyId, meetingId] as const;
