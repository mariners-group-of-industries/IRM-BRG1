import { expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Agm!Dev2026';

export const USERS = {
  platform: 'platform.admin@irm.local',
  groupAdmin: 'group.admin@mariners.example',
  meghnaAdmin: 'cs@marinersventures.example',
  moderator: 'moderator@marinersventures.example',
  meetingAdmin: 'meeting.admin@marinersventures.example',
  padmaAdmin: 'cs@padmapharma.example',
} as const;

export type UserKey = keyof typeof USERS;

/** Saved session for a seeded user, created by auth.setup.ts. */
export const as = (key: UserKey) => ({ storageState: `.auth/${key}.json` });

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** The sign-in form's own alert. Next.js dev mode also renders a route-announcer alert. */
export const formAlert = (page: Page) => page.locator('form [role="alert"]');

/** Fails if the page scrolls horizontally, which signals overflowing layout. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(0);
}

export const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

export const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
