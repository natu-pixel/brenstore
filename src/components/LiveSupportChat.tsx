import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { IconExternalLink, IconMessageCircle, IconX } from '@tabler/icons-react';
import './LiveSupportChat.css';

const chatUrl = 'https://tawk.to/chat/6ab372e934848d34424e8448/1k36fholt';

export default function LiveSupportChat() {
  const location = useLocation();
  return location.pathname === '/' ? <StorefrontChat /> : null;
}

function StorefrontChat() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <IconMessageCircle size={20} /> Chat with support
    </button>
    <button className="support-chat-launcher" onClick={() => setOpen(true)}
      aria-label="Open live support chat" aria-haspopup="dialog"
      aria-controls="brenstore-live-support" aria-expanded={open}>
      <IconMessageCircle size={22} /><span>Live chat</span>
    </button>
    {open && <SupportDialog onClose={() => setOpen(false)} />}
  </>;
}

function SupportDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'slow' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (status !== 'loading') return;
    const timeout = window.setTimeout(() => setStatus('slow'), 15_000);
    return () => window.clearTimeout(timeout);
  }, [status, attempt]);

  function retry() {
    setStatus('loading');
    setAttempt((value) => value + 1);
  }

  return <dialog ref={dialog} id="brenstore-live-support" className="support-chat-dialog"
    aria-labelledby="brenstore-live-support-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="support-chat-heading">
      <div><h2 id="brenstore-live-support-title">Brenstore support</h2><p>Live chat provided by tawk.to</p></div>
      <button className="support-chat-close" aria-label="Close support chat" onClick={onClose}><IconX size={20} /></button>
    </header>
    {status === 'loading' && <p className="support-chat-notice" role="status">Opening support chat...</p>}
    {(status === 'slow' || status === 'error') && <div className="support-chat-notice" role={status === 'error' ? 'alert' : 'status'}>
      <p>{status === 'error' ? 'Support chat could not load.' : 'Chat is taking longer than expected.'} You can retry or open the chat page below.</p>
      <button className="auth-switch" onClick={retry}>Retry chat</button>
    </div>}
    {status !== 'error' && <iframe key={attempt} className="support-chat-frame" src={chatUrl}
      title="Brenstore support chat (tawk.to)"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      referrerPolicy="no-referrer"
      onLoad={() => setStatus((current) => current === 'error' ? 'error' : 'loaded')}
      onErrorCapture={() => setStatus('error')} />}
    <footer className="support-chat-footer">
      <span>Never share passwords or payment-card details.</span>
      <a href={chatUrl} target="_blank" rel="noopener noreferrer">Open chat in a new tab <IconExternalLink size={14} /></a>
    </footer>
  </dialog>;
}
