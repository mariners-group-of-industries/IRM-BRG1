import { expect, test, type Browser } from '@playwright/test';
import { as, expectNoHorizontalOverflow, shot } from './helpers';

async function venturesId(browser: Browser): Promise<string> {
  const ctx = await browser.newContext(as('platform'));
  const res = await ctx.request.get('/api/v1/companies?pageSize=100');
  const id = ((await res.json()).items as { id: string; slug: string }[]).find((c) => c.slug === 'mariners-ventures')!.id;
  await ctx.close();
  return id;
}

const tabs = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Meeting sections' });

test.describe.serial('meeting lifecycle', () => {
  const title = `E2E General Meeting ${Date.now().toString().slice(-6)}`;
  let meetingUrl = '';

  test('company admin prepares and publishes a meeting', async ({ browser }) => {
    const id = await venturesId(browser);
    const ctx = await browser.newContext(as('meghnaAdmin'));
    const page = await ctx.newPage();
    await page.goto(`/companies/${id}/meetings`);
    await expect(page.getByRole('link', { name: '36th Annual General Meeting 2026' })).toBeVisible();
    await shot(page, 'c01-meetings');

    await page.getByRole('button', { name: 'New meeting' }).click();
    const dialog = page.getByRole('dialog', { name: 'New meeting' });
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Date and time (Dhaka)').fill('2026-12-28T11:00');
    await dialog.getByLabel('Record date').fill('2026-10-31');
    await dialog.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}$/);
    meetingUrl = new URL(page.url()).pathname;

    // Not ready yet: the checklist explains why.
    await expect(page.getByRole('button', { name: 'Publish notice' })).toBeDisabled();
    await expect(page.getByText('Notice text is written')).toBeVisible();
    await shot(page, 'c02-control-draft');

    await tabs(page).getByRole('link', { name: 'Notice & rules' }).click();
    await page.getByLabel('Notice of meeting').fill('Notice is hereby given that an Extraordinary General Meeting will be held virtually to consider the business below.');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Meeting details saved')).toBeVisible();
    await shot(page, 'c03-notice-rules');

    await tabs(page).getByRole('link', { name: 'Agenda' }).click();
    await page.getByRole('button', { name: 'Add item' }).click();
    const item = page.getByRole('dialog', { name: 'Add agenda item' });
    await item.getByLabel('Title').fill('Approval of the related-party transaction');
    await item.getByLabel('Resolution type').selectOption('SPECIAL');
    await item.getByLabel('Resolution text').fill('RESOLVED that the related-party transaction described in the notice be and is hereby approved.');
    await item.getByRole('button', { name: 'Save item' }).click();
    await expect(page.getByText('Special resolution')).toBeVisible();
    await shot(page, 'c04-agenda');

    await tabs(page).getByRole('link', { name: 'Control' }).click();
    await page.getByRole('button', { name: 'Publish notice' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish notice' }).click();
    await expect(page.getByText('Scheduled', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open registration' })).toBeEnabled();
    await ctx.close();
  });

  test('opening registration freezes the record-date holdings', async ({ browser }) => {
    const ctx = await browser.newContext(as('meghnaAdmin'));
    const page = await ctx.newPage();
    await page.goto(meetingUrl);
    await page.getByRole('button', { name: 'Open registration' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Open registration' }).click();
    await expect(page.getByText('Registration open', { exact: true }).first()).toBeVisible();
    await tabs(page).getByRole('link', { name: 'Record date' }).click();
    await expect(page.getByText('Holders on record date')).toBeVisible();
    await expect(page.getByText('3,96,100').first()).toBeVisible();
    await shot(page, 'c05-snapshot');
    await ctx.close();
  });

  test('a shareholder registers from the portal', async ({ browser, page }) => {
    const id = await venturesId(browser);
    await page.goto(`/join/${id}`);
    await page.locator('#identifier').fill('F-00017');
    await page.getByRole('button', { name: /Send me a code/ }).click();
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    const msgs = (await (await page.request.get('/api/v1/dev/outbox')).json()) as { recipient: string; body: string }[];
    const code = /\b(\d{6})\b/.exec(msgs.find((m) => m.recipient === '+8801811000017')!.body)![1]!;
    await page.getByLabel(/6-digit code/).fill(code);
    await page.getByRole('button', { name: /Sign in to/ }).click();
    await expect(page).toHaveURL(/\/portal$/);

    await page.getByRole('link', { name: new RegExp(title) }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('2,000 votes')).toBeVisible();
    await page.getByRole('button', { name: /Register/ }).click();
    await expect(page.getByText('Registered', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'c06-portal-meeting');

    const staff = await browser.newContext(as('meghnaAdmin'));
    const sp = await staff.newPage();
    await sp.goto(`${meetingUrl}/people`);
    await expect(sp.getByRole('cell', { name: 'Shahidul Alam' })).toBeVisible();
    await shot(sp, 'c07-people');
    await staff.close();
  });

  test('the meeting admin starts the meeting; the company admin cannot', async ({ browser }) => {
    const admin = await browser.newContext(as('meghnaAdmin'));
    const ap = await admin.newPage();
    await ap.goto(meetingUrl);
    await expect(ap.getByRole('button', { name: 'Start meeting' })).toBeDisabled();
    await expect(ap.getByText('You have permission for this action')).toBeVisible();
    await admin.close();

    const ops = await browser.newContext(as('meetingAdmin'));
    const op = await ops.newPage();
    await op.goto(meetingUrl);
    await op.getByRole('button', { name: 'Start meeting' }).first().click();
    await op.getByRole('dialog').getByRole('button', { name: 'Start meeting' }).click();
    await expect(op.getByText('Live', { exact: true }).first()).toBeVisible();
    await expect(op.getByRole('button', { name: 'Pause' })).toBeVisible();
    await shot(op, 'c08-control-live');
    await ops.close();
  });
});

test('the demo AGM shows its agenda to staff on a phone @mobile', async ({ browser }) => {
  const id = await venturesId(browser);
  const ctx = await browser.newContext({ ...as('meghnaAdmin'), viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`/companies/${id}/meetings`);
  await page.getByRole('link', { name: '36th Annual General Meeting 2026' }).click();
  await tabs(page).getByRole('link', { name: 'Agenda' }).click();
  await expect(page.getByText('Amendment of the Articles of Association (special business)')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot(page, 'm05-agenda');
  await ctx.close();
});

test('a wrong sign-in code shows an error and keeps the shareholder on the page', async ({ browser, page }) => {
  const id = await venturesId(browser);
  await page.goto(`/join/${id}`);
  await page.locator('#identifier').fill('1201950000000005');
  await page.getByRole('button', { name: /Send me a code/ }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  await page.getByLabel(/6-digit code/).fill('000000');
  await page.getByRole('button', { name: /Sign in to/ }).click();
  await expect(page.locator('form [role="alert"]')).toContainText('The code is incorrect or has expired');
  await expect(page).toHaveURL(new RegExp(`/join/${id}$`));
});
