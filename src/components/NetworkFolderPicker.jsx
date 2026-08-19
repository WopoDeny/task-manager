import { useCallback, useEffect, useRef, useState } from 'react';
import { api, json } from '../lib/api.js';
import { Icon } from './Icon.jsx';

export function NetworkFolderPicker({ initialPath = '', onClose, onSelect }) {
  const [location, setLocation] = useState(null);
  const [pathValue, setPathValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const openPath = useCallback(async (value, fallbackToRoots = false) => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const response = await api('/api/paths/browse-network', {
        method: 'POST',
        body: json({ path: value })
      });
      if (currentRequest !== requestId.current) return;
      setLocation(response);
      setPathValue(response.path || response.roots?.[0] || '');
    } catch (requestError) {
      if (currentRequest !== requestId.current) return;
      if (fallbackToRoots && value) {
        await openPath('', false);
        return;
      }
      setError(requestError.message);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    openPath(initialPath.trim(), true);
    return () => { requestId.current += 1; };
  }, [initialPath, openPath]);

  useEffect(() => {
    const closeOnEscape = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  function submitPath(event) {
    event.preventDefault();
    if (pathValue.trim()) openPath(pathValue.trim());
  }

  const canSelect = Boolean(
    location?.selectable
    && location.path
    && location.path.toLowerCase() === pathValue.trim().toLowerCase()
  );

  return (
    <div className="network-picker-shell" role="dialog" aria-modal="true" aria-labelledby="network-picker-title">
      <button type="button" className="modal-backdrop" onClick={onClose} aria-label="Close network folder browser" />
      <section className="network-picker-card">
        <header className="network-picker-header">
          <div>
            <h2 id="network-picker-title">Select network folder</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>

        <form className="network-path-bar" onSubmit={submitPath}>
          <button type="button" className="icon-button" onClick={() => location?.parent ? openPath(location.parent) : openPath('')} disabled={loading || (!location?.parent && !location?.path)} aria-label="Go up">
            <Icon name="arrow" className="network-up-icon" />
          </button>
          <div className="network-path-input-wrap">
            <Icon name="folder" size={17} />
            <input className="text-input" value={pathValue} onChange={event => setPathValue(event.target.value)} placeholder="\\\\192.168.33.27\\ShareName" aria-label="Network path" autoComplete="off" spellCheck={false} autoFocus />
          </div>
          <button type="submit" className="button subtle" disabled={loading || !pathValue.trim()}>Open</button>
        </form>

        <div className="network-folder-list" aria-live="polite" aria-busy={loading}>
          {loading && <div className="network-picker-state">Opening folder…</div>}
          {!loading && error && (
            <div className="network-picker-state error">
              <Icon name="alert" size={20} />
              <span>{error}</span>
            </div>
          )}
          {!loading && !error && location?.folders?.map(folder => (
            <button type="button" className="network-folder-row" key={folder.path} onClick={() => openPath(folder.path)}>
              <span className="network-folder-icon"><Icon name="folder" size={19} /></span>
              <span>
                <strong>{folder.name}</strong>
                <small>{folder.path}</small>
              </span>
              <Icon name="chevron" size={18} />
            </button>
          ))}
          {!loading && !error && location && location.folders?.length === 0 && (
            <div className="network-picker-state">This folder has no subfolders.</div>
          )}
        </div>

        <footer className="network-picker-footer">
          <button type="button" className="button subtle" onClick={onClose}>Cancel</button>
          <button type="button" className="button primary" disabled={!canSelect || loading} onClick={() => onSelect(location.path)}>
            Use this folder <Icon name="check" size={16} />
          </button>
        </footer>
      </section>
    </div>
  );
}
