import { useEffect, useRef } from 'react';
import {
  Editor,
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from '@tiptap/react';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { actions } from '../state/store';
import { useAssetUrl } from './useAssetUrl';

function AssetImageView({ node }: NodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : null;
  const isAsset = src?.startsWith('asset:') ?? false;
  const assetId = isAsset ? src?.slice('asset:'.length) ?? '' : null;
  const { url, missing } = useAssetUrl(assetId);
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';

  return (
    <NodeViewWrapper className="note-image" data-asset-id={assetId ?? undefined}>
      {missing ? (
        <span className="note-image-missing" role="img" aria-label="Image unavailable">
          Image unavailable
        </span>
      ) : url || (src && !isAsset) ? (
        <img src={url ?? src ?? undefined} alt={alt} />
      ) : (
        <span className="note-image-missing" role="img" aria-label="Loading image">
          Loading image...
        </span>
      )}
    </NodeViewWrapper>
  );
}

const NOTE_IMAGE = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(AssetImageView);
  },
}).configure({
  inline: false,
  allowBase64: false,
});

const NOTE_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    hardBreak: false,
    underline: false,
  }),
  TaskList,
  TaskItem,
  NOTE_IMAGE,
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
      handlePaste: (view, event) => {
        const item = Array.from(event.clipboardData?.items ?? [])
          .find((clipboardItem) => clipboardItem.type.startsWith('image/'));
        const file = item?.getAsFile();
        if (!file) return false;

        event.preventDefault();
        const { from, to } = view.state.selection;
        void actions.addAsset(file).then((id) => {
          if (view.isDestroyed) return;
          const image = view.state.schema.nodes.image.create({ src: `asset:${id}` });
          view.dispatch(view.state.tr.replaceRangeWith(from, to, image));
        }).catch(() => {
          // The store owns persistence errors and its recovery banner.
        });
        return true;
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
