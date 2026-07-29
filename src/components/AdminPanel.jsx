import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Clock3,
  History,
  LoaderCircle,
  LogOut,
  MapPin,
  MonitorSmartphone,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  clearAdminToken,
  forgetListenerDevice,
  getAdminToken,
  loadAdminListeners,
  loginAdmin,
  updateListenerAccess,
} from '../services/adminApi';

const relativeTime = (timestamp) => {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
  if (seconds < 10) return 'сега';
  if (seconds < 60) return `преди ${seconds} сек.`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `преди ${minutes} мин.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `преди ${hours} ч.`;
  return new Intl.DateTimeFormat('bg-BG', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
};

const formatPosition = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
};

const progressOf = (device) => (
  device.duration > 0
    ? Math.min(100, Math.round((device.position / device.duration) * 100))
    : 0
);

export default function AdminPanel({ open, onClose }) {
  const [tokenReady, setTokenReady] = useState(() => !!getAdminToken());
  const [password, setPassword] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionId, setActionId] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [tab, setTab] = useState('listeners');

  const refresh = async ({ quiet = false } = {}) => {
    if (!tokenReady && !getAdminToken()) return;
    if (!quiet) setBusy(true);
    try {
      setData(await loadAdminListeners());
      setTokenReady(true);
      setError('');
    } catch (reason) {
      if (reason.status === 401) {
        setTokenReady(false);
        setData(null);
      }
      setError(reason.message);
    } finally {
      if (!quiet) setBusy(false);
    }
  };

  useEffect(() => {
    if (!open || !tokenReady) return undefined;
    refresh();
    const timer = window.setInterval(() => refresh({ quiet: true }), 10000);
    return () => window.clearInterval(timer);
  }, [open, tokenReady]);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setError('');
    }
  }, [open]);

  const login = async (event) => {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      await loginAdmin(password);
      setPassword('');
      setTokenReady(true);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    clearAdminToken();
    setTokenReady(false);
    setData(null);
    setPassword('');
  };

  const runAction = async (device, action) => {
    if (action === 'forget' && !window.confirm(`Да се изтрие историята за ${device.label}?`)) return;
    setActionId(device.id);
    setError('');
    try {
      if (action === 'forget') await forgetListenerDevice(device.id);
      else await updateListenerAccess(device.id, action);
      await refresh({ quiet: true });
    } catch (reason) {
      setError(reason.message);
    } finally {
      setActionId('');
    }
  };

  const devices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('bg-BG');
    return (data?.devices || []).filter((device) => {
      if (filter === 'active' && !device.active) return false;
      if (filter === 'blocked' && !device.blocked) return false;
      if (filter === 'recent' && (device.active || device.blocked)) return false;
      if (!needle) return true;
      return [
        device.label,
        device.location,
        device.book?.title,
        device.networkId,
      ].filter(Boolean).join(' ').toLocaleLowerCase('bg-BG').includes(needle);
    });
  }, [data, filter, query]);

  if (!open) return null;

  return (
    <div className="admin-layer" role="dialog" aria-modal="true" aria-label="Администраторски панел">
      <button className="admin-backdrop" onClick={onClose} aria-label="Затвори администраторския панел" />
      <section className={`admin-panel ${tokenReady ? 'dashboard' : 'login'}`}>
        <header className="admin-panel-head">
          <div>
            <ShieldCheck aria-hidden="true" />
            <span>
              <small>VOXORA CONTROL</small>
              <b>{tokenReady ? 'Активни слушатели' : 'Администратор'}</b>
            </span>
          </div>
          <div className="admin-head-actions">
            {tokenReady && (
              <button onClick={logout} aria-label="Изход" title="Изход">
                <LogOut aria-hidden="true" />
              </button>
            )}
            <button onClick={onClose} aria-label="Затвори" title="Затвори">
              <X aria-hidden="true" />
            </button>
          </div>
        </header>

        {!tokenReady ? (
          <form className="admin-login" onSubmit={login}>
            <div className="admin-login-mark"><ShieldCheck aria-hidden="true" /></div>
            <h2>Защитен достъп</h2>
            <p>Въведи администраторската парола.</p>
            <label>
              <span>Парола</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
                placeholder="••••••••"
              />
            </label>
            {error && <p className="admin-error">{error}</p>}
            <button className="admin-login-submit" disabled={busy || !password}>
              {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              Вход
            </button>
          </form>
        ) : (
          <div className="admin-dashboard">
            <div className="admin-summary">
              <div className="primary">
                <Play aria-hidden="true" />
                <span><b>{data?.summary?.active ?? '—'}</b><small>слушат сега</small></span>
              </div>
              <div>
                <Users aria-hidden="true" />
                <span><b>{data?.summary?.total ?? '—'}</b><small>устройства</small></span>
              </div>
              <div>
                <Clock3 aria-hidden="true" />
                <span><b>{data?.summary?.paused ?? '—'}</b><small>на пауза</small></span>
              </div>
              <div className="danger">
                <Ban aria-hidden="true" />
                <span><b>{data?.summary?.blocked ?? '—'}</b><small>блокирани</small></span>
              </div>
            </div>

            <div className="admin-tabs" role="tablist">
              <button className={tab === 'listeners' ? 'on' : ''} onClick={() => setTab('listeners')}>
                <MonitorSmartphone aria-hidden="true" /> Устройства
              </button>
              <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
                <History aria-hidden="true" /> История
              </button>
              <button className="admin-refresh" onClick={() => refresh()} disabled={busy} aria-label="Обнови" title="Обнови">
                <RefreshCw className={busy ? 'spin' : ''} aria-hidden="true" />
              </button>
            </div>

            {error && <p className="admin-error dashboard-error">{error}</p>}

            {tab === 'listeners' ? (
              <>
                <div className="admin-tools">
                  <label>
                    <Search aria-hidden="true" />
                    <input
                      type="search"
                      placeholder="Устройство, книга, град…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <div>
                    {[
                      ['active', 'Активни'],
                      ['all', 'Всички'],
                      ['recent', 'Неактивни'],
                      ['blocked', 'Спрени'],
                    ].map(([value, label]) => (
                      <button key={value} className={filter === value ? 'on' : ''} onClick={() => setFilter(value)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="admin-device-list">
                  {devices.map((device) => (
                    <article key={device.id} className={`admin-device ${device.active ? 'active' : ''} ${device.blocked ? 'blocked' : ''}`}>
                      <div className="admin-device-icon">
                        <MonitorSmartphone aria-hidden="true" />
                        <i />
                      </div>
                      <div className="admin-device-copy">
                        <div>
                          <b>{device.label}</b>
                          <span className={`admin-state ${device.blocked ? 'blocked' : device.active ? 'live' : ''}`}>
                            {device.blocked ? 'Спрян' : device.active ? 'Слуша' : relativeTime(device.lastSeen)}
                          </span>
                        </div>
                        <p>{device.book?.title || 'Няма активна книга'}</p>
                        {device.book && (
                          <div className="admin-progress">
                            <i style={{ width: `${progressOf(device)}%` }} />
                          </div>
                        )}
                        <small>
                          {device.book ? `${formatPosition(device.position)} · ${progressOf(device)}%` : 'Без позиция'}
                          {device.location && <><MapPin aria-hidden="true" /> {device.location}</>}
                          <span>Мрежа {device.networkId}</span>
                        </small>
                      </div>
                      <div className="admin-device-actions">
                        <button
                          className={device.blocked ? 'allow' : 'deny'}
                          onClick={() => runAction(device, device.blocked ? 'unblock' : 'block')}
                          disabled={actionId === device.id}
                          aria-label={device.blocked ? 'Възстанови достъпа' : 'Спри достъпа'}
                          title={device.blocked ? 'Възстанови достъпа' : 'Спри достъпа'}
                        >
                          {device.blocked ? <ShieldCheck aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
                        </button>
                        <button
                          onClick={() => runAction(device, 'forget')}
                          disabled={actionId === device.id}
                          aria-label="Изтрий устройството и историята"
                          title="Изтрий устройството"
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  ))}
                  {!busy && !devices.length && (
                    <div className="admin-empty">
                      <MonitorSmartphone aria-hidden="true" />
                      <p>Няма устройства в този изглед.</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="admin-history">
                {(data?.history || []).map((event) => (
                  <article key={event.id}>
                    <i className={event.state === 'playing' ? 'live' : event.state.includes?.('спрян') ? 'blocked' : ''} />
                    <div>
                      <b>{event.label}</b>
                      <p>{event.deviceLabel}{event.book?.title ? ` · ${event.book.title}` : ''}</p>
                      <small>{relativeTime(event.at)}{event.location ? ` · ${event.location}` : ''}</small>
                    </div>
                  </article>
                ))}
                {!busy && !data?.history?.length && (
                  <div className="admin-empty"><History aria-hidden="true" /><p>Все още няма записана история.</p></div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

