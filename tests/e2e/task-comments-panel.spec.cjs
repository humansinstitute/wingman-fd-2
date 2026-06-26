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
          <section class="tasks-section chat-task-inline-section">
          <div class="task-detail-panel">
            <div class="task-detail-body">
              <div class="task-detail-main">
                <h1 class="task-detail-title-display">Task detail</h1>
                <div class="task-desc-preview chat-post-markdown">
                  <p>${'A long task description '.repeat(48)}</p>
                  <p>https://example.test/${'unbroken-description-token'.repeat(12)}</p>
                </div>
              </div>
              <div id="task-comments-panel" class="task-comments-section">
                <div class="task-comments-header">
                  <div class="task-comments-header-copy">
                    <label class="task-field-label">Activity</label>
                    <span>7 comments</span>
                  </div>
                  <button class="thread-resize-btn task-comments-fullscreen-btn" type="button" aria-label="Open activity fullscreen">Open</button>
                </div>
                <div class="task-comments-list">
                  <div class="task-comment-row">
                    <div class="task-comment-header">
                      <span class="task-comment-sender">Implementation worker with a long display name</span>
                      <span class="task-comment-time">just now</span>
                    </div>
                    <div class="task-comment-body task-comment-body-collapsed">
                      <p>${'A long task comment body '.repeat(56)}</p>
                      <pre><code>${'unbroken-code-fragment'.repeat(18)}</code></pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="task-comments-fullscreen-backdrop" style="display: none;">
              <section class="task-comments-fullscreen-modal" role="dialog" aria-modal="true">
                <header class="task-comments-fullscreen-header">
                  <div>
                    <h2>Activity</h2>
                    <span>7 comments</span>
                  </div>
                  <button type="button" class="task-comments-fullscreen-close" aria-label="Close activity fullscreen">&times;</button>
                </header>
                <div class="task-comments-fullscreen-list">
                  <article class="task-comment-row task-comment-fullscreen-row">
                    <div class="task-comment-header">
                      <span class="task-comment-sender">Implementation worker with a long display name</span>
                      <span class="task-comment-time">just now</span>
                    </div>
                    <div class="task-comment-body task-comment-fullscreen-body">
                      <p>${'A long task comment body '.repeat(56)}</p>
                      <pre><code>${'unbroken-code-fragment'.repeat(18)}</code></pre>
                    </div>
                  </article>
                </div>
              </section>
            </div>
          </div>
          </section>
        </main>
        <script>
          const backdrop = document.querySelector('.task-comments-fullscreen-backdrop');
          document.querySelector('.task-comments-fullscreen-btn').addEventListener('click', () => {
            backdrop.style.display = 'flex';
          });
          document.querySelector('.task-comments-fullscreen-close').addEventListener('click', () => {
            backdrop.style.display = 'none';
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

test('task activity header exposes only the fullscreen comment reader control', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.setContent(taskPanelFixture());

  const normal = await panelMetrics(page);
  expect(normal.commentsShare).toBeGreaterThan(0.38);
  expect(normal.commentsShare).toBeLessThan(0.42);
  await expect(page.locator('.task-comments-panel-rail')).toHaveCount(0);
  await expect(page.locator('.task-comments-resize-btn')).toHaveCount(0);
  await expect(page.locator('.task-comments-fullscreen-btn')).toHaveCount(1);

  await page.locator('.task-comments-fullscreen-btn').click();
  await expect(page.locator('.task-comments-fullscreen-backdrop')).toBeVisible();
  await expect(page.locator('.task-comment-fullscreen-body')).toBeVisible();

  await page.locator('.task-comments-fullscreen-close').click();
  await expect(page.locator('.task-comments-fullscreen-backdrop')).toBeHidden();
});

test('task comments layout stays single column on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.setContent(taskPanelFixture());

  const gridColumns = await page.locator('.task-detail-body').evaluate((node) => getComputedStyle(node).gridTemplateColumns);

  expect(gridColumns.split(' ')).toHaveLength(1);
});

test('long task descriptions and comments stay within their panels', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 820 });
  await page.setContent(taskPanelFixture());

  const metrics = await page.evaluate(() => {
    const body = document.querySelector('.task-detail-body').getBoundingClientRect();
    const main = document.querySelector('.task-detail-main').getBoundingClientRect();
    const comments = document.querySelector('.task-comments-section').getBoundingClientRect();
    const description = document.querySelector('.task-desc-preview').getBoundingClientRect();
    const comment = document.querySelector('.task-comment-body').getBoundingClientRect();
    const code = document.querySelector('.task-comment-body pre').getBoundingClientRect();
    return {
      bodyRight: body.right,
      mainRight: main.right,
      commentsLeft: comments.left,
      commentsRight: comments.right,
      descriptionRight: description.right,
      commentRight: comment.right,
      codeRight: code.right,
      descriptionScrollWidth: document.querySelector('.task-desc-preview').scrollWidth,
      descriptionClientWidth: document.querySelector('.task-desc-preview').clientWidth,
      commentScrollWidth: document.querySelector('.task-comment-body').scrollWidth,
      commentClientWidth: document.querySelector('.task-comment-body').clientWidth,
    };
  });

  expect(metrics.mainRight).toBeLessThanOrEqual(metrics.commentsLeft);
  expect(metrics.descriptionRight).toBeLessThanOrEqual(metrics.mainRight + 1);
  expect(metrics.commentRight).toBeLessThanOrEqual(metrics.commentsRight + 1);
  expect(metrics.codeRight).toBeLessThanOrEqual(metrics.commentsRight + 1);
  expect(metrics.descriptionScrollWidth).toBeLessThanOrEqual(metrics.descriptionClientWidth + 1);
  expect(metrics.commentScrollWidth).toBeLessThanOrEqual(metrics.commentClientWidth + 1);
});
