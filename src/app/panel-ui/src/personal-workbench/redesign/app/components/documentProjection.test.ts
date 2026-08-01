import { describe, expect, test } from 'vitest'
import type { DocumentPresentation, DocumentPreview } from '../../../../../../panel-api-contracts'
import { classifyReferencePreview, isMarkdownDocument } from './documentProjection'

describe('document projection', () => {
  test('trusts the backend presentation instead of guessing from paths or languages', () => {
    const markdown = textPreview('C:/notes/document', 'plaintext', presentation('markdown', true))
    const plain = textPreview('C:/notes/readme.md', 'markdown', presentation('text', true))

    expect(isMarkdownDocument(markdown)).toBe(true)
    expect(isMarkdownDocument(plain)).toBe(false)
    expect(classifyReferencePreview(markdown)).toBe('markdown')
    expect(classifyReferencePreview(plain)).toBe('file')
  })

  test('keeps unloaded cards generic until an authoritative preview arrives', () => {
    expect(classifyReferencePreview(undefined)).toBe('file')
  })

  test('preserves backend media and document kinds', () => {
    expect(classifyReferencePreview(previewWithContent({ kind: 'media', mediaKind: 'image', mimeType: 'image/png', url: '/image' }, presentation('image')))).toBe('image')
    expect(classifyReferencePreview(previewWithContent({ kind: 'pages', pages: ['page'] }, presentation('pdf')))).toBe('pdf')
    expect(classifyReferencePreview(previewWithContent({ kind: 'web', url: 'https://example.com' }, presentation('web')))).toBe('web')
  })
})

function textPreview(source: string, language: string, value: DocumentPresentation): DocumentPreview {
  return previewWithContent({ kind: 'text', text: 'content', truncated: false, editable: true, language, encoding: 'UTF-8' }, value, source)
}

function previewWithContent(content: DocumentPreview['content'], value: DocumentPresentation, source = 'managed://asset'): DocumentPreview {
  return {
    itemId: 'asset-one',
    title: source.replaceAll('\\', '/').split('/').pop() ?? 'asset',
    sourceKind: 'local_file',
    source,
    status: 'ready',
    presentation: value,
    content,
  }
}

function presentation(kind: DocumentPresentation['kind'], editable = false): DocumentPresentation {
  return { kind, editable, sourceMode: kind === 'markdown' && editable }
}
