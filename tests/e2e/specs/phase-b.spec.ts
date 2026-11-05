import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { as, expectNoHorizontalOverflow, shot } from './helpers';

async function companyId(browser: Browser, slug: string): Promise<string> {
  const ctx = await browser.newContext(as('platform'));
  const res = await ctx.request.get('/api/v1/companies?pageSize=100');
  const id = ((await res.json()).items as { id: string; slug: string }[]).find((c) => c.slug === slug)!.id;
  await ctx.close();
  return id;
}

/** RFC 6238 TOTP, so the test can act as an authenticator app. */
function totp(secret: string, step = Math.floor(Date.now() / 30000)): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function latestCode(request: APIRequestContext, recipient: string): Promise<string> {
  const msgs = (await (await request.get('/api/v1/dev/outbox')).json()) as { recipient: string; body: string }[];
  const m = msgs.find((x) => x.recipient === recipient);
  if (!m) throw new Error(`no outbox message for ${recipient}`);
  return /\b(\d{6})\b/.exec(m.body)![1]!;
}

test.describe('shareholder register', () => {
  test('company admin sees the register with full account numbers', async ({ browser }) => {
    const cement = await companyId(browser, 'mariners-ventures');
    const ctx = await browser.newContext(as('meghnaAdmin'));
    const page = await ctx.newPage();
    await page.goto(`/companies/${cement}`);
    await page.getByRole('navigation', { name: 'Company sections' }).getByRole('link', { name: 'Shareholders' }).click();
    await expect(page).toHaveURL(/\/shareholders$/);
    await expect(page.getByRole('link', { name: 'Abdul Karim' })).toBeVisible();
    await expect(page.getByText('1201950000000001')).toBeVisible();
    await expect(page.getByText('Shareholders', { exact: true }).first()).toBeVisible();
    await shot(page, 'b01-shareholders');

    await page.getByRole('link', { name: 'Delta Life Investments Limited' }).click();
    await expect(page.getByRole('heading', { name: 'Delta Life Investments Limited' })).toBeVisible();
    await expect(page.getByText('3,70,000')).toBeVisible();
    await shot(page, 'b02-shareholder-detail');
    await ctx.close();
  });

  test('meeting admin sees masked account numbers', async ({ browser }) => {
    const cement = await companyId(browser, 'mariners-ventures');
    const ctx = await browser.newContext(as('meetingAdmin'));
    const page = await ctx.newPage();
    await page.goto(`/companies/${cement}/shareholders`);
    await expect(page.getByText('Account numbers are masked for your role')).toBeVisible();
    await expect(page.getByText('1201••••••••0001')).toBeVisible();
    await expect(page.getByText('1201950000000001')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Company sections' }).getByRole('link', { name: 'Register imports' })).toHaveCount(0);
    await ctx.close();
  });

  test('imports a register through mapping, preview and commit', async ({ browser }) => {
    const textiles = await companyId(browser, 'mariners-foods');
    const ctx = await browser.newContext(as('groupAdmin'));
    const page = await ctx.newPage();
    const run = Date.now().toString().slice(-6);
    const csv = [
      'BO ID,Name of Shareholder,Holder Type,Current Balance,Mobile No',
      `1201955555${run},E2E Holder ${run},Individual,"1,250",01711${run.slice(0, 6)}`,
      `1201956666${run},E2E Corporate ${run} Ltd,Corporate,40000,`,
      `bad-${run},Broken Row,Individual,10,`,
    ].join('\n');

    await page.goto(`/companies/${textiles}/imports`);
    await shot(page, 'b03-imports');
    await page.locator('#register-file').setInputFiles({ name: `register-${run}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page).toHaveURL(/\/imports\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel('BO ID', { exact: true })).toHaveValue('BO ID');
    await expect(page.getByLabel('Number of shares')).toHaveValue('Current Balance');
    await shot(page, 'b04-import-mapping');

    await page.getByRole('button', { name: 'Check rows' }).click();
    await expect(page.getByRole('heading', { name: '2. Review changes' })).toBeVisible();
    await expect(page.getByText('must be 16 digits')).toBeVisible();
    await shot(page, 'b05-import-preview');

    await expect(page.getByRole('button', { name: 'Commit to register' })).toBeDisabled();
    await page.getByLabel(/Skip 1 row with errors/).check();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Commit to register' }).click();
    await expect(page.getByText('Register updated').first()).toBeVisible();
    await shot(page, 'b06-import-committed');

    await page.getByRole('link', { name: 'View shareholders' }).click();
    await page.getByLabel('Search shareholders').fill(`E2E Holder ${run}`);
    await expect(page.getByRole('link', { name: `E2E Holder ${run}` })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await ctx.close();
  });

  test('representatives and proxies are listed with their status', async ({ browser }) => {
    const cement = await companyId(browser, 'mariners-ventures');
    const ctx = await browser.newContext(as('meghnaAdmin'));
    const page = await ctx.newPage();
    await page.goto(`/companies/${cement}/authorizations`);
    await expect(page.getByText('Imran Hossain')).toBeVisible();
    await expect(page.getByText('Nasima Akter')).toBeVisible();
    await page.getByRole('button', { name: 'Add proxy' }).click();
    await expect(page.getByRole('dialog', { name: 'Add proxy' })).toBeVisible();
    await shot(page, 'b07-authorizations');
    await ctx.close();
  });
});

test.describe('participant sign-in', () => {
  test('a shareholder signs in with a one-time code and sees their holding', async ({ page, browser }) => {
    const cement = await companyId(browser, 'mariners-ventures');
    await page.goto(`/join/${cement}`);
    await expect(page.getByText('Mariners Ventures PLC')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'b08-join');

    await page.locator('#identifier').fill('1201 9500 0000 0002');
    await page.getByRole('button', { name: /Send me a code/ }).click();
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    await shot(page, 'b09-join-code');

    const code = await latestCode(page.request, 'rokeya.begum@example.com');
    const outbox = await browser.newPage();
    await outbox.goto('/dev/outbox');
    await expect(outbox.getByText('Development outbox, not a real SMS or email service')).toBeVisible();
    await shot(outbox, 'b10-dev-outbox');
    await outbox.close();

    await page.getByLabel(/6-digit code/).fill(code);
    await page.getByRole('button', { name: 'Sign in to Mariners Ventures' }).click();
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole('heading', { name: 'Welcome, Rokeya Begum' })).toBeVisible();
    await expect(page.getByText('8,500').first()).toBeVisible();
    await expect(page.getByText('1201••••••••0002')).toBeVisible();
    await shot(page, 'b11-portal');

    // Participants cannot open the staff console.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/portal$/);
  });

  test('a proxy signs in by email and sees the grantor and scope @mobile', async ({ page, browser }) => {
    const cement = await companyId(browser, 'mariners-ventures');
    await page.goto(`/join/${cement}`);
    await page.locator('label', { hasText: 'appointed as proxy' }).click();
    await page.getByLabel(/Email on your authorization/).fill('nasima.akter@example.com');
    await page.getByRole('button', { name: /Send me a code/ }).click();
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    await page.getByLabel(/6-digit code/).fill(await latestCode(page.request, 'nasima.akter@example.com'));
    await page.getByRole('button', { name: 'Sign in to Mariners Ventures' }).click();
    // The dev database can hold the same demo proxy in more than one company.
    await expect(page.getByText('Abdul Karim').first()).toBeVisible();
    await expect(page.getByText('May attend and vote').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'm04-portal-proxy');
  });
});

test.describe('staff two-step verification', () => {
  test('a staff user enrols with an authenticator and must use it to sign in', async ({ page, browser }) => {
    const email = `mfa.${Date.now()}@irm.local`;
    const password = 'Str0ng!Passphrase';
    const admin = await browser.newContext(as('platform'));
    const me = await (await admin.request.get('/api/v1/auth/me')).json();
    await admin.request.post('/api/v1/users', {
      data: { email, fullName: 'Two Step Tester', password },
      headers: { 'X-CSRF-Token': me.csrfToken },
    });
    await admin.close();

    await page.goto('/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto('/account/security');
    await page.getByRole('button', { name: 'Set up' }).click();
    await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();
    const secret = (await page.locator('code').innerText()).trim();
    await shot(page, 'b12-mfa-setup');
    await page.getByLabel('Verification code').fill(totp(secret));
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
    await page.getByRole('button', { name: 'I have saved them' }).click();
    await expect(page.getByText('Each sign-in needs a code')).toBeVisible();

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Two-step verification')).toBeVisible();
    await shot(page, 'b13-mfa-login');
    // Use the next time step so the enrolment code is not a replay.
    await page.getByLabel('Verification code').fill(totp(secret, Math.floor(Date.now() / 30000) + 1));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
