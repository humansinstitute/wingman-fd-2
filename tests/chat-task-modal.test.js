import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readProjectFile(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('chat task modal wiring', () => {
  it('renders task detail as a same-app overlay with backdrop and full-page action', () => {
    const html = readProjectFile('index.html');
    const css = readProjectFile('src/styles.css');

    expect(html).toContain("navSection === 'tasks' || $store.chat.chatTaskModalOpen");
    expect(html).toContain('chat-task-page-backdrop');
    expect(html).toContain('chat-task-inline-section');
    expect(html).toContain('chat-task-modal-fullscreen');
    expect(html).toContain('$store.chat.toggleChatTaskModalFullScreen()');
    expect(html).toContain('$store.chat.closeChatTaskModal()');
    expect(html).toContain('$store.chat.openChatTaskFullPage()');
    expect(html).toContain('Open full page');
    expect(css).toContain('.chat-task-page-backdrop');
    expect(css).toContain('backdrop-filter: blur(10px)');
    expect(css).toContain('.tasks-section.chat-task-inline-section');
    expect(css).toContain('.tasks-section.chat-task-inline-section.chat-task-modal-fullscreen');
    expect(css).toContain('width: min(88vw, 1120px)');
  });

  it('routes task mentions and same-origin task links from chat into the modal', () => {
    const source = readProjectFile('src/app.js');

    expect(source).toMatch(/if \(this\.navSection === 'chat'\) \{\s*this\.openChatTaskModal\(id\);/);
    expect(source).toContain("route?.section === 'tasks'");
    expect(source).toContain('this.openChatTaskModal(route.params.taskid');
    expect(source).toContain('openTaskDetail(recordId, { syncRoute: false })');
  });

  it('hydrates the selected task before showing the modal on first open', () => {
    const source = readProjectFile('src/app.js');
    const start = source.indexOf('async openChatTaskModal(taskId, options = {})');
    const end = source.indexOf('async closeChatTaskModal()', start);
    const method = source.slice(start, end);

    expect(method).toContain('await this.applyTasks([');
    expect(method.indexOf('this.openTaskDetail(recordId, { syncRoute: false })'))
      .toBeLessThan(method.indexOf('this.chatTaskModalOpen = true'));
  });

  it('resets chat task fullscreen state across modal lifecycle', () => {
    const source = readProjectFile('src/app.js');
    const start = source.indexOf('async openChatTaskModal(taskId, options = {})');
    const end = source.indexOf('openChatTaskFullPage()', start);
    const methods = source.slice(start, end);

    expect(methods).toContain('this.chatTaskModalFullScreen = false');
    expect(methods).toContain('toggleChatTaskModalFullScreen()');
    expect(methods).toContain('this.chatTaskModalFullScreen = !this.chatTaskModalFullScreen');
  });
});
