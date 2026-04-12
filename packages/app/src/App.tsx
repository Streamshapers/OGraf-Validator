import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

declare const __APP_VERSION__: string;
import { FolderOpen } from 'lucide-react';
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import { validatePackage } from '@streamshapers/ograf-validator-core';
import { scanPackages, type PackageEntry } from './scanner/scan-packages.js';
import { BrowserFS } from './fs/browser-fs.js';
import { saveDirectoryHandle, loadDirectoryHandle } from './fs/persist-handle.js';
import { usePreviewSW } from './preview/use-preview-sw.js';
import { useSettings } from './settings/use-settings.js';
import { filterValidationResult } from './settings/filter-results.js';
import { useFileWatcher } from './fs/use-file-watcher.js';
import { runRuntimeTest } from './preview/run-runtime-test.js';
import { buildImportUrl } from './preview/use-preview-sw.js';
import Sidebar from './components/Sidebar.js';
import ContentArea, { type PackageCache } from './components/ContentArea.js';
import SettingsPanel from './components/SettingsPanel.js';
import StatusBar from './components/StatusBar.js';

interface AppState {
    rootHandle: FileSystemDirectoryHandle | null;
    rootName: string | null;
    packages: PackageEntry[];
    isScanning: boolean;
    selectedPackage: PackageEntry | null;
    packageCache: Record<string, PackageCache>;
    isValidating: boolean;
    validationError: string | null;
    view: 'packages' | 'settings';
}

const INITIAL_STATE: AppState = {
    rootHandle: null,
    rootName: null,
    packages: [],
    isScanning: false,
    selectedPackage: null,
    packageCache: {},
    isValidating: false,
    validationError: null,
    view: 'packages',
};

type RuntimeQueueItem = { entry: PackageEntry; manifest: unknown };

export default function App() {
    const [state, setState] = useState<AppState>(INITIAL_STATE);
    const [lastScan, setLastScan] = useState<Date | null>(null);
    const [settings, updateSettings] = useSettings();

    // ─── Runtime test queue ───────────────────────────────────────────────────
    const runtimeQueueRef = useRef<RuntimeQueueItem[]>([]);
    const runtimeDrainingRef = useRef(false);
    /** Paths that have a completed or in-progress runtime test — never stale unlike state */
    const runtimeTestedRef = useRef<Set<string>>(new Set());

    const drainRuntimeQueue = useCallback(async () => {
        if (runtimeDrainingRef.current) return;
        runtimeDrainingRef.current = true;
        while (runtimeQueueRef.current.length > 0) {
            const item = runtimeQueueRef.current.shift()!;
            const { entry, manifest } = item;
            const main = (manifest as Record<string, unknown>)['main'];
            if (typeof main !== 'string') continue;
            try {
                const importUrl = buildImportUrl(main);
                const rtResult = await runRuntimeTest(importUrl, manifest, entry.dirHandle, (step) => {
                    setState((prev) => {
                        const existing = prev.packageCache[entry.path];
                        if (!existing) return prev;
                        return {
                            ...prev,
                            packageCache: {
                                ...prev.packageCache,
                                [entry.path]: {
                                    ...existing,
                                    runtimeTestSteps: [...(existing.runtimeTestSteps ?? []), step],
                                },
                            },
                        };
                    });
                });
                setState((prev) => {
                    const existing = prev.packageCache[entry.path];
                    if (!existing) return prev;
                    return {
                        ...prev,
                        packageCache: {
                            ...prev.packageCache,
                            [entry.path]: { ...existing, runtimeTest: rtResult, runtimeTestRunning: false, runtimeTestSteps: undefined },
                        },
                    };
                });
            } catch {
                setState((prev) => {
                    const existing = prev.packageCache[entry.path];
                    if (!existing) return prev;
                    return {
                        ...prev,
                        packageCache: {
                            ...prev.packageCache,
                            [entry.path]: { ...existing, runtimeTestRunning: false, runtimeTestSteps: undefined },
                        },
                    };
                });
            }
        }
        runtimeDrainingRef.current = false;
    }, []);

    const enqueueRuntimeTest = useCallback((entry: PackageEntry, manifest: unknown, priority = false) => {
        // Mark as tested immediately so any concurrent selectPackage call won't re-enqueue
        runtimeTestedRef.current.add(entry.path);
        // Remove any existing entry for this path (avoid duplicates)
        runtimeQueueRef.current = runtimeQueueRef.current.filter((i) => i.entry.path !== entry.path);
        if (priority) {
            runtimeQueueRef.current.unshift({ entry, manifest });
        } else {
            runtimeQueueRef.current.push({ entry, manifest });
        }
        void drainRuntimeQueue();
    }, [drainRuntimeQueue]);

    // Apply theme class to <html>
    useEffect(() => {
        const el = document.documentElement;
        el.classList.remove('theme-light', 'theme-system');
        if (settings.theme === 'light') el.classList.add('theme-light');
        if (settings.theme === 'system') el.classList.add('theme-system');
    }, [settings.theme]);

    // Register preview SW once for the entire app lifetime
    const { swReady, resetSW } = usePreviewSW(state.selectedPackage?.dirHandle ?? null);

    const loadDirectory = useCallback(async (dirHandle: FileSystemDirectoryHandle) => {
        try { localStorage.setItem('ograf-last-directory', dirHandle.name); } catch { /* quota */ }
        void saveDirectoryHandle(dirHandle);

        setState((prev) => ({
            ...prev,
            rootHandle: dirHandle,
            rootName: dirHandle.name,
            packages: [],
            isScanning: true,
            selectedPackage: null,
            packageCache: {},
            validationError: null,
        }));

        try {
            const found = await scanPackages(dirHandle, '', 0, settings.scanDepth);
            setState((prev) => ({ ...prev, packages: found, isScanning: false }));

            // Phase 1: static validation for all packages in parallel
            await Promise.all(
                found.map(async (entry) => {
                    try {
                        const fs = new BrowserFS(entry.dirHandle);
                        const manifestText = await fs.readFile(entry.manifestFilename);
                        const manifest: unknown = JSON.parse(manifestText);
                        const [result, assets] = await Promise.all([
                            validatePackage(manifest, fs, entry.manifestFilename),
                            fs.listFiles(),
                        ]);
                        setState((prev) => {
                            // Don't overwrite if the user already triggered validation for this package
                            if (prev.packageCache[entry.path]) return prev;
                            return {
                                ...prev,
                                packageCache: {
                                    ...prev.packageCache,
                                    [entry.path]: {
                                        validationResult: result,
                                        manifest,
                                        previousManifest: undefined,
                                        assets,
                                        runtimeTestRunning: result.valid,
                                    },
                                },
                            };
                        });
                        // Phase 2: enqueue runtime test (background, sequential via shared queue)
                        if (result.valid && typeof (manifest as Record<string, unknown>)['main'] === 'string') {
                            enqueueRuntimeTest(entry, manifest);
                        }
                    } catch {
                        // Silently ignore – the user will see the error when they select the package
                    }
                }),
            );
        } catch (err) {
            console.error('Failed to scan packages', err);
            setState((prev) => ({ ...prev, isScanning: false }));
        }
    }, [settings.scanDepth]);

    const openDirectory = useCallback(async () => {
        let dirHandle: FileSystemDirectoryHandle;
        try {
            dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            if (err instanceof TypeError) {
                alert(
                    'Your browser does not support the File System Access API.\n\n' +
                    'Please use a Chromium-based browser such as Chrome or Edge.',
                );
                return;
            }
            console.error('Failed to open directory', err);
            return;
        }
        void loadDirectory(dirHandle);
    }, [loadDirectory]);

    const reopenLastDirectory = useCallback(async () => {
        try {
            const handle = await loadDirectoryHandle();
            if (!handle) {
                // No persisted handle yet – open normal picker
                void openDirectory();
                return;
            }
            // Same session: permission might already be granted
            const query = (handle as unknown as { queryPermission: (desc: { mode: string }) => Promise<string> }).queryPermission;
            const current = await query.call(handle, { mode: 'read' });
            if (current === 'granted') {
                void loadDirectory(handle);
                return;
            }
            // After browser restart: Chrome shows the picker pre-navigated to the
            // stored directory – user only needs to click "Select" to confirm.
            const request = (handle as unknown as { requestPermission: (desc: { mode: string }) => Promise<string> }).requestPermission;
            const perm = await request.call(handle, { mode: 'read' });
            if (perm === 'granted') {
                void loadDirectory(handle);
            }
            // If denied: do nothing, user can use "Open Directory" manually
        } catch (err) {
            console.error('Failed to reopen last directory', err);
        }
    }, [loadDirectory, openDirectory]);

    const selectPackage = useCallback(async (entry: PackageEntry) => {
        setState((prev) => ({
            ...prev,
            selectedPackage: entry,
            isValidating: true,
            validationError: null,
            view: 'packages',
        }));

        try {
            const fs = new BrowserFS(entry.dirHandle);
            const manifestText = await fs.readFile(entry.manifestFilename);
            const manifest: unknown = JSON.parse(manifestText);

            const [result, assets] = await Promise.all([
                validatePackage(manifest, fs, entry.manifestFilename),
                fs.listFiles(),
            ]);

            // Use ref (always current) — state.packageCache would be stale in this closure
            const alreadyTested = runtimeTestedRef.current.has(entry.path);

            setState((prev) => {
                const existing = prev.packageCache[entry.path];
                return {
                    ...prev,
                    isValidating: false,
                    packageCache: {
                        ...prev.packageCache,
                        [entry.path]: {
                            validationResult: result,
                            manifest,
                            previousManifest: existing?.manifest,
                            assets,
                            // Preserve existing runtime test result; only mark running if we're about to test
                            runtimeTest: existing?.runtimeTest,
                            runtimeTestRunning: result.valid && !alreadyTested,
                        },
                    },
                };
            });
            setLastScan(new Date());

            // Phase 2: enqueue runtime test with priority only if not already tested/queued
            if (result.valid && !alreadyTested && typeof (manifest as Record<string, unknown>)['main'] === 'string') {
                enqueueRuntimeTest(entry, manifest, true);
            }
        } catch (err) {
            const message =
                err instanceof SyntaxError
                    ? `${entry.manifestFilename} is not valid JSON: ${err.message}`
                    : err instanceof Error
                        ? err.message
                        : 'An unknown error occurred.';

            setState((prev) => ({
                ...prev,
                isValidating: false,
                validationError: message,
            }));
        }
    }, []);

    const rerunRuntimeTest = useCallback(() => {
        const entry = state.selectedPackage;
        if (!entry) return;
        const cached = state.packageCache[entry.path];
        if (!cached) return;
        // Remove from tested set so it can be re-enqueued
        runtimeTestedRef.current.delete(entry.path);
        // Clear existing result and mark as running
        setState((prev) => {
            const existing = prev.packageCache[entry.path];
            if (!existing) return prev;
            return {
                ...prev,
                packageCache: {
                    ...prev.packageCache,
                    [entry.path]: { ...existing, runtimeTest: undefined, runtimeTestRunning: true, runtimeTestSteps: undefined },
                },
            };
        });
        enqueueRuntimeTest(entry, cached.manifest, true);
    }, [state.selectedPackage, state.packageCache, enqueueRuntimeTest]);

    // Auto-revalidate: watch selected package for file changes
    useFileWatcher(
        state.selectedPackage?.dirHandle ?? null,
        settings.autoRevalidate,
        settings.revalidateInterval * 1000,
        useCallback(() => {
            if (state.selectedPackage) void selectPackage(state.selectedPackage);
        }, [state.selectedPackage, selectPackage]),
    );

    // Severity filter set (derived from settings)
    const hiddenSet = useMemo(() => new Set(settings.hiddenSeverities), [settings.hiddenSeverities]);

    const currentCache = useMemo(() => {
        const raw = state.selectedPackage != null
            ? (state.packageCache[state.selectedPackage.path] ?? null)
            : null;
        if (!raw || hiddenSet.size === 0) return raw;
        return {
            ...raw,
            validationResult: filterValidationResult(raw.validationResult, hiddenSet),
        };
    }, [state.selectedPackage, state.packageCache, hiddenSet]);

    // Derive validationResults map for the sidebar status dots
    const sidebarResults = useMemo(() => {
        const entries = Object.entries(state.packageCache).map(([k, v]) => [
            k,
            hiddenSet.size > 0 ? filterValidationResult(v.validationResult, hiddenSet) : v.validationResult,
        ] as const);
        return Object.fromEntries(entries) satisfies Record<string, ValidationResult>;
    }, [state.packageCache, hiddenSet]);

    // Derive runtime test progress for status bar
    const runtimeProgress = useMemo(() => {
        const entries = Object.values(state.packageCache);
        const total = entries.filter((e) => e.runtimeTest || e.runtimeTestRunning).length;
        const done = entries.filter((e) => e.runtimeTest && !e.runtimeTestRunning).length;
        return total > 0 ? { done, total } : null;
    }, [state.packageCache]);

    // Derive runtime test results for sidebar
    const sidebarRuntimeResults = useMemo(() => {
        const entries = Object.entries(state.packageCache)
            .filter(([, v]) => v.runtimeTest || v.runtimeTestRunning)
            .map(([k, v]) => [k, { result: v.runtimeTest, running: v.runtimeTestRunning }] as const);
        return Object.fromEntries(entries);
    }, [state.packageCache]);

    return (
        <div className="flex flex-col h-full">
            <header className="flex-shrink-0 h-14 bg-ss-surface-high flex items-center px-4 gap-4 select-none"
                    style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                {/* Left: branding */}
                <div className="flex items-center gap-3 flex-shrink-0">
                    <img src="https://streamshapers.com/logo-light.png" alt="StreamShapers" className="h-6" />
                    <span className="text-ss-outline-variant/60 select-none">|</span>
                    <span className="text-base font-semibold text-ss-on-surface tracking-wide">OGraf Validator</span>
                </div>

                {/* Center: active project */}
                <div className="flex-1 flex justify-center">
                    {state.rootName && (
                        <span className="text-xs font-mono text-ss-on-surface-variant tracking-wide uppercase">
                            Active Project:&nbsp;
                            <span className="text-ss-on-surface">{state.rootName}</span>
                        </span>
                    )}
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                        onClick={openDirectory}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-semibold bg-ss-primary-dark hover:bg-ss-primary-container text-white transition-colors"
                    >
                        <FolderOpen size={15} />
                        Open Directory
                    </button>
                </div>
            </header>

            <div className="flex flex-1 min-h-0">
                <Sidebar
                    rootName={state.rootName}
                    packages={state.packages}
                    selectedPath={state.selectedPackage?.path ?? null}
                    validationResults={sidebarResults}
                    runtimeResults={sidebarRuntimeResults}
                    isScanning={state.isScanning}
                    onOpenDirectory={openDirectory}
                    onSelectPackage={selectPackage}
                    isSettingsActive={state.view === 'settings'}
                    onOpenSettings={() => setState((prev) => ({ ...prev, view: 'settings' }))}
                    onShowOverview={() => setState((prev) => ({ ...prev, selectedPackage: null, view: 'packages' }))}
                />
                {state.view === 'settings' ? (
                    <SettingsPanel
                        settings={settings}
                        onUpdateSettings={updateSettings}
                        onResetSW={resetSW}
                        onClose={() => setState((prev) => ({ ...prev, view: 'packages' }))}
                    />
                ) : (
                    <ContentArea
                        selectedPackage={state.selectedPackage}
                        cache={currentCache}
                        isValidating={state.isValidating}
                        validationError={state.validationError}
                        swReady={swReady}
                        onOpenDirectory={openDirectory}
                        onReopenLastDirectory={reopenLastDirectory}
                        onRerunRuntimeTest={rerunRuntimeTest}

                        rootName={state.rootName}
                        packages={state.packages}
                        packageCache={state.packageCache}
                        isScanning={state.isScanning}
                        onSelectPackage={selectPackage}
                    />
                )}
            </div>
            <StatusBar
                version={`v${__APP_VERSION__}`}
                packageCount={state.packages.length}
                scanDepth={settings.scanDepth}
                errorCount={currentCache?.validationResult.errors.length ?? 0}
                warningCount={currentCache?.validationResult.warnings.length ?? 0}
                infoCount={currentCache?.validationResult.infos.filter((i) => !['PACKAGE_FILE_COUNT', 'PACKAGE_TOTAL_SIZE'].includes(i.code)).length ?? 0}
                specVersion={readSpecVersion(currentCache?.manifest)}
                lastScan={lastScan}
                autoRevalidate={settings.autoRevalidate}
                runtimeProgress={runtimeProgress}
            />
        </div>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readSpecVersion(manifest: unknown): string | undefined {
    if (typeof manifest !== 'object' || manifest === null) return undefined;
    const schema = (manifest as Record<string, unknown>)['$schema'];
    if (typeof schema !== 'string') return undefined;
    const match = schema.match(/ograf\.ebu\.io\/(v\d+(?:\.\d+)*)\//i);
    if (match?.[1]) return `OGRAF ${match[1].toUpperCase()}`;
    return undefined;
}
