import { useSyncExternalStore } from 'react'
import { getWarmedImageUrl, subscribeImagePreview } from './imagePreviewRuntime'

export function ImageDocumentSurface({
  url,
  sourceVersion,
  alt,
  caption,
}: {
  readonly url: string
  readonly sourceVersion?: string
  readonly alt: string
  readonly caption?: string
}) {
  const warmedUrl = useSyncExternalStore(
    subscribeImagePreview,
    () => getWarmedImageUrl(url, sourceVersion),
    () => undefined,
  )

  return (
    <div className={`aa-reference-preview__media${caption ? ' aa-reference-preview__media--described' : ''}`} data-document-scroll="content">
      <img src={warmedUrl ?? url} alt={alt} />
      {caption && <p>{caption}</p>}
    </div>
  )
}
