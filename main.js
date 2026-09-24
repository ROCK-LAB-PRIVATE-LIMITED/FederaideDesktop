const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function runLimactlAsync(args) {
    const limactl = getLimactlPath();
    return new Promise((resolve, reject) => {
        execFile(limactl, args, { env: process.env }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve(stdout ? stdout.trim() : '');
        });
    });
}

let mainWindow;
let pythonProcess;
let novncWindow = null;
let usingLima = false;

const LIMA_HOME = path.join(os.homedir(), '.f-lima');
process.env.LIMA_HOME = LIMA_HOME;

function getLimactlPath() {
    const platform = process.platform;
    const arch = process.arch;
    const binaryName = platform === 'win32' ? 'limactl.exe' : 'limactl';

    const candidates = [
        path.join(process.resourcesPath, 'bin', `${platform}-${arch}`, 'bin', binaryName),
        path.join(process.resourcesPath, 'bin', `${platform}-${arch}`, binaryName),
        path.join(process.resourcesPath, 'bin', binaryName),
        path.join(__dirname, 'resources', 'bin', `${platform}-${arch}`, 'bin', binaryName),
        path.join(__dirname, 'resources', 'bin', `${platform}-${arch}`, binaryName),
        path.join(__dirname, '..', 'resources', 'bin', `${platform}-${arch}`, 'bin', binaryName)
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            // Prepend the folder containing limactl & qemu-img to PATH
            const binDir = path.dirname(p);
            const pathSep = process.platform === 'win32' ? ';' : ':';
            if (!process.env.PATH || !process.env.PATH.includes(binDir)) {
                process.env.PATH = `${binDir}${pathSep}${process.env.PATH || ''}`;
            }
            return p;
        }
    }

    throw new Error(`limactl binary not found inside app bundle. Checked:\n` + candidates.join('\n'));
}

function toGuestPath(p) {
    if (process.platform === 'win32') {
        const resolved = path.resolve(p);
        const match = resolved.match(/^([a-zA-Z]):[\\/](.*)$/);
        if (match) {
            const drive = match[1].toLowerCase();
            const rest = match[2].replace(/\\/g, '/');
            return `/${drive}/${rest}`;
        }
        return resolved.replace(/\\/g, '/');
    }
    return p;
}

function getResourceAsset(subpath) {
    const candidates = [
        path.join(process.resourcesPath, subpath),
        path.join(__dirname, 'resources', subpath),
        path.join(__dirname, '..', 'resources', subpath)
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return path.join(process.resourcesPath, subpath);
}

function openNoVncWindow(url = 'http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale&quality=9&compression=0') {
    if (novncWindow && !novncWindow.isDestroyed()) {
        novncWindow.focus();
        return;
    }
    novncWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        title: 'FEDERaiDE Display',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        backgroundColor: '#060709',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    novncWindow.loadURL(url);
    novncWindow.on('closed', () => {
        novncWindow = null;
        // Cleanly close only the actual application window using a targeted Python script to avoid WM crashes
        const pyScript = `
import subprocess
try:
    out = subprocess.check_output(['xwininfo', '-display', ':1', '-root', '-tree'], text=True)
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith('0x'): continue
        if ' 1x1+' in line or ' 10x10+' in line: continue
        low = line.lower()
        if any(x in low for x in ['"fluxbox"', '"awesome"', '"wibar"', '"desktop"', '"root window"', '"x11vnc"', '"tigervnc"', '"focusproxy"']): continue
        wid = line.split()[0]
        subprocess.run(['xdotool', 'windowclose', wid])
except Exception:
    pass
`;
        const b64 = Buffer.from(pyScript).toString('base64');
        try {
            const { exec } = require('child_process');
            exec(`"${getLimactlPath()}" shell federaide docker exec federaide-sandbox bash -c "echo ${b64} | base64 -d | DISPLAY=:1 python3 -"`, { env: process.env });
        } catch (e) {}
    });
}



function createWindow() {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');

    if (process.platform === 'darwin' && app.dock) {
        try {
            app.dock.setIcon(iconPath);
        } catch (e) {}
    }

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: iconPath,
        backgroundColor: '#060709',
        show: true, // Paint window immediately so UI is hot
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        }
    });

    mainWindow.loadFile('index.html');

    // Prevent in-app navigation and route external links
    mainWindow.webContents.setWindowOpenHandler((details) => {
        try {
            const parsed = new URL(details.url);
            if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
                shell.openExternal(details.url);
            }
        } catch (e) {}
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url !== mainWindow.webContents.getURL()) {
            event.preventDefault();
            try {
                const parsed = new URL(url);
                if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
                    shell.openExternal(url);
                }
            } catch (e) {}
        }
    });

    function broadcastStatus(statusText) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('startup-status', statusText);
            mainWindow.webContents.send('python-message', {
                type: 'system_status',
                message: statusText
            });
        }
    }

    async function startBackendAsync() {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            
            // 1. Auto-detect missing Virtualization features (GuestCommunicationServices key)
            try {
                execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Virtualization\\GuestCommunicationServices"', { stdio: 'ignore' });
            } catch (err) {
                const response = dialog.showMessageBoxSync(mainWindow || null, {
                    type: 'warning',
                    title: 'Windows Virtualization Required',
                    message: 'Windows Hypervisor Platform is not enabled.',
                    detail: 'FEDERaiDE requires hardware virtualization to run its isolated secure environment.\n\nClick "Enable Features" to grant Administrator privileges to turn them on. You will need to restart your PC afterward.',
                    buttons: ['Enable Features', 'Quit']
                });

                if (response === 0) {
                    try {
                        const tempScript = path.join(os.tmpdir(), 'enable-whpx.ps1');
                        fs.writeFileSync(tempScript, 'Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All -NoRestart\nEnable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart\nWrite-Host "`nVirtualization features enabled successfully!" -ForegroundColor Green\nRead-Host "Press ENTER to restart your PC now, or close this window to restart later"\nRestart-Computer');
                        execSync(`powershell -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \\"${tempScript}\\"' -Verb RunAs"`);
                    } catch(e) {}
                }
                app.quit();
                return;
            }

            // 2. Kill any zombie QEMU/Lima processes from previous hard-crashes
            try {
                execSync('powershell -Command "Stop-Process -Name qemu-system-x86_64, limactl -Force -ErrorAction SilentlyContinue"', { stdio: 'ignore' });
            } catch (e) {}
        }

        const home = os.homedir();
        const ws = fs.existsSync(path.join(home, 'Documents', 'FederateWorkspace'))
            ? path.join(home, 'Documents', 'FederateWorkspace')
            : path.join(home, 'FederateWorkspace');
        const configDir = path.join(home, '.federate');

        fs.mkdirSync(ws, { recursive: true });
        fs.mkdirSync(configDir, { recursive: true });
        fs.mkdirSync(LIMA_HOME, { recursive: true });

        // Auto-sync bundled bridge engine and core scripts to ~/.federate
        const pythonScripts = ['electron_bridge.py'];
        for (const script of pythonScripts) {
            const candidates = [
                path.join(__dirname, script),
                path.join(process.resourcesPath, 'app.asar.unpacked', script),
                path.join(process.resourcesPath, script)
            ];
            for (const src of candidates) {
                if (fs.existsSync(src)) {
                    try {
                        fs.copyFileSync(src, path.join(configDir, script));
                    } catch (_) {}
                    break;
                }
            }
        }

        const limactl = getLimactlPath();
        
        let yamlFile = 'federaide-nux.yaml';
        if (process.platform === 'win32') yamlFile = 'federaide-win.yaml';
        else if (process.platform === 'darwin') yamlFile = 'federaide-mac.yaml';
        
        const yamlConfig = getResourceAsset(path.join('lima', yamlFile));
        let imageFile = 'federaide-debian.tar.gz';
        if (process.arch === 'arm64' && fs.existsSync(getResourceAsset(path.join('images', 'federaide-debian-arm.tar.gz')))) {
            imageFile = 'federaide-debian-arm.tar.gz';
        }
        const imageTar = getResourceAsset(path.join('images', imageFile));
        const markerFile = path.join(LIMA_HOME, '.initialized');

        broadcastStatus('Checking sandbox environment...');

        // 1. Robust filesystem check for existing VM instance
        const instanceDir = path.join(LIMA_HOME, 'federaide');
        const instanceExists = fs.existsSync(path.join(instanceDir, 'lima.yaml'));

        if (!instanceExists) {
            broadcastStatus('Creating sandbox virtual machine...');
            if (fs.existsSync(instanceDir)) {
                try {
                    await runLimactlAsync(['delete', 'federaide', '--force']);
                } catch (_) {
                    fs.rmSync(instanceDir, { recursive: true, force: true });
                }
            }
            await runLimactlAsync(['create', '--name=federaide', '--tty=false', yamlConfig]);
        }

        // 2. Boot VM asynchronously (30 minute timeout for software emulation fallback)
        broadcastStatus('Booting sandbox hypervisor (software emulation mode)...');
        await runLimactlAsync(['start', 'federaide', '--tty=false', '--timeout=30m']);

        // 3. Load offline image on first boot (stream directly via stdin, bypasses scp.exe)
        if (!fs.existsSync(markerFile) && fs.existsSync(imageTar)) {
            broadcastStatus('Importing container engine image...');
            await new Promise((resolve, reject) => {
                const loadProc = spawn(limactl, ['shell', 'federaide', 'docker', 'load'], {
                    env: process.env,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                let errOut = '';
                loadProc.stderr.on('data', (d) => { errOut += d.toString(); });
                const fileStream = fs.createReadStream(imageTar);
                fileStream.pipe(loadProc.stdin);
                fileStream.on('error', (err) => {
                    loadProc.kill();
                    reject(err);
                });
                loadProc.on('error', reject);
                loadProc.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(errOut || `docker load failed with exit code ${code}`));
                });
            });
            fs.writeFileSync(markerFile, '1');
        }

        // 4. Remove stale container instance
        await runLimactlAsync(['shell', 'federaide', 'docker', 'rm', '-f', 'federaide-sandbox']).catch(() => {});

        // 5. Spawn container with interactive piped I/O
        broadcastStatus('Starting FEDERaiDE engine...');
        const guestWs = toGuestPath(ws);
        const guestConfigDir = toGuestPath(configDir);

        pythonProcess = spawn(limactl, [
            'shell', 'federaide',
            'docker', 'run', '-i',
            '--name', 'federaide-sandbox',
            '--entrypoint', '/entrypoint.sh',
            '-p', '127.0.0.1:6080:6080',
            '-p', '127.0.0.1:6081:6081',
            '-e', 'DISPLAY=:1',
            '-e', 'QT_XCB_GL_INTEGRATION=none',
            '-e', 'XDG_DATA_HOME=/home/federate/.federate/share',
            '-e', 'XDG_CONFIG_HOME=/home/federate/.federate/config',
            '-v', `${guestWs}:/home/federate/FederateWorkspace`,
            '-v', `${guestWs}:/workspace`,
            '-v', `${guestConfigDir}:/home/federate/.federate`,
            'federaide:debian',
            'python3', '-u', '/home/federate/.federate/electron_bridge.py'
        ], {
            env: { ...process.env, PYTHONUNBUFFERED: "1" }
        });

        pythonProcess.on('error', (err) => {
            console.error("[Python Launch Error]:", err);
        });

        let backendMissingHandled = false;
        let isAppQuitting = false;
        let stdoutBuffer = '';

        app.on('before-quit', () => {
            isAppQuitting = true;
        });

        pythonProcess.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop();

            for (let line of lines) {
                if (line.trim()) {
                    try {
                        const msg = JSON.parse(line);
                        if (msg.type === "backend_missing") {
                            backendMissingHandled = true;
                            dialog.showMessageBoxSync(mainWindow || null, {
                                type: 'warning',
                                title: 'FEDERaiDE Backend Required',
                                message: msg.error,
                                detail: msg.instructions,
                                buttons: ['OK']
                            });
                            app.quit();
                            return;
                        }
                        if (msg.type === "open_novnc") {
                            openNoVncWindow(msg.url || 'http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=remote');
                            return;
                        }
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('python-message', msg);
                        }
                    } catch (e) {
                        console.log("[Python Output]:", line);
                    }
                }
            }
        });

        let pythonStderr = '';
        pythonProcess.stderr.on('data', (data) => {
            pythonStderr += data.toString();
            console.error(`[Python Error]: ${data}`);
        });

        pythonProcess.on('close', (code) => {
            console.log(`Python process exited with code ${code}`);
            if (!backendMissingHandled && code !== 0 && !isAppQuitting) {
                dialog.showMessageBoxSync(mainWindow || null, {
                    type: 'error',
                    title: 'Engine Sandbox Error',
                    message: `The FEDERaiDE sandboxed engine exited unexpectedly (code ${code}).`,
                    detail: pythonStderr || 'No stderr output captured.',
                    buttons: ['Quit']
                });
            }
            app.quit();
        });
    }

    // Launch the VM & container asynchronously once the UI window is loaded
    mainWindow.webContents.on('did-finish-load', () => {
        startBackendAsync().catch((err) => {
            console.error("[Sandbox Startup Failed]:", err);
            dialog.showMessageBoxSync(mainWindow || null, {
                type: 'error',
                title: 'Sandbox Startup Failure',
                message: 'Failed to initialize the isolated environment.',
                detail: err.message || String(err),
                buttons: ['Quit']
            });
            app.quit();
        });
    });
}

app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('will-quit', () => {
    if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.kill();
    }
    // Cleanly halt the microVM hypervisor on exit
    try {
        const { execFileSync } = require('child_process');
        const limactl = getLimactlPath();
        try {
            execFileSync(limactl, ['shell', 'federaide', 'docker', 'stop', '-t', '1', 'federaide-sandbox'], { env: process.env, stdio: 'ignore', timeout: 3000 });
        } catch (_) {}
        execFileSync(limactl, ['stop', 'federaide', '--force'], { env: process.env, stdio: 'ignore', timeout: 5000 });
        
        // Failsafe: aggressively kill the hypervisor if it hangs
        if (process.platform === 'win32') {
            execFileSync('powershell', ['-Command', 'Stop-Process -Name qemu-system-x86_64, limactl -Force -ErrorAction SilentlyContinue'], { stdio: 'ignore', timeout: 3000 });
        }
    } catch (_) {}
});

ipcMain.on('send-to-python', (event, payload) => {
    if (pythonProcess && pythonProcess.stdin && !pythonProcess.killed) {
        pythonProcess.stdin.write(JSON.stringify(payload) + '\n');
    }
});

ipcMain.on('open-directory-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        if (pythonProcess && pythonProcess.stdin) {
            pythonProcess.stdin.write(JSON.stringify({ action: "set_directory", path: result.filePaths[0] }) + '\n');
        }
    }
});

ipcMain.on('open-external', (event, url) => {
    if (url && typeof url === 'string') {
        try {
            const parsed = new URL(url);
            if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
                shell.openExternal(url);
            }
        } catch (e) {}
    }
});

ipcMain.on('open-novnc', (event, url) => {
    openNoVncWindow(url);
});