import type { SpaceReferencePreview } from '../../../../../../panel-api-contracts'

export type DocumentMaterialKind = 'file' | 'markdown' | 'pdf' | 'web' | 'image' | 'video' | 'audio' | 'code'

export function isMarkdownDocument(preview: SpaceReferencePreview): boolean {
  return preview.presentation.kind === 'markdown'
}

export function classifyReferencePreview(preview: SpaceReferencePreview | undefined): DocumentMaterialKind {
  switch (preview?.presentation.kind) {
    case 'markdown': return 'markdown'
    case 'code': return 'code'
    case 'pdf': return 'pdf'
    case 'web': return 'web'
    case 'image': return 'image'
    case 'video': return 'video'
    case 'audio': return 'audio'
    default: return 'file'
  }
}
