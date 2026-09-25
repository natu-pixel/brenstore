import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { StrictMode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveSupportChat from './LiveSupportChat';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(() => {
  for (const [name, descriptor] of [['showModal', originalShowModal], ['close', originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

function setup(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><LiveSupportChat /></MemoryRouter>);
}

describe('isolated storefront chat', () => {
  it('does not load third-party code or a frame before a customer opens chat', () => {
    const { container } = setup();
    expect(screen.getByRole('button', { name: 'Open live support chat' })).toBeVisible();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
  it('loads the exact provided Tawk widget in a sandbox without a page referrer', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open live support chat' }));
    const frame = screen.getByTitle('Brenstore support chat (tawk.to)');
    expect(frame).toHaveAttribute('src', 'https://tawk.to/chat/6ab372e934848d34424e8448/1k36fholt');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads');
    expect(document.querySelector('script[src*="tawk.to"]')).toBeNull();
  });
  it.each(['/auth', '/auth/callback?access_token=secret', '/checkout', '/orders', '/orders/example', '/admin', '/admin/orders'])('never mounts chat on %s', (path) => {
    const { container } = setup(path);
    expect(container).toBeEmptyDOMElement();
  });
  it('destroys the provider browsing context when the visitor closes chat', () => {
    setup();
    const launcher = screen.getByRole('button', { name: 'Open live support chat' });
    launcher.focus();
    fireEvent.click(launcher);
    fireEvent.click(screen.getByRole('button', { name: 'Close support chat' }));
    expect(screen.queryByTitle('Brenstore support chat (tawk.to)')).not.toBeInTheDocument();
    expect(launcher).toHaveFocus();
  });
  it('reports a slow load at 15 seconds and offers an explicit retry', () => {
    vi.useFakeTimers();
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Chat with support' }));
    act(() => vi.advanceTimersByTime(14_999));
    expect(screen.queryByText(/longer than expected/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText(/longer than expected/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry chat' }));
    expect(screen.getByRole('status')).toHaveTextContent('Opening support chat');
  });
  it('shows load errors and retains a safe direct-chat escape route', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open live support chat' }));
    fireEvent.error(screen.getByTitle('Brenstore support chat (tawk.to)'));
    expect(screen.getByRole('alert')).toHaveTextContent('Support chat could not load');
    expect(screen.queryByTitle('Brenstore support chat (tawk.to)')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open chat in a new tab/ })).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('clears the loading timer after the provider document loads', () => {
    vi.useFakeTimers();
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open live support chat' }));
    fireEvent.load(screen.getByTitle('Brenstore support chat (tawk.to)'));
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('keeps one frame across repeated opens in StrictMode and supports native cancellation', () => {
    render(<StrictMode><MemoryRouter><LiveSupportChat /></MemoryRouter></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Open live support chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open live support chat' }));
    expect(screen.getAllByTitle('Brenstore support chat (tawk.to)')).toHaveLength(1);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open live support chat' }));
    expect(screen.getAllByTitle('Brenstore support chat (tawk.to)')).toHaveLength(1);
  });
  it('unmounts an open provider frame when a private route is entered', () => {
    function Example() {
      const navigate = useNavigate();
      return <><button onClick={() => navigate('/auth')}>Sign in</button><LiveSupportChat /></>;
    }
    render(<MemoryRouter><Routes><Route path="*" element={<Example />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Open live support chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.queryByTitle('Brenstore support chat (tawk.to)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open live support chat' })).not.toBeInTheDocument();
  });
});
