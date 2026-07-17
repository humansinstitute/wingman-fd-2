function createToolbarButton(label, command, text = label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'daily-note-tiptap-toolbar-button';
  button.textContent = text;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', () => command());
  return button;
}

function syncToggle(button, active) {
  button.classList.toggle('is-active', Boolean(active));
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
}

export function createDailyNoteTiptapToolbar(editor) {
  const toolbar = document.createElement('div');
  toolbar.className = 'daily-note-tiptap-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Daily note formatting toolbar');

  const buttons = [
    createToolbarButton('Bold', () => editor.chain().focus().toggleBold().run(), 'B'),
    createToolbarButton('Italic', () => editor.chain().focus().toggleItalic().run(), 'I'),
    createToolbarButton('Inline code', () => editor.chain().focus().toggleCode().run(), '</>'),
    createToolbarButton('Heading', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'H2'),
    createToolbarButton('Bullet list', () => editor.chain().focus().toggleBulletList().run(), 'UL'),
    createToolbarButton('Ordered list', () => editor.chain().focus().toggleOrderedList().run(), 'OL'),
    createToolbarButton('Task list', () => editor.chain().focus().toggleTaskList().run(), '[ ]'),
    createToolbarButton('Blockquote', () => editor.chain().focus().toggleBlockquote().run(), '>'),
    createToolbarButton('Code block', () => editor.chain().focus().toggleCodeBlock().run(), '{}'),
    createToolbarButton('Undo', () => editor.chain().focus().undo().run(), 'Undo'),
    createToolbarButton('Redo', () => editor.chain().focus().redo().run(), 'Redo'),
  ];

  const linkButton = createToolbarButton('Add or edit link', () => {
    const previousUrl = editor.getAttributes('link').href || '';
    const url = window.prompt('Link URL', previousUrl);
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }, 'Link');
  buttons.push(linkButton);
  buttons.forEach((button) => toolbar.append(button));

  const refreshActiveState = () => {
    syncToggle(buttons[0], editor.isActive('bold'));
    syncToggle(buttons[1], editor.isActive('italic'));
    syncToggle(buttons[2], editor.isActive('code'));
    syncToggle(buttons[3], editor.isActive('heading', { level: 2 }));
    syncToggle(buttons[4], editor.isActive('bulletList'));
    syncToggle(buttons[5], editor.isActive('orderedList'));
    syncToggle(buttons[6], editor.isActive('taskList'));
    syncToggle(buttons[7], editor.isActive('blockquote'));
    syncToggle(buttons[8], editor.isActive('codeBlock'));
    syncToggle(linkButton, editor.isActive('link'));
  };
  editor.on('selectionUpdate', refreshActiveState);
  editor.on('transaction', refreshActiveState);
  refreshActiveState();

  return {
    element: toolbar,
    destroy() {
      editor.off('selectionUpdate', refreshActiveState);
      editor.off('transaction', refreshActiveState);
      toolbar.remove();
    },
  };
}
