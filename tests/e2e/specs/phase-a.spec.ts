import { expect, test } from '@playwright/test';
import { as, expectNoHorizontalOverflow, formAlert, nav, shot, signIn, USERS } from './helpers';

test.describe('authentication', () => {
  test('redirects signed-out visitors to the sign-in page', async ({ page }) => {
    await page.goto('/companies');
    await expect(page).toHaveURL(/\/login\?next=%2Fcompanies/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, '01-login');
  });

  test('shows a privacy-preserving error for bad credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Work email').fill('nobody@example.com');
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(formAlert(page)).toContainText('The email or password is incorrect');
    await shot(page, '02-login-error');
  });

  test('validates the form before submitting', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
  });

  test('sign out ends the session', async ({ page }) => {
    await signIn(page, USERS.groupAdmin);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('platform administrator', () => {
  test.use(as('platform'));

  test('dashboard shows real counts for all tenants', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Showing all tenants on the platform')).toBeVisible();
    const stats = page.locator('dl').first();
    await expect(stats.getByText('Tenants', { exact: true })).toBeVisible();
    await expect(stats.getByText('Companies', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recently added companies' })).toBeVisible();
    await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Recently added companies' }) }).locator('tbody tr').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, '03-dashboard-platform');
  });

  test('sees tenants and every company', async ({ page }) => {
    await page.goto('/dashboard');
    await nav(page).getByRole('link', { name: 'Tenants' }).click();
    await expect(page).toHaveURL(/\/tenants$/);
    await expect(page.getByText('meghna-group', { exact: true })).toBeVisible();
    await expect(page.getByText('padma-industries', { exact: true })).toBeVisible();
    await shot(page, '04-tenants');
    await nav(page).getByRole('link', { name: 'Companies' }).click();
    await expect(page).toHaveURL(/\/companies$/);
    await expect(page.getByRole('link', { name: 'Meghna Cement Mills PLC' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Padma Pharmaceuticals PLC' })).toBeVisible();
    await shot(page, '05-companies');
  });

  test('creates a company through the dialog', async ({ page }) => {
    const suffix = Date.now().toString(36);
    await page.goto('/companies');
    await page.getByRole('button', { name: 'New company' }).click();
    const dialog = page.getByRole('dialog', { name: 'New company' });
    await expect(dialog).toBeVisible();
    await shot(page, '06-new-company-dialog');
    await dialog.getByLabel('Tenant').selectOption({ label: 'Padma Industries' });
    await dialog.getByLabel('Legal name').fill(`Padma Agro ${suffix} Limited`);
    await dialog.getByLabel('Short name').fill(`Padma Agro ${suffix}`);
    await expect(dialog.getByLabel('URL name')).toHaveValue(`padma-agro-${suffix}-limited`);
    await dialog.getByLabel('Company type').selectOption('PRIVATE');
    await dialog.getByRole('button', { name: 'Create company' }).click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: `Padma Agro ${suffix} Limited` })).toBeVisible();
    await shot(page, '07-company-detail');
  });

  test('roles page renders the permission matrix', async ({ page }) => {
    await page.goto('/roles');
    await expect(page.getByRole('heading', { name: 'Permission matrix' })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /Cast a ballot/ })).toBeVisible();
    await shot(page, '08-roles');
  });

  test('audit log lists sign-ins', async ({ page }) => {
    await page.goto('/dashboard');
    await nav(page).getByRole('link', { name: 'Audit log' }).click();
    await expect(page).toHaveURL(/\/audit$/);
    await page.getByLabel('Filter events').selectOption('auth.');
    await expect(page.getByRole('cell', { name: 'Sign-in' }).first()).toBeVisible();
    await shot(page, '09-audit');
  });
});

test.describe('company admin isolation', () => {
  test.use(as('padmaAdmin'));

  test('only sees their own company and no tenant admin', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(nav(page).getByRole('link', { name: 'Tenants' })).toHaveCount(0);
    await nav(page).getByRole('link', { name: 'Companies' }).click();
    await expect(page.getByRole('link', { name: 'Padma Pharmaceuticals PLC' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Meghna Cement Mills PLC' })).toHaveCount(0);
    await shot(page, '10-companies-company-admin');
  });

  test('direct link to another tenant company shows not found', async ({ page, browser }) => {
    const platform = await browser.newContext(as('platform'));
    const res = await platform.request.get('/api/v1/companies?q=Meghna%20Cement');
    const id = (await res.json()).items[0].id as string;
    await platform.close();

    await page.goto(`/companies/${id}`);
    await expect(page.getByText('Company not found')).toBeVisible();
    await shot(page, '11-cross-tenant-not-found');
  });
});

test.describe('other roles', () => {
  test('moderator sees no administration areas', async ({ browser }) => {
    const ctx = await browser.newContext(as('moderator'));
    const page = await ctx.newPage();
    await page.goto('/dashboard');
    await expect(nav(page).getByRole('link', { name: 'Overview' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Users' })).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Tenants' })).toHaveCount(0);
    await ctx.close();
  });

  test('company admin sees members and the roles they may grant', async ({ browser }) => {
    const ctx = await browser.newContext(as('meghnaAdmin'));
    const page = await ctx.newPage();
    await page.goto('/companies');
    await page.getByRole('link', { name: 'Meghna Cement Mills PLC' }).click();
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await expect(page.getByText('meeting.admin@meghnacement.example')).toBeVisible();
    await page.getByRole('button', { name: 'Add member' }).click();
    const role = page.getByRole('dialog').getByLabel('Role');
    await expect(role.locator('option')).toHaveText(['Company Admin', 'Meeting Admin', 'Board Member', 'Moderator', 'Company Official']);
    await shot(page, '12-add-member');
    await ctx.close();
  });
});

test.describe('responsive layout @mobile', () => {
  test('sign-in page fits a phone screen @mobile', async ({ page }) => {
    await page.goto('/login');
    await expectNoHorizontalOverflow(page);
    await shot(page, 'm01-login');
  });

  test.describe('signed in @mobile', () => {
    test.use(as('platform'));

    test('dashboard has no horizontal overflow @mobile', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByText('Showing all tenants on the platform')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await shot(page, 'm02-dashboard');
    });

    test('navigation drawer opens and navigates @mobile', async ({ page }) => {
      await page.goto('/dashboard');
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.getByRole('dialog').getByRole('link', { name: 'Companies' }).click();
      await expect(page).toHaveURL(/\/companies$/);
      await expect(page.getByRole('link', { name: 'Meghna Cement Mills PLC' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await shot(page, 'm03-companies');
    });

    test('roles matrix scrolls inside its panel, not the page @mobile', async ({ page }) => {
      await page.goto('/roles');
      await expect(page.getByRole('heading', { name: 'Permission matrix' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
});
