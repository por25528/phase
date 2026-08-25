import { useEffect, useRef, useState } from 'react';
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
import type { EditorView } from 'prosemirror-view';
import { actions } from '../state/store';
import { useAssetUrl } from './useAssetUrl';

function AssetImageView({ node }: NodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : null;
  const isAsset = src?.startsWith('asset:') ?? false;
  const assetId = isAsset ? src?.slice('asset:'.length) ?? '' : null;
  const { url, missing } = useAssetUrl(assetId);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  const imageSrc = url ?? (src && !isAsset ? src : null);
  const imageFailed = imageSrc !== null && failedSrc === imageSrc;

  return (
    <NodeViewWrapper className="note-image" data-asset-id={assetId ?? undefined}>
      {missing || imageFailed ? (
        <span className="note-image-missing" role="img" aria-label="Image unavailable">
          Image unavailable
        </span>
      ) : imageSrc ? (
        <img src={imageSrc} alt={alt} onError={() => setFailedSrc(imageSrc)} />
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

const RAW_HTML_TAG = /(?<!\\)<(?=\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*)?\/?\s*>)/g;

function literalizeRawHtml(markdown: string): string {
  return markdown.replace(RAW_HTML_TAG, '\\<');
}

export function insertPastedAsset(view: EditorView, id: string) {
  if (view.isDestroyed) return;
  const image = view.state.schema.nodes.image.create({ src: `asset:${id}` });
  const { from, to } = view.state.selection;
  view.dispatch(view.state.tr.replaceRangeWith(from, to, image));
}

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
    content: literalizeRawHtml(markdown),
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
    content: literalizeRawHtml(initialValue.current),
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
        void actions.addAsset(file).then((id) => {
          insertPastedAsset(view, id);
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
    editor.commands.setContent(literalizeRawHtml(value), {
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
