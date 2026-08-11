import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

declare const __APP_VERSION__: string;
import { FolderOpen, Menu, RefreshCw } from 'lucide-react';
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import { scanPackages, type PackageEntry } from './scanner/scan-packages.js';
import { BrowserFS } from './fs/browser-fs.js';
import { getPackageDisplayName, loadPackage } from './package-loading.js';
import { saveDirectoryHandle, loadDirectoryHandle } from './fs/persist-handle.js';
import { createPreviewSession, usePreviewSW } from './preview/use-preview-sw.js';
import { useSettings } from './settings/use-settings.js';
import { filterValidationResult } from './settings/filter-results.js';
import { useFileWatcher } from './fs/use-file-watcher.js';
import { runRuntimeTest } from './preview/run-runtime-test.js';
import Sidebar from './components/Sidebar.js';
import ContentArea, { type PackageCache } from './components/ContentArea.js';
import SettingsPanel from './components/SettingsPanel.js';
import StatusBar from './components/StatusBar.js';
import { derivePackageReadiness } from './readiness/package-readiness.js';
import { prioritizeRuntimeQueue } from './runtime-queue.js';

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

type RuntimeQueueItem = { entry: PackageEntry; manifest: unknown; generation: number };

interface ActiveRuntimeTest {
    key: string;
    generation: number;
    controller: AbortController;
}

export default function App() {
    const [state, setState] = useState<AppState>(INITIAL_STATE);
    const [lastScan, setLastScan] = useState<Date | null>(null);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [settings, updateSettings] = useSettings();

    const scanGenerationRef = useRef(0);
    const scanAbortRef = useRef<AbortController | null>(null);
    const validationRequestRef = useRef<Map<string, number>>(new Map());
    const assetListCacheRef = useRef<WeakMap<FileSystemDirectoryHandle, Promise<string[]>>>(new WeakMap());
    const runtimeQueueRef = useRef<RuntimeQueueItem[]>([]);
    const runtimeDrainingRef = useRef(false);
    const runtimeTestedRef = useRef<Set<string>>(new Set());
    const runtimeActiveRef = useRef<ActiveRuntimeTest | null>(null);
    const { swReady, resetSW } = usePreviewSW(state.selectedPackage?.dirHandle ?? null);
    const swReadyRef = useRef(swReady);
    // Keep callback-driven queue decisions in sync with the latest render.
    // The effect below is only responsible for resuming queued work.
    swReadyRef.current = swReady;

    const drainRuntimeQueue = useCallback(async () => {
        if (runtimeDrainingRef.current || !swReadyRef.current) return;
        runtimeDrainingRef.current = true;

        try {
            while (runtimeQueueRef.current.length > 0 && swReadyRef.current) {
                const item = runtimeQueueRef.current.shift();
                if (!item || item.generation !== scanGenerationRef.current) continue;
                const { entry, manifest, generation } = item;
                const main = readManifestMain(manifest);
                if (!main) continue;

                const controller = new AbortController();
                const active: ActiveRuntimeTest = { key: entry.key, generation, controller };
                runtimeActiveRef.current = active;
                setState((prev) => {
                    if (generation !== scanGenerationRef.current) return prev;
                    const existing = prev.packageCache[entry.key];
                    if (!existing) return prev;
                    return {
                        ...prev,
                        packageCache: {
                            ...prev.packageCache,
                            [entry.key]: {
                                ...existing,
                                runtimeTest: undefined,
                                runtimeTestPhase: 'running',
                                runtimeTestSteps: [],
                            },
                        },
                    };
                });

                const session = createPreviewSession(entry.dirHandle);
                try {
                    const runtimeResult = await runRuntimeTest({
                        importUrl: session.buildUrl(main),
                        manifest,
                        dirHandle: entry.dirHandle,
                        sessionId: session.sessionId,
                        signal: controller.signal,
                        onStepComplete: (step) => {
                            if (
                                controller.signal.aborted ||
                                generation !== scanGenerationRef.current ||
                                runtimeActiveRef.current !== active
                            ) return;
                            setState((prev) => {
                                const existing = prev.packageCache[entry.key];
                                if (!existing) return prev;
                                return {
                                    ...prev,
                                    packageCache: {
                                        ...prev.packageCache,
                                        [entry.key]: {
                                            ...existing,
                                            runtimeTestSteps: [...(existing.runtimeTestSteps ?? []), step],
                                        },
                                    },
                                };
                            });
                        },
                    });

                    if (
                        controller.signal.aborted ||
                        generation !== scanGenerationRef.current ||
                        runtimeActiveRef.current !== active
                    ) continue;
                    setState((prev) => {
                        const existing = prev.packageCache[entry.key];
                        if (!existing) return prev;
                        return {
                            ...prev,
                            packageCache: {
                                ...prev.packageCache,
                                [entry.key]: {
                                    ...existing,
                                    runtimeTest: runtimeResult,
                                    runtimeTestPhase: undefined,
                                    runtimeTestSteps: undefined,
                                },
                            },
                        };
                    });
                } catch (error) {
                    if (
                        !controller.signal.aborted &&
                        generation === scanGenerationRef.current &&
                        runtimeActiveRef.current === active
                    ) {
                        const message = readErrorMessage(error);
                        setState((prev) => {
                            const existing = prev.packageCache[entry.key];
                            if (!existing) return prev;
                            return {
                                ...prev,
                                packageCache: {
                                    ...prev.packageCache,
                                    [entry.key]: {
                                        ...existing,
                                        runtimeTest: {
                                            passed: false,
                                            steps: [{ name: 'Runtime harness', status: 'fail', durationMs: 0, error: message }],
                                            totalDurationMs: 0,
                                        },
                                        runtimeTestPhase: undefined,
                                        runtimeTestSteps: undefined,
                                    },
                                },
                            };
                        });
                    }
                } finally {
                    session.close();
                    if (runtimeActiveRef.current === active) runtimeActiveRef.current = null;
                }
            }
        } finally {
            runtimeDrainingRef.current = false;
            if (runtimeQueueRef.current.length > 0 && swReadyRef.current) {
                queueMicrotask(() => void drainRuntimeQueue());
            }
        }
    }, []);

    const enqueueRuntimeTest = useCallback((
        entry: PackageEntry,
        manifest: unknown,
        generation: number,
        priority = false,
    ) => {
        if (generation !== scanGenerationRef.current) return;
        runtimeTestedRef.current.add(entry.key);
        runtimeQueueRef.current = runtimeQueueRef.current.filter((item) => item.entry.key !== entry.key);
        const item: RuntimeQueueItem = { entry, manifest, generation };
        if (priority) {
            runtimeQueueRef.current.unshift(item);
        } else {
            runtimeQueueRef.current.push(item);
        }
        void drainRuntimeQueue();
    }, [drainRuntimeQueue]);

    const prioritizeQueuedRuntimeTest = useCallback((packageKey: string) => {
        runtimeQueueRef.current = prioritizeRuntimeQueue(runtimeQueueRef.current, packageKey);
        void drainRuntimeQueue();
    }, [drainRuntimeQueue]);

    useEffect(() => {
        if (swReady) void drainRuntimeQueue();
    }, [swReady, drainRuntimeQueue]);

    // Apply theme class to <html>
    useEffect(() => {
        const el = document.documentElement;
        el.classList.remove('theme-light', 'theme-system');
        if (settings.theme === 'light') el.classList.add('theme-light');
        if (settings.theme === 'system') el.classList.add('theme-system');
    }, [settings.theme]);

    const getAssetList = useCallback((entry: PackageEntry): Promise<string[]> => {
        const cached = assetListCacheRef.current.get(entry.dirHandle);
        if (cached) return cached;

        const pending = new BrowserFS(entry.dirHandle).listFiles().catch(() => []);
        assetListCacheRef.current.set(entry.dirHandle, pending);
        return pending;
    }, []);

    const validateEntry = useCallback(async (
        entry: PackageEntry,
        generation: number,
        options: { priority?: boolean; forceRuntime?: boolean } = {},
    ): Promise<void> => {
        if (generation !== scanGenerationRef.current) return;
        const requestVersion = (validationRequestRef.current.get(entry.key) ?? 0) + 1;
        validationRequestRef.current.set(entry.key, requestVersion);

        const loaded = await loadPackage(entry, getAssetList(entry));
        if (
            generation !== scanGenerationRef.current ||
            validationRequestRef.current.get(entry.key) !== requestVersion
        ) return;

        const shouldRunRuntime = loaded.validationResult.valid &&
            readManifestMain(loaded.manifest) !== undefined &&
            (options.forceRuntime === true || !runtimeTestedRef.current.has(entry.key));

        if (!loaded.validationResult.valid) {
            runtimeQueueRef.current = runtimeQueueRef.current.filter((item) => item.entry.key !== entry.key);
            runtimeTestedRef.current.delete(entry.key);
            if (runtimeActiveRef.current?.key === entry.key) {
                runtimeActiveRef.current.controller.abort();
            }
        }

        setState((prev) => {
            if (generation !== scanGenerationRef.current) return prev;
            const existing = prev.packageCache[entry.key];
            const siblingCount = prev.packages.filter(
                (candidate) => candidate.directoryPath === entry.directoryPath,
            ).length;
            const displayName = getPackageDisplayName(loaded.manifest, entry, siblingCount);
            const updatedEntry = { ...entry, displayName };
            const previousManifest = existing && !sameJson(existing.manifest, loaded.manifest)
                ? existing.manifest
                : existing?.previousManifest;

            return {
                ...prev,
                selectedPackage: prev.selectedPackage?.key === entry.key
                    ? updatedEntry
                    : prev.selectedPackage,
                packages: prev.packages.map((candidate) =>
                    candidate.key === entry.key ? updatedEntry : candidate,
                ),
                isValidating: prev.selectedPackage?.key === entry.key ? false : prev.isValidating,
                validationError: prev.selectedPackage?.key === entry.key ? null : prev.validationError,
                packageCache: {
                    ...prev.packageCache,
                    [entry.key]: {
                        validationResult: loaded.validationResult,
                        manifest: loaded.manifest,
                        previousManifest,
                        assets: loaded.assets,
                        runtimeTest: shouldRunRuntime || !loaded.validationResult.valid
                            ? undefined
                            : existing?.runtimeTest,
                        runtimeTestPhase: shouldRunRuntime
                            ? 'pending'
                            : loaded.validationResult.valid ? existing?.runtimeTestPhase : undefined,
                        runtimeTestSteps: shouldRunRuntime ? undefined : existing?.runtimeTestSteps,
                    },
                },
            };
        });

        if (shouldRunRuntime) {
            enqueueRuntimeTest(entry, loaded.manifest, generation, options.priority === true);
        }
    }, [enqueueRuntimeTest, getAssetList]);

    const loadDirectory = useCallback(async (
        dirHandle: FileSystemDirectoryHandle,
        options: { preserveSelectionKey?: string } = {},
    ) => {
        scanAbortRef.current?.abort();
        runtimeActiveRef.current?.controller.abort();
        const generation = scanGenerationRef.current + 1;
        scanGenerationRef.current = generation;
        const scanController = new AbortController();
        scanAbortRef.current = scanController;

        runtimeQueueRef.current = [];
        runtimeTestedRef.current.clear();
        validationRequestRef.current.clear();
        assetListCacheRef.current = new WeakMap();

        try { localStorage.setItem('ograf-last-directory', dirHandle.name); } catch { /* quota */ }
        void saveDirectoryHandle(dirHandle);

        setState((prev) => ({
            ...prev,
            rootHandle: dirHandle,
            rootName: dirHandle.name,
            packages: [],
            isScanning: true,
            selectedPackage: options.preserveSelectionKey ? prev.selectedPackage : null,
            packageCache: {},
            validationError: null,
        }));

        try {
            const found = await scanPackages(
                dirHandle,
                '',
                0,
                settings.scanDepth,
                scanController.signal,
            );
            if (generation !== scanGenerationRef.current || scanController.signal.aborted) return;
            setState((prev) => ({
                ...prev,
                packages: found,
                selectedPackage: options.preserveSelectionKey
                    ? (found.find((entry) => entry.key === options.preserveSelectionKey) ?? null)
                    : null,
                isScanning: false,
            }));
            await Promise.all(found.map((entry) => validateEntry(entry, generation, {
                priority: entry.key === options.preserveSelectionKey,
            })));
        } catch (err) {
            if (scanController.signal.aborted || generation !== scanGenerationRef.current) return;
            const message = `Failed to scan packages: ${readErrorMessage(err)}`;
            console.error(message, err);
            setState((prev) => ({ ...prev, isScanning: false, validationError: message }));
        }
    }, [settings.scanDepth, validateEntry]);

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
        const generation = scanGenerationRef.current;
        prioritizeQueuedRuntimeTest(entry.key);
        setState((prev) => ({
            ...prev,
            selectedPackage: entry,
            isValidating: true,
            validationError: null,
            view: 'packages',
        }));

        try {
            await validateEntry(entry, generation, { priority: true });
            setLastScan(new Date());
        } catch (err) {
            if (generation !== scanGenerationRef.current) return;
            const message = readErrorMessage(err);
            setState((prev) => ({
                ...prev,
                isValidating: false,
                validationError: message,
            }));
        }
    }, [prioritizeQueuedRuntimeTest, validateEntry]);

    const rerunRuntimeTest = useCallback(() => {
        const entry = state.selectedPackage;
        if (!entry) return;
        const cached = state.packageCache[entry.key];
        if (!cached || !cached.validationResult.valid || !readManifestMain(cached.manifest)) return;
        const generation = scanGenerationRef.current;
        runtimeQueueRef.current = runtimeQueueRef.current.filter((item) => item.entry.key !== entry.key);
        if (runtimeActiveRef.current?.key === entry.key) runtimeActiveRef.current.controller.abort();
        runtimeTestedRef.current.delete(entry.key);
        setState((prev) => {
            const existing = prev.packageCache[entry.key];
            if (!existing) return prev;
            return {
                ...prev,
                packageCache: {
                    ...prev.packageCache,
                    [entry.key]: {
                        ...existing,
                        runtimeTest: undefined,
                        runtimeTestPhase: 'pending',
                        runtimeTestSteps: undefined,
                    },
                },
            };
        });
        enqueueRuntimeTest(entry, cached.manifest, generation, true);
    }, [state.selectedPackage, state.packageCache, enqueueRuntimeTest]);

    const handleRootDirectoryChange = useCallback(() => {
        const rootHandle = state.rootHandle;
        if (!rootHandle) return;
        void loadDirectory(rootHandle, {
            ...(state.selectedPackage ? { preserveSelectionKey: state.selectedPackage.key } : {}),
        }).then(() => setLastScan(new Date()));
    }, [loadDirectory, state.rootHandle, state.selectedPackage]);

    // Watch the picker root so changed shared assets and added/removed manifests
    // invalidate the full scan, queue, and active runtime generation.
    useFileWatcher(
        state.rootHandle,
        settings.autoRevalidate,
        settings.revalidateInterval * 1000,
        handleRootDirectoryChange,
    );

    // Severity filter set (derived from settings)
    const hiddenSet = useMemo(() => new Set(settings.hiddenSeverities), [settings.hiddenSeverities]);

    const currentCache = useMemo(() => {
        const raw = state.selectedPackage != null
            ? (state.packageCache[state.selectedPackage.key] ?? null)
            : null;
        if (!raw || hiddenSet.size === 0) return raw;
        return {
            ...raw,
            fullValidationResult: raw.validationResult,
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
        const scheduled = entries.filter((entry) => entry.runtimeTest || entry.runtimeTestPhase);
        const done = scheduled.filter((entry) => entry.runtimeTest && !entry.runtimeTestPhase).length;
        const readiness = scheduled.map((entry) => derivePackageReadiness(
            entry.validationResult,
            entry.runtimeTest,
            entry.runtimeTestPhase,
        ));
        const failed = readiness.filter((entry) => entry.status === 'runtime-failed').length;
        const inconclusive = readiness.filter((entry) => entry.runtimeStatus === 'inconclusive').length;
        return scheduled.length > 0 ? { done, total: scheduled.length, failed, inconclusive } : null;
    }, [state.packageCache]);

    // Derive runtime test results for sidebar
    const sidebarRuntimeResults = useMemo(() => {
        const entries = Object.entries(state.packageCache)
            .filter(([, value]) => value.runtimeTest || value.runtimeTestPhase)
            .map(([key, value]) => [key, {
                result: value.runtimeTest,
                phase: value.runtimeTestPhase,
                readiness: derivePackageReadiness(
                    value.validationResult,
                    value.runtimeTest,
                    value.runtimeTestPhase,
                ),
            }] as const);
        return Object.fromEntries(entries);
    }, [state.packageCache]);

    const currentRawCache = state.selectedPackage
        ? state.packageCache[state.selectedPackage.key]
        : undefined;
    const currentReadiness = currentRawCache
        ? derivePackageReadiness(
            currentRawCache.validationResult,
            currentRawCache.runtimeTest,
            currentRawCache.runtimeTestPhase,
        )
        : null;

    return (
        <div className="flex flex-col h-full min-w-0">
            <header className="shrink-0 h-12 sm:h-14 bg-ss-surface-high flex items-center px-3 sm:px-4 gap-2 sm:gap-4 select-none"
                    style={{ borderBottom: '1px solid var(--ss-border-subtle)' }}>
                {/* Left: branding */}
                <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
                    <button
                        type="button"
                        onClick={() => setMobileSidebarOpen(true)}
                        className="lg:hidden inline-flex h-8 w-8 items-center justify-center rounded-sm text-ss-on-surface-variant hover:bg-ss-surface-highest hover:text-ss-on-surface transition-colors"
                        aria-label="Open package navigation"
                        aria-expanded={mobileSidebarOpen}
                    >
                        <Menu size={17} />
                    </button>
                    <img src="/logo-light.png" alt="StreamShapers" className="ss-brand-logo-light h-5 sm:h-6 shrink-0" />
                    <img src="/logo-dark.png" alt="" aria-hidden="true" className="ss-brand-logo-dark h-5 sm:h-6 shrink-0" />
                    <span className="hidden sm:inline text-ss-outline-variant/60 select-none">|</span>
                    <h1 className="hidden sm:inline text-sm md:text-base font-semibold text-ss-on-surface tracking-wide whitespace-nowrap">OGraf Validator</h1>
                </div>

                {/* Center: active project */}
                <div className="hidden lg:flex flex-1 justify-center min-w-0">
                    {state.rootName && (
                        <span className="text-xs font-mono text-ss-on-surface-variant tracking-wide uppercase truncate">
                            Active Project:&nbsp;
                            <span className="text-ss-on-surface">{state.rootName}</span>
                        </span>
                    )}
                </div>

                {/* Right: actions */}
                <div className="ml-auto flex items-center gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={handleRootDirectoryChange}
                        disabled={!state.rootHandle || state.isScanning}
                        className="flex items-center justify-center gap-1.5 h-8 w-8 sm:w-auto sm:px-3 rounded-sm ring-1 ring-inset ring-ss-outline-variant/40 text-sm font-semibold text-ss-on-surface-variant hover:bg-ss-surface-highest hover:text-ss-on-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                        aria-label="Rescan Directory"
                        title={state.rootHandle ? 'Rescan current directory' : 'Open a directory first'}
                    >
                        <RefreshCw size={15} className={state.isScanning ? 'animate-spin' : undefined} />
                        <span className="hidden sm:inline">Rescan</span>
                    </button>
                    <button
                        type="button"
                        onClick={openDirectory}
                        className="flex items-center justify-center gap-1.5 h-8 w-8 sm:w-auto sm:px-4 rounded-sm ring-1 ring-inset ring-ss-primary-container text-sm font-semibold text-ss-primary-container hover:bg-ss-primary-container/10 hover:text-ss-primary-light transition-colors"
                        aria-label="Open Directory"
                    >
                        <FolderOpen size={15} />
                        <span className="hidden sm:inline">Open Directory</span>
                    </button>
                </div>
            </header>

            <div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
                {mobileSidebarOpen && (
                    <button
                        type="button"
                        className="absolute inset-0 z-30 bg-black/55 lg:hidden"
                        aria-label="Close package navigation"
                        onClick={() => setMobileSidebarOpen(false)}
                    />
                )}
                <div className={`absolute inset-y-0 left-0 z-40 transform transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0 ${
                    mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
                }`}>
                    <Sidebar
                        rootName={state.rootName}
                        packages={state.packages}
                        selectedKey={state.selectedPackage?.key ?? null}
                        validationResults={sidebarResults}
                        runtimeResults={sidebarRuntimeResults}
                        isScanning={state.isScanning}
                        onOpenDirectory={openDirectory}
                        onSelectPackage={(entry) => {
                            setMobileSidebarOpen(false);
                            void selectPackage(entry);
                        }}
                        isSettingsActive={state.view === 'settings'}
                        onOpenSettings={() => {
                            setMobileSidebarOpen(false);
                            setState((prev) => ({ ...prev, view: 'settings' }));
                        }}
                        onShowOverview={() => {
                            setMobileSidebarOpen(false);
                            setState((prev) => ({ ...prev, selectedPackage: null, view: 'packages' }));
                        }}
                        onClose={() => setMobileSidebarOpen(false)}
                    />
                </div>
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
                        packageReadiness={currentReadiness}
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
                errorCount={(currentReadiness?.staticErrors ?? 0) + (currentReadiness?.runtimeErrors ?? 0)}
                warningCount={(currentReadiness?.staticWarnings ?? 0) + (currentReadiness?.runtimeWarnings ?? 0)}
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

function readManifestMain(manifest: unknown): string | undefined {
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return undefined;
    const main = (manifest as Record<string, unknown>)['main'];
    return typeof main === 'string' && main.length > 0 ? main : undefined;
}

function readErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sameJson(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}
