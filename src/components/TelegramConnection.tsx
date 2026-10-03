import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { telegramOperation } from '../features/api';

const stateMessages = {
  pending: 'Review the Telegram identity below before approving. The bot will be able to place orders and read your order summaries.',
  approved: 'Website approval saved. Return to the original Telegram chat, check the website account name, and confirm the connection there.',
  connected: 'Telegram is connected. You can now order in the bot and see those orders in My Orders.',
  rejected: 'You rejected this connection. Start a new request in the bot if needed.',
  superseded: 'A newer connection link replaced this one. Open the newest link from the bot.',
  revoked: 'This connection was disconnected. Start a new request in the bot to reconnect.',
  expired: 'This link expired. Start a new connection request in the bot.',
};

export default function TelegramConnection() {
  const { token } = useParams();
  const { user } = useAuth();
  const cache = useQueryClient();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const validToken = token !== undefined && /^[A-Za-z0-9_-]{43}$/.test(token);
  const preview = useQuery({
    queryKey: ['bren', 'telegram-preview', user?.id, token],
    queryFn: () => telegramOperation('preview', { token }),
    enabled: validToken,
    retry: false,
    refetchInterval: query => query.state.data && ['pending', 'approved'].includes(query.state.data.state) ? 5000 : false,
  });
  const status = useQuery({
    queryKey: ['bren', 'telegram-status', user?.id],
    queryFn: () => telegramOperation('status'),
    retry: false,
  });
  const action = useMutation({
    mutationFn: (op: 'approve' | 'reject' | 'unlink') => telegramOperation(op, op === 'unlink' ? {} : { token }),
    onSuccess: async () => {
      setConfirmDisconnect(false);
      await cache.invalidateQueries({ queryKey: ['bren'] });
    },
  });
  const botUsername: unknown = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
  const botUrl = typeof botUsername === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(botUsername)
    ? `https://t.me/${botUsername}` : null;
  const linked = status.data?.linked || preview.data?.state === 'connected';
  return <section className="auth"><div className="auth-card checkout-card">
    <h1 className="auth-title">Telegram connection</h1>
    <p>Website account: <strong>{user?.email}</strong></p>
    <p>Connect one Telegram account to order through the bot. We share your display name and order summaries, not your password or account email. Bot chats are not end-to-end encrypted.</p>
    {token !== undefined && !validToken && <p className="auth-error" role="alert">Invalid connection link. Start again in the bot.</p>}
    {validToken && <>
      {preview.isPending && <p role="status">Checking connection request...</p>}
      {preview.isError && <p className="auth-error" role="alert">Connection check failed: {preview.error.message} {preview.data && 'Previously displayed information may be out of date.'}</p>}
      {preview.data && <>
        <p><strong>Telegram: {preview.data.name || 'Name not provided'}</strong>{preview.data.username && ` (@${preview.data.username})`}</p>
        <p role="status">{stateMessages[preview.data.state]}</p>
        {['pending', 'approved'].includes(preview.data.state) && <p>Expires {new Date(preview.data.expires_at).toLocaleString()}. Only approve if you started this request in your own private bot chat.</p>}
        {preview.data.state === 'pending' && !preview.isError && !status.isError && <>
          <button className="btn auth-submit" disabled={action.isPending || status.isPending || linked} onClick={() => action.mutate('approve')}>Approve connection</button>
          <button className="auth-guest" disabled={action.isPending} onClick={() => action.mutate('reject')}>Reject connection</button>
        </>}
        {preview.data.state === 'approved' && !preview.isError && <button className="auth-guest" disabled={action.isPending} onClick={() => action.mutate('reject')}>Cancel pending connection</button>}
      </>}
      <button className="auth-guest" disabled={preview.isFetching || action.isPending} onClick={() => void preview.refetch()}>Check connection again</button>
    </>}
    {status.isPending && <p role="status">Loading connected account...</p>}
    {status.isError && <p className="auth-error" role="alert">Connection status unavailable: {status.error.message}</p>}
    {status.data?.connection && <p>Connected Telegram: <strong>{status.data.connection.name || 'Name not provided'}</strong>{status.data.connection.username && ` (@${status.data.connection.username})`}</p>}
    {linked && <>
      <label className="auth-field"><span><input type="checkbox" checked={confirmDisconnect} onChange={event => setConfirmDisconnect(event.target.checked)} /> Disconnect Telegram and stop its access to my orders</span></label>
      <button className="btn" disabled={!confirmDisconnect || action.isPending || status.isError} onClick={() => action.mutate('unlink')}>Disconnect Telegram</button>
      <p>Disconnecting preserves your orders. It does not erase earlier Telegram messages.</p>
    </>}
    {status.data && !linked && <p>No active Telegram connection. Start a connection request in the bot, open its website link, and approve on both sides.</p>}
    <button className="auth-guest" disabled={status.isFetching || action.isPending} onClick={() => void status.refetch()}>Refresh linked account</button>
    {action.isPending && <p role="status">Saving connection change...</p>}
    {action.isError && <p className="auth-error" role="alert">{action.error.message} Check the connection before retrying.</p>}
    {botUrl && <a className="auth-guest" href={botUrl} target="_blank" rel="noreferrer">Open Telegram bot</a>}
    <Link className="auth-guest" to="/orders">My Orders</Link>
  </div></section>;
}
