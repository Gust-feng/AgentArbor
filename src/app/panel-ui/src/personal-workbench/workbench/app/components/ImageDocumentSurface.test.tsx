import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ImageDocumentSurface } from './ImageDocumentSurface'

const getWarmedImageUrlMock = vi.hoisted(() => vi.fn<(url: string, sourceVersion?: string) => string | undefined>())

vi.mock('./imagePreviewRuntime', () => ({
  getWarmedImageUrl: getWarmedImageUrlMock,
}))

afterEach(() => {
  getWarmedImageUrlMock.mockReset()
})

test('keeps the mounted image URL stable when warming finishes after the first render', () => {
  getWarmedImageUrlMock.mockReturnValue(undefined)
  const rendered = render(<ImageDocumentSurface url="/image.png" sourceVersion="source-v1" alt="图像" />)
  const image = screen.getByRole('img', { name: '图像' })
  expect(image.getAttribute('src')).toBe('/image.png')

  getWarmedImageUrlMock.mockReturnValue('blob:warmed-v1')
  rendered.rerender(<ImageDocumentSurface url="/image.png" sourceVersion="source-v1" alt="图像" />)
  expect(screen.getByRole('img', { name: '图像' })).toBe(image)
  expect(image.getAttribute('src')).toBe('/image.png')

  getWarmedImageUrlMock.mockReturnValue('blob:warmed-v2')
  rendered.rerender(<ImageDocumentSurface url="/image.png" sourceVersion="source-v2" alt="图像" />)
  expect(screen.getByRole('img', { name: '图像' }).getAttribute('src')).toBe('blob:warmed-v2')
})

test('saves on blur without inserting a transient saving message', () => {
  const onCaptionChange = vi.fn(() => new Promise<void>(() => undefined))
  render(<ImageDocumentSurface url="/image.png" sourceVersion="source-v1" alt="图像" caption="旧说明" editable onCaptionChange={onCaptionChange} />)

  const editor = screen.getByRole('textbox', { name: '图片说明' })
  fireEvent.focus(editor)
  editor.textContent = '新说明'
  fireEvent.input(editor)
  fireEvent.blur(editor)

  expect(onCaptionChange).toHaveBeenCalledWith('新说明')
  expect(screen.queryByText('保存中…')).toBeNull()
})

test('disables native spell checking for an editable image caption', () => {
  render(
    <ImageDocumentSurface
      url="/image.png"
      alt="图像"
      caption="caption"
      editable
      onCaptionChange={async () => undefined}
    />,
  )

  expect(screen.getByRole('textbox', { name: '图片说明' }).getAttribute('spellcheck')).toBe('false')
})
