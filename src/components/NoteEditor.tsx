import { useEffect, useRef } from 'react';
import { Editor, EditorContent, useEditor } from '@tiptap/react';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

const NOTE_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    hardBreak: false,
    underline: false,
  }),
  TaskList,
  TaskItem,
  Markdown,
];

export interface NoteEditorProps {
  /** Identity of the document being edited, not the current text. */
  docKey: string;
  /** Markdown used to seed the uncontrolled editor. */
  value: string;
  onChange: (markdown: string) => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
}

/** Parse and serialize markdown without mounting a React editor. */
export function roundTrip(markdown: string): string {
  const editor = new Editor({
    extensions: NOTE_EXTENSIONS,
    content: markdown,
    contentType: 'markdown',
  });

  try {
    return editor.getMarkdown();
  } finally {
    editor.destroy();
  }
}

export function NoteEditor({
  docKey,
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
}: NoteEditorProps) {
  const initialValue = useRef(value);
  const previousDocKey = useRef(docKey);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: NOTE_EXTENSIONS,
    content: initialValue.current,
    contentType: 'markdown',
    immediatelyRender: true,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        'data-placeholder': placeholder,
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChangeRef.current(currentEditor.getMarkdown());
    },
  });

  useEffect(() => {
    if (!editor || previousDocKey.current === docKey) return;

    previousDocKey.current = docKey;
    editor.commands.setContent(value, {
      contentType: 'markdown',
      emitUpdate: false,
    });
  }, [docKey, editor, value]);

  return (
    <EditorContent
      editor={editor}
      data-empty={editor?.isEmpty ? 'true' : undefined}
      data-placeholder={placeholder}
      className={`note-prose ${className ?? ''}`}
    />
  );
}
