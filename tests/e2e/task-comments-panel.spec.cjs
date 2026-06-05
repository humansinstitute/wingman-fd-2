const { test, expect } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function taskPanelFixture() {
  const css = readProjectFile('src/styles.css');
  return `<!doctype html>
    <html>
      <head>
        <style>${css}</style>
      </head>
      <body>
        <main class="app-shell">
          <section class="task-detail-panel">
            <div class="task-detail-body">
              <div class="task-detail-main">
                <h1 class="task-detail-title-display">Task detail</h1>
                <p>Primary task content.</p>
              </div>
              <div id="task-comments-panel" class="task-comments-section">
                <div class="task-comments-header">
                  <div class="task-comments-header-copy">
                    <label class="task-field-label">Activity</label>
                    <span>7 comments</span>
                  </div>
                  <button class="thread-resize-btn task-comments-resize-btn" type="button" aria-pressed="false">Resize</button>
                </div>
              </div>
            </div>
          </section>
        </main>
        <script>
          const body = document.querySelector('.task-detail-body');
          const resizeButton = document.querySelector('.task-comments-resize-btn');
          resizeButton.addEventListener('click', () => {
            body.classList.toggle('task-detail-body-comments-expanded');
            resizeButton.setAttribute('aria-pressed', body.classList.contains('task-detail-body-comments-expanded') ? 'true' : 'false');
          });
        </script>
      </body>
    </html>`;
}

async function panelMetrics(page) {
  return page.evaluate(() => {
    const body = document.querySelector('.task-detail-body').getBoundingClientRect();
    const main = document.querySelector('.task-detail-main').getBoundingClientRect();
    const comments = document.querySelector('.task-comments-section').getBoundingClientRect();
    return {
      bodyWidth: body.width,
      mainWidth: main.width,
      commentsWidth: comments.width,
      commentsShare: comments.width / (main.width + comments.width),
    };
  });
}

test('task activity resize control expands comments to about sixty percent on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.setContent(taskPanelFixture());

  const normal = await panelMetrics(page);
  expect(normal.commentsWidth).toBeLessThanOrEqual(410);
  await expect(page.locator('.task-comments-panel-rail')).toHaveCount(0);

  await page.locator('.task-comments-resize-btn').click();
  await page.waitForTimeout(250);

  const expanded = await panelMetrics(page);
  await expect(page.locator('.task-comments-resize-btn')).toHaveAttribute('aria-pressed', 'true');
  expect(expanded.commentsWidth).toBeGreaterThan(normal.commentsWidth);
  expect(expanded.commentsShare).toBeGreaterThan(0.58);
  expect(expanded.commentsShare).toBeLessThan(0.62);

  await page.locator('.task-comments-resize-btn').click();
  await page.waitForTimeout(250);
  await expect(page.locator('.task-comments-resize-btn')).toHaveAttribute('aria-pressed', 'false');
  const collapsed = await panelMetrics(page);
  expect(collapsed.commentsWidth).toBeCloseTo(normal.commentsWidth, 1);
});

test('task comments layout stays single column on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.setContent(taskPanelFixture());
  await page.locator('.task-comments-resize-btn').click();

  const gridColumns = await page.locator('.task-detail-body').evaluate((node) => getComputedStyle(node).gridTemplateColumns);

  expect(gridColumns.split(' ')).toHaveLength(1);
});
