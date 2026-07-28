import { useEffect, type ReactNode } from 'react'
import { X, Globe, ExternalLink, Music } from 'lucide-react'
import { ImageWithFallback } from './figma/ImageWithFallback'
import { KIND_META, type Material } from './materials'

/**
 * 材料视图 —— 只读全屏查看。
 *
 * 「纸落画布」的视觉隐喻：安静的画布 + 顶部一条薄边框 chrome + Esc 退出。
 * 只负责「怎么看」，不含任何 agent 交互或编辑。文字统一走
 * reading-prose(阅读字体) 与 var(--reading-width)(阅读栏宽)，与对话流、
 * 专注模式共用同一套阅读偏好。
 */

interface MaterialViewProps {
  material: Material
  onClose: () => void
}

export function MaterialView({ material, onClose }: MaterialViewProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const kind = KIND_META[material.kind]

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'var(--aa-canvas, #f7f5f2)' }}
    >
      {/* 顶部 chrome */}
      <header
        className="shrink-0 flex items-center gap-3 px-5"
        style={{
          height: 48,
          borderBottom: '1px solid var(--aa-border, rgba(45,40,34,0.09))',
          background: 'var(--aa-canvas, #f7f5f2)',
        }}
      >
        <span
          className="w-2.5 h-2.5 rounded-sm shrink-0"
          style={{ background: kind.color }}
        />
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm truncate" style={{ color: 'var(--aa-text-1, #292722)' }}>
            {material.title}
          </span>
          {material.meta && (
            <span className="text-xs shrink-0" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
              {material.meta}
            </span>
          )}
        </div>

        <span
          className="text-xs px-2 py-0.5 rounded shrink-0"
          style={{
            background: 'var(--aa-surface-hover, #eeebe6)',
            color: 'var(--aa-text-2, #87827c)',
          }}
        >
          {material.origin === 'library' ? '引用自资料库' : '空间内产出'}
        </span>

        <div className="flex-1" />

        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-black/5"
          style={{ color: 'var(--aa-text-2, #87827c)' }}
        >
          <X size={13} />
          关闭
          <span className="text-[10px] opacity-60">Esc</span>
        </button>
      </header>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        <MaterialBody material={material} />
      </div>
    </div>
  )
}

export function MaterialBody({ material }: { material: Material }) {
  switch (material.kind) {
    case 'markdown':
      return <MarkdownBody source={material.markdown ?? ''} />
    case 'pdf':
      return <PdfBody pages={material.pdf?.pages ?? []} />
    case 'web':
      return <WebBody web={material.web!} title={material.title} />
    case 'image':
      return <ImageBody image={material.image!} />
    case 'video':
      return <VideoBody video={material.video!} title={material.title} />
    case 'audio':
      return <AudioBody audio={material.audio!} title={material.title} />
    case 'code':
      return <CodeBody code={material.code!} />
    default:
      return (
        <div className="mx-auto py-16 text-center text-sm" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
          暂不支持预览此类型
        </div>
      )
  }
}

/* ------------------------------- Markdown ------------------------------- */

function MarkdownBody({ source }: { source: string }) {
  return (
    <div
      className="mx-auto px-6 py-12 reading-prose"
      style={{ maxWidth: 'var(--reading-width, 680px)' }}
    >
      {renderMarkdown(source)}
    </div>
  )
}

/** 极简 Markdown 渲染：标题 / 粗体 / 无序列表 / 段落。 */
export function renderMarkdown(src: string) {
  const lines = src.split('\n')
  const blocks: ReactNode[] = []
  let list: string[] = []

  const flushList = (key: string) => {
    if (list.length === 0) return
    blocks.push(
      <ul key={key} className="my-3 space-y-1.5 pl-5" style={{ listStyle: 'disc' }}>
        {list.map((li, i) => (
          <li key={i} className="text-sm leading-relaxed" style={{ color: 'var(--aa-text-1, #292722)' }}>
            {renderInline(li)}
          </li>
        ))}
      </ul>
    )
    list = []
  }

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    if (line.startsWith('- ')) {
      list.push(line.slice(2))
      return
    }
    flushList(`ul-${idx}`)
    if (line.startsWith('## ')) {
      blocks.push(
        <h2 key={idx} className="mt-8 mb-3 text-base font-semibold" style={{ color: 'var(--aa-text-1, #292722)' }}>
          {renderInline(line.slice(3))}
        </h2>
      )
    } else if (line.startsWith('# ')) {
      blocks.push(
        <h1 key={idx} className="mb-4 text-xl font-semibold" style={{ color: 'var(--aa-text-1, #292722)' }}>
          {renderInline(line.slice(2))}
        </h1>
      )
    } else if (line.trim() === '') {
      // 空行 —— 跳过，段落间距由 margin 处理
    } else {
      blocks.push(
        <p key={idx} className="my-3 text-sm leading-relaxed" style={{ color: 'var(--aa-text-1, #292722)' }}>
          {renderInline(line)}
        </p>
      )
    }
  })
  flushList('ul-end')
  return blocks
}

/** 处理行内 **粗体**。 */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <strong key={i} style={{ fontWeight: 600 }}>
          {p.slice(2, -2)}
        </strong>
      )
    }
    return <span key={i}>{p}</span>
  })
}

/* --------------------------------- PDF ---------------------------------- */

function PdfBody({ pages }: { pages: string[] }) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 px-4">
      {pages.map((page, i) => (
        <div
          key={i}
          className="w-full relative"
          style={{
            maxWidth: 720,
            background: '#ffffff',
            border: '1px solid var(--aa-border, rgba(45,40,34,0.09))',
            borderRadius: 4,
            boxShadow: '0 1px 8px rgba(45,40,34,0.06)',
            padding: '56px 64px',
            minHeight: 480,
          }}
        >
          <pre
            className="whitespace-pre-wrap reading-prose text-sm leading-relaxed m-0"
            style={{ color: 'var(--aa-text-1, #292722)', fontFamily: 'var(--reading-font)' }}
          >
            {page}
          </pre>
          <span
            className="absolute text-xs"
            style={{ bottom: 20, right: 24, color: 'var(--aa-text-3, #aba39b)' }}
          >
            {i + 1} / {pages.length}
          </span>
        </div>
      ))}
    </div>
  )
}

/* --------------------------------- Web ---------------------------------- */

function WebBody({ web, title }: { web: { url: string; site: string; body: string }; title: string }) {
  return (
    <div className="mx-auto px-6 py-10" style={{ maxWidth: 'var(--reading-width, 680px)' }}>
      {/* 来源条 */}
      <div
        className="flex items-center gap-2 mb-6 pb-4"
        style={{ borderBottom: '1px solid var(--aa-border, rgba(45,40,34,0.09))' }}
      >
        <Globe size={14} style={{ color: '#6686a2' }} />
        <span className="text-xs" style={{ color: 'var(--aa-text-2, #87827c)' }}>
          {web.site}
        </span>
        <a
          href={web.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs ml-auto transition-colors hover:opacity-80"
          style={{ color: 'var(--aa-accent, #6865a7)' }}
        >
          访问原网页
          <ExternalLink size={11} />
        </a>
      </div>

      <h1 className="mb-5 text-xl font-semibold reading-prose" style={{ color: 'var(--aa-text-1, #292722)' }}>
        {title}
      </h1>
      <div className="reading-prose">{renderMarkdown(web.body)}</div>
    </div>
  )
}

/* -------------------------------- Image --------------------------------- */

function ImageBody({ image }: { image: { src: string; alt: string; caption?: string } }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full py-12 px-6">
      <div
        className="max-w-full"
        style={{
          background: '#ffffff',
          border: '1px solid var(--aa-border, rgba(45,40,34,0.09))',
          borderRadius: 6,
          padding: 12,
          boxShadow: '0 1px 8px rgba(45,40,34,0.06)',
        }}
      >
        <ImageWithFallback
          src={image.src}
          alt={image.alt}
          className="max-w-full rounded"
          style={{ maxHeight: '72vh', objectFit: 'contain', display: 'block' }}
        />
      </div>
      {image.caption && (
        <p className="mt-4 text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
          {image.caption}
        </p>
      )}
    </div>
  )
}

/* -------------------------------- Video --------------------------------- */

function VideoBody({ video, title }: { video: { src: string; poster?: string; duration?: string }; title: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full py-12 px-6">
      <div
        className="w-full"
        style={{
          maxWidth: 880,
          background: '#000',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 2px 16px rgba(45,40,34,0.12)',
        }}
      >
        <video
          controls
          poster={video.poster}
          src={video.src}
          className="w-full"
          style={{ display: 'block', maxHeight: '72vh' }}
        />
      </div>
      <p className="mt-4 text-xs" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
        {title}
        {video.duration ? ` · ${video.duration}` : ''}
      </p>
    </div>
  )
}

/* -------------------------------- Audio --------------------------------- */

function AudioBody({
  audio,
  title,
}: {
  audio: { src: string; duration?: string; transcript?: string }
  title: string
}) {
  return (
    <div className="mx-auto px-6 py-12" style={{ maxWidth: 'var(--reading-width, 680px)' }}>
      <div
        className="flex items-center gap-4 p-5 rounded-2xl mb-8"
        style={{ background: 'var(--aa-surface, #fff)', border: '1px solid var(--aa-border, rgba(45,40,34,0.09))' }}
      >
        <span
          className="flex items-center justify-center rounded-xl shrink-0"
          style={{ width: 56, height: 56, background: '#b0885a22' }}
        >
          <Music size={24} style={{ color: '#b0885a' }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="m-0 text-sm truncate" style={{ color: 'var(--aa-text-1, #292722)' }}>
            {title}
          </p>
          <audio controls src={audio.src} className="w-full mt-2" style={{ height: 36 }} />
        </div>
      </div>
      {audio.transcript && (
        <div className="reading-prose">
          <p className="text-xs mb-2" style={{ color: 'var(--aa-text-3, #aba39b)' }}>
            文字稿
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--aa-text-1, #292722)' }}>
            {audio.transcript}
          </p>
        </div>
      )}
    </div>
  )
}

/* --------------------------------- Code --------------------------------- */

function CodeBody({ code }: { code: { language: string; filename: string; source: string } }) {
  return (
    <div className="mx-auto px-6 py-10" style={{ maxWidth: 820 }}>
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--aa-border, rgba(45,40,34,0.09))' }}
      >
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{ background: 'var(--aa-surface-hover, #eeebe6)', borderBottom: '1px solid var(--aa-border, rgba(45,40,34,0.09))' }}
        >
          <span className="text-xs" style={{ color: 'var(--aa-text-2, #87827c)' }}>
            {code.filename}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: '#5f8a8622', color: '#5f8a86' }}
          >
            {code.language}
          </span>
        </div>
        <pre
          className="m-0 overflow-x-auto text-xs leading-relaxed"
          style={{
            background: '#1e1c1a',
            color: '#e8e3da',
            padding: '20px 22px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          }}
        >
          <code>{code.source}</code>
        </pre>
      </div>
    </div>
  )
}
