import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { loadDocxRenderer, loadOfficeDocument } from './officePreviewRuntime'
import './office-document.css'

export function DocxDocumentSurface({ url, byteLength, sourceVersion }: {
  url: string
  byteLength?: number
  sourceVersion?: string
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('正在读取文档...')

  useEffect(() => {
    const controller = new AbortController()
    const body = bodyRef.current
    const styles = styleRef.current
    if (body === null || styles === null) return () => controller.abort()
    body.replaceChildren()
    styles.replaceChildren()
    setState('loading')
    setMessage('正在读取文档...')

    void Promise.all([
      loadOfficeDocument({ url, byteLength, sourceVersion, signal: controller.signal }),
      loadDocxRenderer(),
    ]).then(async ([document, renderer]) => {
      if (controller.signal.aborted) return
      await renderer.renderAsync(document, body, styles, {
        className: 'aa-docx',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderChanges: false,
        renderComments: false,
        renderAltChunks: false,
        useBase64URL: true,
        experimental: false,
        debug: false,
      })
      if (!controller.signal.aborted) setState('ready')
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return
      setMessage(reason instanceof Error ? reason.message : '无法读取这个 Word 文档。')
      setState('error')
    })

    return () => {
      controller.abort()
      body.replaceChildren()
      styles.replaceChildren()
    }
  }, [byteLength, sourceVersion, url])

  return (
    <div className="aa-docx-document" data-state={state} data-document-scroll="content">
      <div ref={styleRef} className="aa-docx-document__styles" aria-hidden="true" />
      {state !== 'ready' && (
        <div className="aa-office-document__state" role={state === 'error' ? 'alert' : 'status'}>
          {state === 'error' ? <AlertTriangle size={20} /> : <LoaderCircle size={20} className="aa-office-document__spinner" />}
          <span>{message}</span>
        </div>
      )}
      <div ref={bodyRef} className="aa-docx-document__body" aria-label="Word 文档内容" />
    </div>
  )
}
