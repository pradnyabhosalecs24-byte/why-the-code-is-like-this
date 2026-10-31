// Brief §8.E — UI and end-to-end flows against the running app in local demo mode.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Local demo mode')).toBeVisible();
});

test('synthetic repository is labelled and the overview dashboard loads', async ({ page }) => {
  await expect(page.getByText('Synthetic demonstration data.')).toBeVisible();
  await expect(page.locator('.count').first()).toBeVisible();
  await expect(page.getByText('Recent decisions')).toBeVisible();
});

test('ask a question, see cited facts, open an evidence link', async ({ page, context }) => {
  await page.getByRole('tab', { name: 'Ask' }).click();
  await page.getByLabel('Question').fill('Why is MAX_RETRIES 3?');
  await page.getByRole('button', { name: 'Trace' }).click();
  await expect(page.locator('.headline')).toContainText('MAX_RETRIES');
  await expect(page.locator('.badge-fact').first()).toBeVisible();
  await expect(page.getByLabel(/Reasoning chain/)).toBeVisible();
  const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('#ev-E1').getByRole('link', { name: /open/ }).click()]);
  await expect(popup.getByText('SYNTHETIC DEMO RECORD.')).toBeVisible();
});

test('question without evidence gets an explicit insufficient-evidence answer', async ({ page }) => {
  await page.getByRole('tab', { name: 'Ask' }).click();
  await page.getByLabel('Question').fill('Why was legacyCsvExport not migrated?');
  await page.getByRole('button', { name: 'Trace' }).click();
  await expect(page.getByText('No established reason')).toBeVisible();
  await expect(page.locator('.conf-level')).toHaveText(/insufficient/i);
});

test('inspect the knowledge graph from an answer', async ({ page }) => {
  await page.getByRole('tab', { name: 'Ask' }).click();
  await page.getByLabel('Question').fill('Has the SESSION_TTL_MINUTES decision been superseded?');
  await page.getByRole('button', { name: 'Trace' }).click();
  await page.getByRole('button', { name: /Inspect supporting graph/ }).click();
  const node = page.locator('svg.graph .gnode').first();
  await expect(node).toBeVisible();
  await node.dispatchEvent('pointerdown');
  await expect(page.locator('.inspector dl.detail')).toBeVisible();
});

test('view a superseded decision and what replaced it', async ({ page }) => {
  await page.getByRole('tab', { name: 'Decisions' }).click();
  await page.getByRole('button', { name: /^superseded/ }).click();
  await expect(page.locator('.decision .supersede').first()).toContainText('superseded by');
});

test('ingestion failure is reported for an invalid repository URL', async ({ page }) => {
  await page.getByPlaceholder('https://github.com/owner/repo').fill('not-a-repo');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('.notice-danger')).toContainText(/valid|Expected/);
});

test('responsive layout has no horizontal scroll @responsive', async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: 'Ask' }).click();
  await expect(page.getByLabel('Question')).toBeVisible();
});
