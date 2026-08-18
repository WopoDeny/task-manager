import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, json, setAccessKey } from './lib/api.js';
import { formatBytes, formatDate, formatRelative, scheduleText, statusLabel } from './lib/format.js';
import { Icon } from './components/Icon.jsx';
import { TaskForm } from './components/TaskForm.jsx';

const navItems = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'activity', label: 'Activity', icon: 'activity' }
];

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status || 'idle'}`}><i />{statusLabel(status || 'idle')}</span>;
}

function EmptyState({ title, text, onCreate }) {
  return (
    <div className="empty-state">
      <div className="empty-orbit"><Icon name="folder" size={30} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      {onCreate && <button className="button primary" onClick={onCreate}><Icon name="plus" size={16} /> Create automation</button>}
    </div>
  );
}

function Login({ onAuthenticated }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setChecking(true);
    setError('');
    try {
      await api('/api/public/auth', { method: 'POST', body: json({ key: key.trim() }) });
      setAccessKey(key.trim());
      onAuthenticated();
    } catch {
      setError('The access key is not valid.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="login-page">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark large-mark"><span /><span /><span /></div>
        <h1>Connect to Task Manager</h1>
        <p>Enter the access key shown on the server computer.</p>
        <label className="field-label" htmlFor="access-key">Access key</label>
        <div className="login-input"><Icon name="key" /><input id="access-key" value={key} onChange={event => setKey(event.target.value.toUpperCase())} placeholder="SERVER ACCESS KEY" autoFocus /></div>
        {error && <span className="form-error"><Icon name="alert" size={15} />{error}</span>}
        <button className="button primary full" disabled={!key.trim() || checking}>{checking ? 'Connecting…' : 'Connect'}<Icon name="arrow" size={16} /></button>
      </form>
    </main>
  );
}

function Overview({ dashboard, openTasks, openCreate }) {
  const stats = dashboard?.stats || {};
  const tasks = dashboard?.tasks || [];
  const recentRuns = dashboard?.recentRuns || [];
  const runningIds = dashboard?.runningTaskIds || [];
  return (
    <>
      <section className="hero-panel">
        <div>
          <h1>Work moves<br />on schedule.</h1>
          <p>Collect folders, preserve their structure, and clear generated outputs without manual work.</p>
          <div className="hero-actions">
            <button className="button primary" onClick={openCreate}><Icon name="plus" size={16} /> New automation</button>
            <button className="button ghost" onClick={openTasks}>View all tasks <Icon name="arrow" size={15} /></button>
          </div>
        </div>
        <div className="next-run-visual">
          <div className="orbit orbit-a" /><div className="orbit orbit-b" />
          <div className="pulse-core"><Icon name="clock" size={26} /></div>
          <div className="next-run-card">
            <span>NEXT EXECUTION</span>
            <strong>{dashboard?.nextTask?.name || 'No task scheduled'}</strong>
            <small>{dashboard?.nextTask ? `${formatRelative(dashboard.nextTask.nextRunAt)} · ${formatDate(dashboard.nextTask.nextRunAt)}` : 'Create or enable an automation'}</small>
          </div>
        </div>
      </section>

      <section className="stat-grid">
        <article className="stat-card"><span>Active tasks</span><strong>{stats.activeTasks || 0}</strong><small>{stats.totalTasks || 0} total</small></article>
        <article className="stat-card accent"><span>Running now</span><strong>{stats.running || 0}</strong><small>{stats.running ? 'Copying files' : 'Ready'}</small></article>
        <article className="stat-card"><span>Pending cleanup</span><strong>{stats.pendingCleanups || 0}</strong><small>Protected outputs</small></article>
        <article className="stat-card"><span>Recent issues</span><strong>{stats.failures || 0}</strong><small>Last 20 executions</small></article>
      </section>

      <section className="content-grid">
        <article className="panel tasks-panel">
          <div className="panel-heading"><h2>Automation queue</h2><button className="text-button" onClick={openTasks}>View all <Icon name="chevron" size={15} /></button></div>
          {!tasks.length ? <EmptyState title="No automations yet" text="Build the first scheduled folder collection." onCreate={openCreate} /> : (
            <div className="compact-task-list">
              {tasks.slice(0, 5).map(task => {
                const running = runningIds.includes(task.id);
                return <div className="compact-task" key={task.id}><div className={`task-symbol ${running ? 'running' : ''}`}><Icon name={running ? 'activity' : 'folder'} size={18} /></div><div className="compact-task-main"><strong>{task.name}</strong><span>{scheduleText(task.schedule)}</span></div><div className="compact-task-next"><span>{running ? 'In progress' : task.enabled ? formatRelative(task.nextRunAt) : 'Paused'}</span><small>{task.sources.length} source{task.sources.length === 1 ? '' : 's'}</small></div></div>;
              })}
            </div>
          )}
        </article>
        <article className="panel activity-panel">
          <div className="panel-heading"><h2>Recent activity</h2></div>
          {!recentRuns.length ? <div className="quiet-state">Execution history will appear here.</div> : (
            <div className="activity-feed">{recentRuns.slice(0, 6).map(run => <div className="activity-item" key={run.id}><span className={`activity-dot ${run.status}`}><Icon name={run.status === 'failed' ? 'alert' : run.status === 'running' ? 'refresh' : 'check'} size={13} /></span><div><strong>{run.taskName}</strong><small>{statusLabel(run.status)} · {formatDate(run.startedAt)}</small></div></div>)}</div>
          )}
        </article>
      </section>
    </>
  );
}

function TasksPage({ tasks, runningIds, search, setSearch, onCreate, onEdit, onRun, onCancel, onToggle, onDelete }) {
  const [filter, setFilter] = useState('all');
  const visible = useMemo(() => tasks.filter(task => {
    const matchesSearch = !search || [task.name, task.destination.path, ...task.sources.map(source => source.path)].some(value => value.toLowerCase().includes(search.toLowerCase()));
    const running = runningIds.includes(task.id);
    const matchesFilter = filter === 'all' || (filter === 'running' && running) || (filter === 'active' && task.enabled && !running) || (filter === 'paused' && !task.enabled);
    return matchesSearch && matchesFilter;
  }), [tasks, search, filter, runningIds]);

  return (
    <section className="page-section">
      <div className="page-title-row"><div><h1>Scheduled tasks</h1><p>Sources, destinations, schedules, and retention.</p></div><button className="button primary" onClick={onCreate}><Icon name="plus" size={16} /> New task</button></div>
      <div className="task-toolbar">
        <div className="search-box wide"><Icon name="search" size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search task, source, or destination" aria-label="Search tasks" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><Icon name="close" size={14} /></button>}</div>
        <div className="filter-tabs">{['all', 'active', 'running', 'paused'].map(item => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} aria-pressed={filter === item}>{item}</button>)}</div>
      </div>
      {!visible.length ? <EmptyState title={tasks.length ? 'No matching tasks' : 'No automations yet'} text={tasks.length ? 'Change the search or filter.' : 'Create a reliable folder workflow in a few steps.'} onCreate={!tasks.length ? onCreate : null} /> : (
        <div className="task-table-wrap">
          <div className="task-table-head"><span>Automation</span><span>Schedule</span><span>Destination</span><span>State</span><span /></div>
          {visible.map(task => {
            const running = runningIds.includes(task.id);
            const runStatus = running ? 'running' : task.enabled ? 'active' : 'paused';
            return (
              <article className={`task-row ${running ? 'is-running' : ''}`} key={task.id}>
                <div className="task-identity"><div className="task-symbol"><Icon name="folder" size={18} /></div><div><strong>{task.name}</strong><span>{task.sources.length} source folder{task.sources.length === 1 ? '' : 's'}</span></div></div>
                <div className="task-cell"><strong>{scheduleText(task.schedule)}</strong><span>{task.enabled ? `Next ${formatRelative(task.nextRunAt)}` : 'Schedule paused'}</span></div>
                <div className="task-cell path-cell"><strong title={task.destination.path}>{task.destination.path}</strong><span>{task.retention.enabled ? `Remove after ${task.retention.value} ${task.retention.unit}` : 'Automatic cleanup off'}</span></div>
                <div className="state-cell"><StatusBadge status={runStatus} />{running && <div className="mini-progress"><i /></div>}</div>
                <div className="task-actions">
                  <button className={`icon-button ${running ? 'danger-soft' : 'run-button'}`} onClick={() => running ? onCancel(task) : onRun(task)} aria-label={running ? 'Cancel' : 'Run now'} title={running ? 'Cancel run' : 'Run now'}><Icon name={running ? 'stop' : 'play'} size={16} /></button>
                  <button className="icon-button" onClick={() => onToggle(task)} aria-label={task.enabled ? 'Pause' : 'Enable'} title={task.enabled ? 'Pause schedule' : 'Enable schedule'}><Icon name={task.enabled ? 'pause' : 'refresh'} size={16} /></button>
                  <button className="icon-button" onClick={() => onEdit(task)} disabled={running} aria-label="Edit" title="Edit"><Icon name="edit" size={16} /></button>
                  <button className="icon-button danger-soft" onClick={() => onDelete(task)} disabled={running} aria-label="Delete" title="Delete"><Icon name="trash" size={16} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ActivityPage({ runs, cleanups }) {
  const [tab, setTab] = useState('runs');
  return (
    <section className="page-section">
      <div className="page-title-row"><div><h1>Activity</h1><p>Execution results and cleanup operations.</p></div></div>
      <div className="activity-tabs"><button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')} aria-pressed={tab === 'runs'}>Executions <span>{runs.length}</span></button><button className={tab === 'cleanups' ? 'active' : ''} onClick={() => setTab('cleanups')} aria-pressed={tab === 'cleanups'}>Cleanups <span>{cleanups.length}</span></button></div>
      {tab === 'runs' ? (
        !runs.length ? <EmptyState title="No execution history" text="Run a task to create the first audit record." /> : <div className="history-table"><div className="history-head"><span>Task</span><span>Started</span><span>Data</span><span>Destination</span><span>Result</span></div>{runs.map(run => <div className="history-row" key={run.id}><div><strong>{run.taskName}</strong><span>{run.trigger}</span></div><div><strong>{formatDate(run.startedAt)}</strong><span>{run.finishedAt ? `Finished ${formatDate(run.finishedAt)}` : 'In progress'}</span></div><div><strong>{run.progress?.copiedFiles || run.result?.copiedFiles || 0} files</strong><span>{formatBytes(run.progress?.copiedBytes || run.result?.copiedBytes || 0)}</span></div><div className="history-path"><strong title={run.destination}>{run.destination || '—'}</strong><span>{run.error?.message || (run.result?.missingSources?.length ? `${run.result.missingSources.length} missing source(s)` : run.result?.skippedEntries ? `${run.result.skippedEntries} unsupported item(s) skipped` : 'Verified')}</span></div><StatusBadge status={run.status} /></div>)}</div>
      ) : (
        !cleanups.length ? <EmptyState title="No cleanup records" text="Retention operations will appear after task executions." /> : <div className="history-table cleanup-table"><div className="history-head"><span>Task</span><span>Due</span><span>Output folder</span><span>Attempts</span><span>State</span></div>{cleanups.map(item => <div className="history-row" key={item.id}><div><strong>{item.taskName}</strong><span>{item.runId.slice(0, 8)}</span></div><div><strong>{formatDate(item.dueAt)}</strong><span>{formatRelative(item.dueAt)}</span></div><div className="history-path"><strong title={item.path}>{item.path}</strong><span>{item.lastError || 'Ownership protected'}</span></div><div><strong>{item.attempts}</strong><span>of 5</span></div><StatusBadge status={item.status} /></div>)}</div>
      )}
    </section>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(null);
  const [page, setPage] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [runs, setRuns] = useState([]);
  const [cleanups, setCleanups] = useState([]);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState(null);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [toast, setToast] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState(new Date());

  const notify = useCallback((message, type = 'info') => {
    setToast({ message, type, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3_500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!deleteCandidate) return undefined;
    const closeOnEscape = event => {
      if (event.key === 'Escape') setDeleteCandidate(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleteCandidate]);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const [dashboardData, taskData, runData, cleanupData] = await Promise.all([
        api('/api/dashboard'), api('/api/tasks'), api('/api/runs?limit=150'), api('/api/cleanups')
      ]);
      setDashboard(dashboardData);
      setTasks(taskData.tasks);
      setRuns(runData.runs);
      setCleanups(cleanupData.cleanups);
      setAuthenticated(true);
    } catch (error) {
      if (error.status === 401) setAuthenticated(false);
      else if (!quiet) notify(error.message, 'error');
    }
  }, [notify]);

  useEffect(() => {
    api('/api/public/status').then(status => {
      if (status.authenticated) refresh();
      else setAuthenticated(false);
    }).catch(() => notify('Cannot connect to Task Manager.', 'error'));
  }, [refresh, notify]);

  useEffect(() => {
    if (!authenticated) return;
    const polling = setInterval(() => refresh(true), 3_000);
    const time = setInterval(() => setClock(new Date()), 30_000);
    return () => { clearInterval(polling); clearInterval(time); };
  }, [authenticated, refresh]);

  async function action(path, success, method = 'POST') {
    try {
      await api(path, { method });
      notify(success, 'success');
      await refresh(true);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function deleteTask(task) {
    setDeleteCandidate(task);
  }

  async function confirmDelete() {
    const task = deleteCandidate;
    setDeleteCandidate(null);
    if (task) await action(`/api/tasks/${task.id}`, 'Task deleted.', 'DELETE');
  }

  if (authenticated === false) return <Login onAuthenticated={() => refresh()} />;
  if (authenticated === null || !dashboard) return <div className="loading-screen"><div className="loading-mark"><span /><span /><span /></div><small>STARTING TASK MANAGER</small></div>;

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand"><div className="brand-mark"><span /><span /><span /></div><strong>Task Manager</strong></div>
        <nav>{navItems.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setMenuOpen(false); }}><Icon name={item.icon} size={18} /><span>{item.label}</span>{item.id === 'activity' && dashboard.stats.running > 0 && <i className="nav-count">{dashboard.stats.running}</i>}</button>)}</nav>
        <button className="sidebar-create" onClick={() => setEditor({ mode: 'create' })}><Icon name="plus" size={17} /> New automation</button>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMenuOpen(value => !value)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}><span /><span /><span /></button>
          <div className="topbar-search search-box"><Icon name="search" size={16} /><input value={search} onChange={event => setSearch(event.target.value)} onFocus={() => setPage('tasks')} placeholder="Search automations" aria-label="Search automations" /></div>
          <div className="topbar-meta"><div className="time-block"><strong>{clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</strong><span>{clock.toLocaleDateString('en-GB', { month: 'short', day: '2-digit' })}</span></div><button className="icon-button" onClick={() => refresh()} title="Refresh" aria-label="Refresh data"><Icon name="refresh" size={16} /></button></div>
        </header>

        <div className="page-content">
          {page === 'overview' && <Overview dashboard={dashboard} openTasks={() => setPage('tasks')} openCreate={() => setEditor({ mode: 'create' })} />}
          {page === 'tasks' && <TasksPage tasks={tasks} runningIds={dashboard.runningTaskIds} search={search} setSearch={setSearch} onCreate={() => setEditor({ mode: 'create' })} onEdit={task => setEditor({ mode: 'edit', task })} onRun={task => action(`/api/tasks/${task.id}/run`, 'Execution started.')} onCancel={task => action(`/api/tasks/${task.id}/cancel`, 'Cancellation requested.')} onToggle={task => action(`/api/tasks/${task.id}/toggle`, task.enabled ? 'Schedule paused.' : 'Schedule enabled.')} onDelete={deleteTask} />}
          {page === 'activity' && <ActivityPage runs={runs} cleanups={cleanups} />}
        </div>
      </main>

      {editor && <TaskForm task={editor.task} onClose={() => setEditor(null)} onSaved={() => refresh(true)} notify={notify} />}
      {deleteCandidate && (
        <div className="confirm-shell" role="dialog" aria-modal="true" aria-labelledby="delete-task-title">
          <button className="modal-backdrop" onClick={() => setDeleteCandidate(null)} aria-label="Close" />
          <div className="confirm-card">
            <div className="confirm-icon"><Icon name="trash" size={19} /></div>
            <h2 id="delete-task-title">Delete task?</h2>
            <p>“{deleteCandidate.name}” will be removed. Existing output cleanup records will remain active.</p>
            <div className="confirm-actions">
              <button className="button subtle" onClick={() => setDeleteCandidate(null)}>Cancel</button>
              <button className="button danger" onClick={confirmDelete}>Delete task</button>
            </div>
          </div>
        </div>
      )}
      {menuOpen && <button className="mobile-overlay" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
      {toast && <div className={`toast ${toast.type}`} key={toast.id} role={toast.type === 'error' ? 'alert' : 'status'}><span>{toast.type === 'success' ? <Icon name="check" size={15} /> : <Icon name="alert" size={15} />}</span>{toast.message}</div>}
    </div>
  );
}
