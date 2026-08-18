# Task Manager

Task Manager is an offline-first application for collecting folders automatically on a schedule. It runs without Docker and requires no internet connection after preparation.

## Preparation

On a computer with internet access:

1. Install Node.js 22.12 or newer.
2. Run `PREPARE.bat`.
3. After the build finishes, copy the entire project folder to the offline computer, including the generated `node_modules` and `dist` folders.

On the offline computer:

1. Install Node.js 22.12 or newer from a previously downloaded installer.
2. Run `START.bat`.
3. Open `http://127.0.0.1:3707`.

Run `ENABLE_AUTOSTART.bat` to start Task Manager in the background when Windows signs in. Run `DISABLE_AUTOSTART.bat` to remove autostart. Use `STOP.bat` to stop the service manually.

## Local network access

At startup, the service displays the available local network addresses and the access key. The same key is stored in `data\access-key.txt`. From another computer on the same network, open an address such as `http://192.168.1.20:3707` and enter the key.

Allow Node.js through Windows Firewall only on private networks. Never expose port `3707` to the public internet.

## Task behavior

- A task can include up to 50 source folders.
- A source path can be entered before that folder exists.
- Existing folders can be selected with the native Windows folder picker instead of typing long paths. The dialog opens on the computer running Task Manager and is available from its local browser session.
- One-time, daily, weekly, monthly, and interval schedules are supported.
- The selected destination is created when execution starts, or an existing empty destination can be used.
- Files and folders from every source are merged directly into the destination. No source or run wrapper folders are created.
- Directories with the same relative path are merged. A conflicting file path stops execution safely before the destination is created or claimed.
- In strict mode, a missing source stops execution before the destination is created.
- Copied file sizes are verified and original modification timestamps are preserved.
- Nested symbolic links, junctions, and unsupported filesystem entries are skipped to prevent loops and are reported as execution warnings.
- A generated destination can be removed automatically after the configured retention period.
- If the service is offline at the scheduled time, the overdue task runs after the service starts again.
- After an interrupted restart, completed output is recovered from its manifest. Incomplete output is removed safely before a retry.

## Data protection

Task Manager never overwrites a non-empty destination folder. It can claim an existing empty folder by writing an ownership manifest before copying. Automatic cleanup is allowed only when that manifest matches the exact task and run. Drive roots, network share roots, and destinations that overlap a source are rejected. Existing parent paths are resolved before execution so junctions and symbolic links cannot bypass overlap protection.

Use UNC paths for network folders, for example `\\server\share\folder`. The Windows account running Task Manager must have permission to read every source, create the destination, and remove generated output.

## Environment settings

- `TASK_MANAGER_PORT`: HTTP port. Default: `3707`.
- `TASK_MANAGER_HOST`: bind address. Default: `0.0.0.0`.
- `TASK_MANAGER_DATA_DIR`: task and history directory. Default: `data`.

Back up the `data` folder to preserve tasks, run history, the cleanup queue, and the local network access key.
