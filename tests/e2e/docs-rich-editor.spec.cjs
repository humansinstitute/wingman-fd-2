const { test, expect } = require('playwright/test');

async function seedSelectedDocument(page) {
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let index = 0; index < 100; index += 1) {
      if (window.Alpine?.store?.('chat')) break;
      await wait(50);
    }

    const store = window.Alpine?.store?.('chat');
    if (!store) throw new Error('Alpine chat store did not initialize.');

    const now = new Date().toISOString();
    const document = {
      record_id: 'doc-rich-default',
      owner_npub: 'npub1docsrichtest',
      title: 'Tip Tap Test',
      content: 'This should open in Tiptap by default.',
      content_blocks: [{
        id: 'block-1',
        type: 'markdown',
        raw: 'This should open in Tiptap by default.',
        text: 'This should open in Tiptap by default.',
        attrs: {},
        start_line: 1,
      }],
      content_model: null,
      version: 1,
      sync_status: 'synced',
      record_state: 'active',
      created_at: now,
      updated_at: now,
      shares: [],
      group_ids: [],
    };

    store.session = { ...(store.session || {}), npub: 'npub1docsrichtest' };
    store.navSection = 'docs';
    store.documents = [document];
    store.directories = [];
    store.currentFolderId = null;
    store.docComments = [];
    store.selectedDocId = document.record_id;
    store.selectedDocType = 'document';
    store.loadDocEditorFromSelection();

    store.acquireSelectedDocCheckout = async () => true;
    store.getSelectedDocCheckoutSession = () => ({
      checkout: {
        state: 'checked_out',
        holder_npub: 'npub1docsrichtest',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const entered = await store.enterSelectedDocEditMode();
    if (!entered) throw new Error('Document edit mode did not open.');
  });
}

test('default document edit mode mounts the native Tiptap editor', async ({ page }) => {
  await page.goto('/');

  await seedSelectedDocument(page);

  await expect(page.locator('.docs-editor-v3')).toBeVisible();
  await expect(page.locator('.doc-title-display')).toHaveText('Tip Tap Test');
  await expect(page.locator('.doc-rich-editor .ProseMirror')).toBeVisible();
  await expect(page.locator('.doc-rich-editor .ProseMirror')).toContainText('This should open in Tiptap by default.');
  await expect(page.locator('.doc-block-editor:visible')).toHaveCount(0);

  const editorMetrics = await page.locator('.doc-rich-editor .ProseMirror').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      text: node.textContent || '',
    };
  });

  expect(editorMetrics.width).toBeGreaterThan(300);
  expect(editorMetrics.height).toBeGreaterThan(120);
  expect(editorMetrics.text).toContain('This should open in Tiptap by default.');
});
