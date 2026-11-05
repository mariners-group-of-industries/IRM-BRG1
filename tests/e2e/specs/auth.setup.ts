import { test as setup } from '@playwright/test';
import { signIn, USERS } from './helpers';

// Sign each seeded user in once and save the session, so the suite stays well
// under the login rate limit (10 attempts per minute per IP).
for (const [key, email] of Object.entries(USERS)) {
  setup(`sign in ${key}`, async ({ page }) => {
    await signIn(page, email);
    await page.context().storageState({ path: `.auth/${key}.json` });
  });
}
