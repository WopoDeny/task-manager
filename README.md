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

Task Manager runs on the computer where `START.bat` is launched and automatically listens on its available local network addresses. At startup, the console displays addresses such as `http://192.168.33.45:3707`. Other computers on the same Ethernet network use one of those displayed addresses and the access key stored in `data\access-key.txt`.

The address `192.168.33.27` is treated as a separate file server, not as the Task Manager address. Browse to it in Windows Explorer or use a UNC path such as `\\192.168.33.27\ShareName\folder`. Replace `ShareName` with the actual shared-folder name.

Allow Node.js through Windows Firewall only on private networks. Never expose port `3707` to the public internet.

## Task behavior

- A task can include up to 50 source folders.
- A source path can be entered before that folder exists.
- On the Task Manager computer, the Browse folders button opens the native Windows folder picker for local and network folders.
- On every other computer, the same button opens the built-in network folder browser. Users can browse shared folders on `\\192.168.33.27`, select a source or destination, and then edit the selected path normally.
- UNC paths are supported, for example `\\192.168.33.27\ShareName\folder`. Select an existing network base folder and append a future subfolder directly in the editable path field.
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

The Windows account running Task Manager must have permission to read every network source, create the destination, and remove generated output. Store the network credentials in Windows before enabling unattended execution.

## Environment settings

- `TASK_MANAGER_PORT`: HTTP port. Default: `3707`.
- `TASK_MANAGER_HOST`: bind address. Default: `0.0.0.0`.
- `TASK_MANAGER_DATA_DIR`: task and history directory. Default: `data`.
- `TASK_MANAGER_NETWORK_ROOTS`: network locations visible in the built-in folder browser. Default: `\\192.168.33.27`. Separate multiple approved UNC roots with semicolons, for example `\\192.168.33.27\Documents;\\192.168.33.27\Archive`.

Back up the `data` folder to preserve tasks, run history, the cleanup queue, and the local network access key.

If the native folder picker does not appear, make sure Task Manager is opened at `http://127.0.0.1:3707` on the computer running `START.bat`. Stop older background instances with `STOP.bat` before starting it again.
