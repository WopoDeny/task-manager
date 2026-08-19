import { useEffect, useMemo, useState } from 'react';
import { api, json } from '../lib/api.js';
import { Icon } from './Icon.jsx';
import { NetworkFolderPicker } from './NetworkFolderPicker.jsx';

const weekdays = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' }
];

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function today() {
  return localDateString(new Date());
}

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localDateString(date);
}

function initialTask(task) {
  if (task) return structuredClone(task);
  return {
    name: '',
    enabled: true,
    sources: [{ path: '' }],
    destination: { path: '' },
    schedule: { type: 'weekly', time: '10:00', date: tomorrow(), weekdays: [1], dayOfMonth: 1, intervalValue: 1, intervalUnit: 'days' },
    retention: { enabled: true, value: 2, unit: 'days' },
    options: { requireAllSources: true, includeHidden: true, preserveTimestamps: true, verifyAfterCopy: true }
  };
}

export function TaskForm({ task, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() => initialTask(task));
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [browsing, setBrowsing] = useState(null);
  const [networkPicker, setNetworkPicker] = useState(null);
  const [pathResults, setPathResults] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const closeOnEscape = event => {
      if (event.key === 'Escape' && !saving && !networkPicker) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [networkPicker, onClose, saving]);

  const valid = useMemo(() => (
    form.name.trim() && form.sources.some(source => source.path.trim()) && form.destination.path.trim()
  ), [form]);

  function update(path, value) {
    setForm(current => {
      const next = structuredClone(current);
      const parts = path.split('.');
      let cursor = next;
      for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]];
      cursor[parts.at(-1)] = value;
      return next;
    });
  }

  function updateSource(index, value) {
    setForm(current => ({
      ...current,
      sources: current.sources.map((source, sourceIndex) => sourceIndex === index ? { path: value } : source)
    }));
    setPathResults([]);
  }

  function addSource() {
    setForm(current => current.sources.length >= 50
      ? current
      : { ...current, sources: [...current.sources, { path: '' }] });
  }

  function removeSource(index) {
    setForm(current => ({ ...current, sources: current.sources.filter((_, sourceIndex) => sourceIndex !== index) }));
  }

  function toggleWeekday(day) {
    setForm(current => {
      const selected = current.schedule.weekdays || [];
      const weekdays = selected.includes(day) ? selected.filter(item => item !== day) : [...selected, day];
      return { ...current, schedule: { ...current.schedule, weekdays } };
    });
  }

  function changeScheduleType(type) {
    setForm(current => {
      const schedule = { ...current.schedule, type };
      if (type === 'once' && !schedule.date) schedule.date = tomorrow();
      if (type === 'weekly' && !schedule.weekdays?.length) schedule.weekdays = [1];
      if (type === 'monthly' && !schedule.dayOfMonth) schedule.dayOfMonth = 1;
      if (type === 'interval') {
        if (!schedule.intervalValue) schedule.intervalValue = 1;
        if (!schedule.intervalUnit) schedule.intervalUnit = 'days';
      }
      return { ...current, schedule };
    });
  }

  async function inspect() {
    const paths = [...form.sources.map(source => source.path), form.destination.path].filter(Boolean);
    if (!paths.length) return;
    setChecking(true);
    try {
      const response = await api('/api/paths/inspect', { method: 'POST', body: json({ paths }) });
      setPathResults(response.results);
      notify('Path check completed.', 'success');
    } catch (requestError) {
      notify(requestError.message, 'error');
    } finally {
      setChecking(false);
    }
  }

  function selectNetworkFolder(value) {
    if (networkPicker?.target === 'source') updateSource(networkPicker.index, value);
    else {
      update('destination.path', value);
      setPathResults([]);
    }
    setNetworkPicker(null);
  }

  async function browseFolder(target, index = null) {
    const browseId = target === 'source' ? `source-${index}` : 'destination';
    setBrowsing(browseId);
    try {
      const response = await api('/api/paths/select-folder', { method: 'POST' });
      if (response.mode === 'network') {
        setNetworkPicker({ target, index });
        return;
      }
      if (!response.path) return;
      if (target === 'source') updateSource(index, response.path);
      else {
        update('destination.path', response.path);
        setPathResults([]);
      }
    } catch (requestError) {
      if (requestError.code === 'HOST_ONLY_PICKER') {
        setNetworkPicker({ target, index });
      } else {
        notify(requestError.message, 'error');
      }
    } finally {
      setBrowsing(null);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!valid) {
      setError('Complete the task name, at least one source, and the destination.');
      return;
    }
    if (form.schedule.type === 'weekly' && !form.schedule.weekdays?.length) {
      setError('Select at least one weekday.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        sources: form.sources.filter(source => source.path.trim())
      };
      const response = await api(task ? `/api/tasks/${task.id}` : '/api/tasks', {
        method: task ? 'PUT' : 'POST',
        body: json(body)
      });
      onSaved(response.task);
      notify(task ? 'Automation updated.' : 'Automation created.', 'success');
      onClose();
    } catch (requestError) {
      setError(requestError.details?.join(' ') || requestError.message);
    } finally {
      setSaving(false);
    }
  }

  const resultFor = value => pathResults.find(item => item.input === value
    || item.input?.toLowerCase() === value?.toLowerCase()
    || item.path === value
    || item.path?.toLowerCase() === value?.toLowerCase());
  const destinationResult = resultFor(form.destination.path);
  const destinationState = !destinationResult
    ? null
    : destinationResult.error
      ? { className: 'warning', label: 'Check failed' }
      : destinationResult.exists
        ? destinationResult.type !== 'directory'
          ? { className: 'warning', label: 'Not a folder' }
          : destinationResult.writable === false
            ? { className: 'warning', label: 'Not writable' }
            : destinationResult.empty
              ? { className: 'exists', label: 'Empty folder ready' }
              : { className: 'warning', label: 'Folder not empty' }
        : { className: 'future', label: 'Will be created' };

  const networkPickerInitialPath = networkPicker?.target === 'source'
    ? form.sources[networkPicker.index]?.path || ''
    : form.destination.path;

  return (
    <>
    <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="task-form-title">
      <button className="modal-backdrop" onClick={onClose} aria-label="Close" />
      <form className="task-modal" onSubmit={submit}>
        <header className="modal-header">
          <div>
            <h2 id="task-form-title">{task ? 'Edit task' : 'Create task'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>

        <div className="modal-scroll">
          <section className="form-section">
            <div className="section-number">01</div>
            <div className="section-content">
              <h3>Task details</h3>
              <label className="field-label" htmlFor="task-name">Name</label>
              <input id="task-name" className="text-input large" maxLength={100} value={form.name} onChange={event => update('name', event.target.value)} placeholder="Monday document collection" autoFocus />
            </div>
          </section>

          <section className="form-section">
            <div className="section-number">02</div>
            <div className="section-content">
              <div className="section-title-row">
                <div>
                  <h3>Source folders</h3>
                  <p>Select a local or network folder, then append any folders that will be created later.</p>
                </div>
                <button type="button" className="button subtle small" onClick={addSource} disabled={form.sources.length >= 50} title={form.sources.length >= 50 ? 'Maximum 50 source folders' : 'Add another source folder'}><Icon name="plus" size={15} /> Add source</button>
              </div>
              <div className="source-list">
                {form.sources.map((source, index) => {
                  const result = resultFor(source.path);
                  const state = !result
                    ? null
                    : result.error || (result.exists && result.type !== 'directory') || result.readable === false
                      ? { className: 'warning', label: result.error ? 'Check failed' : result.type !== 'directory' ? 'Not a folder' : 'Not readable' }
                      : result.exists
                        ? { className: 'exists', label: 'Ready' }
                        : { className: 'future', label: 'Future path' };
                  return (
                    <div className="path-row" key={index}>
                      <div className="path-input-wrap">
                        <Icon name="folder" size={17} />
                        <input className="text-input path-input" maxLength={1000} value={source.path} onChange={event => updateSource(index, event.target.value)} placeholder="\\\\192.168.33.27\\ShareName\\Incoming" aria-label={`Source folder ${index + 1}`} autoComplete="off" spellCheck={false} />
                        {state && <span className={`path-state ${state.className}`}>{state.label}</span>}
                      </div>
                      <button type="button" className="button subtle browse-button" onClick={() => browseFolder('source', index)} disabled={browsing !== null}>{browsing === `source-${index}` ? 'Selecting…' : 'Browse folders'}</button>
                      {form.sources.length > 1 && <button type="button" className="icon-button danger-soft" onClick={() => removeSource(index)} aria-label="Remove source"><Icon name="close" size={16} /></button>}
                    </div>
                  );
                })}
              </div>
              <div className="path-help">Network example: \\192.168.33.27\ShareName\folder.</div>
              <label className="toggle-row">
                <span><strong>Require every source</strong><small>Fail safely instead of producing an incomplete collection.</small></span>
                <input type="checkbox" checked={form.options.requireAllSources} onChange={event => update('options.requireAllSources', event.target.checked)} />
                <i />
              </label>
            </div>
          </section>

          <section className="form-section">
            <div className="section-number">03</div>
            <div className="section-content">
              <h3>Destination</h3>
              <p>Source contents are merged directly into this folder without source or run wrappers.</p>
              <div className="path-row destination-input">
                <div className="path-input-wrap">
                  <Icon name="arrow" size={17} />
                  <input className="text-input path-input" maxLength={1000} value={form.destination.path} onChange={event => { update('destination.path', event.target.value); setPathResults([]); }} placeholder="\\\\192.168.33.27\\ShareName\\Collections\\Monday" aria-label="Destination folder" autoComplete="off" spellCheck={false} />
                  {destinationState && <span className={`path-state ${destinationState.className}`}>{destinationState.label}</span>}
                </div>
                <button type="button" className="button subtle browse-button" onClick={() => browseFolder('destination')} disabled={browsing !== null}>{browsing === 'destination' ? 'Selecting…' : 'Browse folders'}</button>
              </div>
              <div className="retention-box">
                <label className="toggle-row compact">
                  <span><strong>Automatic cleanup</strong><small>Remove the managed output folder after this run.</small></span>
                  <input type="checkbox" checked={form.retention.enabled} onChange={event => update('retention.enabled', event.target.checked)} />
                  <i />
                </label>
                {form.retention.enabled && (
                  <div className="inline-fields">
                    <span>Delete after</span>
                    <input className="text-input number-input" type="number" min="1" max="365" value={form.retention.value} onChange={event => update('retention.value', Number(event.target.value))} />
                    <select className="select-input" value={form.retention.unit} onChange={event => update('retention.unit', event.target.value)}>
                      <option value="hours">hours</option><option value="days">days</option><option value="weeks">weeks</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="section-number">04</div>
            <div className="section-content">
              <h3>Schedule</h3>
              <div className="schedule-types">
                {['once', 'daily', 'weekly', 'monthly', 'interval'].map(type => (
                  <button type="button" key={type} className={form.schedule.type === type ? 'active' : ''} onClick={() => changeScheduleType(type)} aria-pressed={form.schedule.type === type}>{type}</button>
                ))}
              </div>
              <div className="schedule-fields">
                {form.schedule.type === 'once' && <label><span>Date</span><input className="text-input" type="date" min={today()} value={form.schedule.date || tomorrow()} onChange={event => update('schedule.date', event.target.value)} /></label>}
                {form.schedule.type === 'weekly' && (
                  <div className="weekday-field">
                    <span>Days</span>
                    <div className="weekday-picker">{weekdays.map(day => <button type="button" key={day.value} className={form.schedule.weekdays?.includes(day.value) ? 'selected' : ''} onClick={() => toggleWeekday(day.value)} aria-pressed={form.schedule.weekdays?.includes(day.value)}>{day.label}</button>)}</div>
                  </div>
                )}
                {form.schedule.type === 'monthly' && <label><span>Day of month</span><input className="text-input number-input-wide" type="number" min="1" max="31" value={form.schedule.dayOfMonth || 1} onChange={event => update('schedule.dayOfMonth', Number(event.target.value))} /></label>}
                {form.schedule.type === 'interval' && (
                  <label><span>Repeat every</span><div className="split-input"><input className="text-input number-input-wide" type="number" min="1" max="365" value={form.schedule.intervalValue || 1} onChange={event => update('schedule.intervalValue', Number(event.target.value))} /><select className="select-input" value={form.schedule.intervalUnit || 'days'} onChange={event => update('schedule.intervalUnit', event.target.value)}><option value="hours">hours</option><option value="days">days</option></select></div></label>
                )}
                {form.schedule.type !== 'interval' && <label><span>Time</span><input className="text-input" type="time" value={form.schedule.time || '10:00'} onChange={event => update('schedule.time', event.target.value)} /></label>}
              </div>
            </div>
          </section>

          <section className="form-section final-options">
            <div className="section-number">05</div>
            <div className="section-content">
              <h3>Copy integrity</h3>
              <div className="option-grid">
                <label className="check-row"><input type="checkbox" checked={form.options.includeHidden} onChange={event => update('options.includeHidden', event.target.checked)} /><span><Icon name="check" size={14} /> Include dot-prefixed items</span></label>
                <label className="check-row"><input type="checkbox" checked={form.options.preserveTimestamps} onChange={event => update('options.preserveTimestamps', event.target.checked)} /><span><Icon name="check" size={14} /> Preserve timestamps</span></label>
                <label className="check-row"><input type="checkbox" checked={form.options.verifyAfterCopy} onChange={event => update('options.verifyAfterCopy', event.target.checked)} /><span><Icon name="check" size={14} /> Verify file sizes</span></label>
              </div>
            </div>
          </section>
        </div>

        <footer className="modal-footer">
          <div>{error && <span className="form-error"><Icon name="alert" size={15} /> {error}</span>}</div>
          <div className="footer-actions">
            <button type="button" className="button subtle" onClick={inspect} disabled={checking}>{checking ? 'Checking…' : 'Check paths'}</button>
            <button type="submit" className="button primary" disabled={saving || !valid}>{saving ? 'Saving…' : task ? 'Save changes' : 'Create automation'} <Icon name="arrow" size={16} /></button>
          </div>
        </footer>
      </form>
    </div>
    {networkPicker && (
      <NetworkFolderPicker
        initialPath={networkPickerInitialPath}
        onClose={() => setNetworkPicker(null)}
        onSelect={selectNetworkFolder}
      />
    )}
    </>
  );
}
