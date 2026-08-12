import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { DeferredSurfaceBoundary } from './DeferredSurfaceBoundary'

test('contains a deferred view failure and exposes an explicit retry', async () => {
  const user = userEvent.setup()
  const onRetry = vi.fn()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  render(
    <DeferredSurfaceBoundary resetKey="space" label="空间暂时无法打开" onRetry={onRetry}>
      <FailedDeferredView />
    </DeferredSurfaceBoundary>,
  )

  expect(screen.getByRole('alert').textContent).toContain('空间暂时无法打开')
  expect(screen.getByRole('alert').textContent).toContain('重新加载后再试。')
  const detailDisclosure = screen.getByText('错误详情').closest('details')
  expect(detailDisclosure).toBeTruthy()
  expect(detailDisclosure?.className).toContain('absolute')
  expect(screen.getByRole('alert').textContent).toContain('chunk unavailable')
  await user.click(screen.getByRole('button', { name: '重新加载' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
})

function FailedDeferredView(): never {
  throw new Error('chunk unavailable')
}