'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Strikethrough, List, ListOrdered, Heading2 } from 'lucide-react';
import { useEffect } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const MenuBar = ({ editor }: { editor: any }) => {
  if (!editor) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 rounded-t-xl">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={`p-1.5 rounded-lg transition-colors ${editor.isActive('bold') ? 'bg-[#E5E7EB] text-[#111827]' : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]'}`}
      >
        <Bold className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={`p-1.5 rounded-lg transition-colors ${editor.isActive('italic') ? 'bg-[#E5E7EB] text-[#111827]' : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]'}`}
      >
        <Italic className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().chain().focus().toggleStrike().run()}
        className={`p-1.5 rounded-lg transition-colors ${editor.isActive('strike') ? 'bg-[#E5E7EB] text-[#111827]' : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]'}`}
      >
        <Strikethrough className="h-4 w-4" />
      </button>
      
      <div className="w-px h-4 bg-[#E5E7EB] mx-1" />

      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={`p-1.5 rounded-lg transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-[#E5E7EB] text-[#111827]' : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]'}`}
      >
        <Heading2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`p-1.5 rounded-lg transition-colors ${editor.isActive('bulletList') ? 'bg-[#E5E7EB] text-[#111827]' : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]'}`}
      >
        <List className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`p-1.5 rounded-lg transition-colors ${editor.isActive('orderedList') ? 'bg-[#E5E7EB] text-[#111827]' : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]'}`}
      >
        <ListOrdered className="h-4 w-4" />
      </button>
    </div>
  );
};

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [2, 3],
        },
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose prose-sm prose-slate max-w-none focus:outline-none min-h-[120px] px-4 py-3',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Update content if value changes externally (e.g. when editing a different task)
  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    if (value === currentHtml) return;
    if (!value && currentHtml === '<p></p>') return;
    
    editor.commands.setContent(value || '');
  }, [value, editor]);

  return (
    <div className="w-full rounded-xl border border-[#E5E7EB] bg-white overflow-hidden focus-within:border-[#111827] transition-all">
      <MenuBar editor={editor} />
      <EditorContent editor={editor} />
      
      <style dangerouslySetInnerHTML={{__html: `
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #9CA3AF;
          pointer-events: none;
          height: 0;
        }
        .ProseMirror p {
          margin-top: 0.5em;
          margin-bottom: 0.5em;
        }
        .ProseMirror ul {
          list-style-type: disc;
          padding-left: 1.5em;
          margin-top: 0.5em;
          margin-bottom: 0.5em;
        }
        .ProseMirror ol {
          list-style-type: decimal;
          padding-left: 1.5em;
          margin-top: 0.5em;
          margin-bottom: 0.5em;
        }
        .ProseMirror h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 1em;
          margin-bottom: 0.5em;
          color: #111827;
        }
      `}} />
    </div>
  );
}
