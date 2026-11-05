import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  password: z.string().min(1, 'Enter your password').max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'At least 2 characters')
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens');

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

export const createTenantSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(160),
  slug,
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const COMPANY_TYPES = ['PUBLIC_LISTED', 'PUBLIC_UNLISTED', 'PRIVATE'] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
  PUBLIC_LISTED: 'Public limited, listed',
  PUBLIC_UNLISTED: 'Public limited, unlisted',
  PRIVATE: 'Private limited',
};

export const createCompanySchema = z.object({
  tenantId: z.string().uuid('Select a tenant'),
  legalName: z.string().trim().min(2, 'At least 2 characters').max(200),
  shortName: z.string().trim().min(1, 'Required').max(60),
  slug,
  companyType: z.enum(COMPANY_TYPES),
  registrationNumber: optionalText(60),
  /** Trading code on DSE/CSE where listed. */
  tradingCode: optionalText(20),
  registeredAddress: optionalText(500),
  contactEmail: z.string().trim().email('Enter a valid email').max(254).optional().or(z.literal('')),
  timezone: z.string().trim().min(1).default('Asia/Dhaka'),
});
export type CreateCompanyInput = z.input<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema
  .omit({ tenantId: true, slug: true })
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional() });
export type UpdateCompanyInput = z.input<typeof updateCompanySchema>;
