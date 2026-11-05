'use client';

import * as React from 'react';
import type { CompanySummary } from '@irm/shared';

const CompanyContext = React.createContext<CompanySummary | null>(null);

export const CompanyProvider = CompanyContext.Provider;

/** The company whose section is open. Loaded once by the company layout. */
export function useCompany(): CompanySummary & { scope: { tenantId: string; companyId: string } } {
  const c = React.useContext(CompanyContext);
  if (!c) throw new Error('useCompany must be used inside the company layout');
  return { ...c, scope: { tenantId: c.tenantId, companyId: c.id } };
}
