import { isArchiveDirectory } from './fs/archive-directory.js';
import { fingerprintPackage, reportEnvironment, type RuntimeReportContext } from './readiness/report-context.js';
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
import { enqueueRuntimeJob, prioritizeRuntimeQueue } from './runtime-queue.js';
import { deriveRuntimeProgress } from './runtime-progress.js';
import type {
    RuntimeBudgetMinutes, RuntimeSuiteState, RuntimeTestResult, RuntimeTestSuite,
} from './preview/runtime-test-types.js';
import { completeRuntimeSuite, startRuntimeSuite } from './preview/runtime-suite-state.js';
import { readRuntimeSuite, updateRuntimeAttempt, writeRuntimeSuite } from './runtime-package-state.js';

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

interface RuntimeQueueItem {
    entry: PackageEntry;
    manifest: unknown;
    generation: number;
    suite: RuntimeTestSuite;
    runId: string;
    budgetMinutes: RuntimeBudgetMinutes;
}

interface ActiveRuntimeTest {
    key: string;
    generation: number;
    controller: AbortController;
    suite: RuntimeTestSuite;
    runId: string;
    budgetMinutes: RuntimeBudgetMinutes;
    abortReason?: 'user' | 'invalidated' | 'unmount';
}

export default function App() {
    const [state, setState] = useState<AppState>(INITIAL_STATE);
    const projectRequestRef = useRef(0);
    const zipInputRef = useRef<HTMLInputElement>(null);
    const zipControllerRef = useRef<AbortController | null>(null);
    const [zipProgress, setZipProgress] = useState<{ name: string; done: number; total: number } | null>(null);
    const [zipError, setZipError] = useState<string | null>(null);
    useEffect(() => () => zipControllerRef.current?.abort(), []);
    const [lastScan, setLastScan] = useState<Date | null>(null);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [settings, updateSettings] = useSettings();

    const mountedRef = useRef(true);
    const scanGenerationRef = useRef(0);
    const scanAbortRef = useRef<AbortController | null>(null);
    const validationRequestRef = useRef<Map<string, number>>(new Map());
    const validatedManifestRef = useRef<Map<string, unknown>>(new Map());
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
        if (runtimeDrainingRef.current || !swReadyRef.current || !mountedRef.current) return;
        runtimeDrainingRef.current = true;

        try {
            while (runtimeQueueRef.current.length > 0 && swReadyRef.current && mountedRef.current) {
                const item = runtimeQueueRef.current.shift();
                if (!item || item.generation !== scanGenerationRef.current) continue;
                const { entry, manifest, generation, suite, runId, budgetMinutes } = item;
                const main = readManifestMain(manifest);
                if (!main) continue;

                const controller = new AbortController();
                const active: ActiveRuntimeTest = {
                    key: entry.key, generation, controller, suite, runId, budgetMinutes,
                };
                runtimeActiveRef.current = active;
                const updateAttempt = (update: (current: RuntimeSuiteState) => RuntimeSuiteState) => {
                    if (!mountedRef.current) return;
                    setState((prev) => {
                        if (generation !== scanGenerationRef.current || !mountedRef.current) return prev;
                        const existing = prev.packageCache[entry.key];
                        if (!existing) return prev;
                        const next = updateRuntimeAttempt(existing, suite, runId, update);
                        if (next === existing) return prev;
                        return { ...prev, packageCache: { ...prev.packageCache, [entry.key]: next } };
                    });
                };
                updateAttempt((current) => ({
                    ...current,
                    active: { ...current.active!, phase: 'running' },
                }));

                let session: ReturnType<typeof createPreviewSession> | undefined;
                try {
                    const reportContext: RuntimeReportContext = {
                        environment: reportEnvironment(), manifestFilename: entry.manifestFilename, entryPoint: main,
                        startedAt: new Date().toISOString(),
                        packageBefore: await fingerprintPackage(new BrowserFS(entry.dirHandle), controller.signal),
                    };
                    session = createPreviewSession(entry.dirHandle);
                    const runtimeResult = await runRuntimeTest({
                        importUrl: session.buildUrl(main),
                        manifest,
                        dirHandle: entry.dirHandle,
                        sessionId: session.sessionId,
                        signal: controller.signal,
                        suite,
                        runId,
                        budgetMinutes,
                        onStepComplete: (step) => {
                            updateAttempt((current) => ({
                                ...current,
                                active: {
                                    ...current.active!,
                                    steps: [...current.active!.steps, { ...step, reportContext }],
                                },
                            }));
                        },
                        onProgress: (progress) => {
                            updateAttempt((current) => ({
                                ...current, active: { ...current.active!, progress },
                            }));
                        },
                    });
                    const packageAfter = await fingerprintPackage(new BrowserFS(entry.dirHandle), controller.signal);
                    const completedContext: RuntimeReportContext = {
                        ...reportContext, finishedAt: new Date().toISOString(), packageAfter,
                        packageComparison: reportContext.packageBefore.status === 'available' && packageAfter.status === 'available'
                            ? reportContext.packageBefore.digest === packageAfter.digest ? 'unchanged' : 'changed'
                            : 'unavailable',
                    };
                    updateAttempt((current) => completeRuntimeSuite(current, {
                        ...runtimeResult, suite, runId, budgetMinutes,
                        reportContext: completedContext,
                        steps: runtimeResult.steps.map((step) => ({ ...step, reportContext: completedContext })),
                    }));
                } catch (error) {
                    updateAttempt((current) => {
                        const cancelled = controller.signal.aborted;
                        const result: RuntimeTestResult = {
                            suite, runId, budgetMinutes,
                            outcome: cancelled ? 'cancelled' : 'completed',
                            passed: !current.active!.steps.some((step) => step.status === 'fail'),
                            inconclusive: true,
                            steps: [...current.active!.steps, {
                                name: 'Runtime harness',
                                status: 'warning',
                                durationMs: 0,
                                error: cancelled ? 'Runtime test cancelled before completion.' : readErrorMessage(error),
                                diagnostic: {
                                    code: cancelled ? 'RUNTIME_ABORTED' : 'PREVIEW_LIMITATION',
                                    reason: 'incomplete-runtime-harness',
                                },
                                suite, runId,
                            }],
                            totalDurationMs: 0,
                        };
                        return completeRuntimeSuite(current, result);
                    });
                } finally {
                    session?.close();
                    if (runtimeActiveRef.current === active) runtimeActiveRef.current = null;
                }
            }
        } finally {
            runtimeDrainingRef.current = false;
            if (runtimeQueueRef.current.length > 0 && swReadyRef.current && mountedRef.current) {
                queueMicrotask(() => void drainRuntimeQueue());
            }
        }
    }, []);

    const enqueueRuntimeTest = useCallback((
        entry: PackageEntry,
        manifest: unknown,
        generation: number,
        priority = false,
        suite: RuntimeTestSuite = 'standard',
        budgetMinutes: RuntimeBudgetMinutes = 2,
    ) => {
        if (generation !== scanGenerationRef.current || !mountedRef.current) return;
        const active = runtimeActiveRef.current;
        if ((active?.key === entry.key && active.suite === suite && active.generation === generation
                && active.abortReason !== 'invalidated')
            || runtimeQueueRef.current.some((item) => item.entry.key === entry.key && item.suite === suite)) return;
        if (suite === 'standard') runtimeTestedRef.current.add(entry.key);
        const runId = crypto.randomUUID();
        const item: RuntimeQueueItem = { entry, manifest, generation, suite, runId, budgetMinutes };
        runtimeQueueRef.current = enqueueRuntimeJob(runtimeQueueRef.current, item, priority);
        setState((prev) => {
            if (generation !== scanGenerationRef.current || !mountedRef.current) return prev;
            const existing = prev.packageCache[entry.key];
            if (!existing) return prev;
            const next = startRuntimeSuite(readRuntimeSuite(existing, suite), {
                runId, budgetMinutes, phase: 'pending', steps: [],
            });
            return {
                ...prev,
                packageCache: {
                    ...prev.packageCache,
                    [entry.key]: writeRuntimeSuite(existing, suite, next),
                },
            };
        });
        void drainRuntimeQueue();
    }, [drainRuntimeQueue]);

    const prioritizeQueuedRuntimeTest = useCallback((packageKey: string) => {
        runtimeQueueRef.current = prioritizeRuntimeQueue(runtimeQueueRef.current, packageKey);
        void drainRuntimeQueue();
    }, [drainRuntimeQueue]);

    useEffect(() => {
        if (swReady) void drainRuntimeQueue();
    }, [swReady, drainRuntimeQueue]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            scanGenerationRef.current++;
            scanAbortRef.current?.abort();
            runtimeQueueRef.current = [];
            if (runtimeActiveRef.current) {
                runtimeActiveRef.current.abortReason = 'unmount';
                runtimeActiveRef.current.controller.abort();
            }
        };
    }, []);

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

        const manifestChanged = validatedManifestRef.current.has(entry.key)
            && !sameJson(validatedManifestRef.current.get(entry.key), loaded.manifest);
        validatedManifestRef.current.set(entry.key, loaded.manifest);
        const resetRuntime = manifestChanged || !loaded.validationResult.valid;
        const shouldRunRuntime = loaded.validationResult.valid &&
            readManifestMain(loaded.manifest) !== undefined &&
            (manifestChanged || options.forceRuntime === true || !runtimeTestedRef.current.has(entry.key));

        if (resetRuntime) {
            runtimeQueueRef.current = runtimeQueueRef.current.filter((item) => item.entry.key !== entry.key);
            runtimeTestedRef.current.delete(entry.key);
            if (runtimeActiveRef.current?.key === entry.key) {
                runtimeActiveRef.current.abortReason = 'invalidated';
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
                        ...existing,
                        validationResult: loaded.validationResult,
                        manifest: loaded.manifest,
                        previousManifest,
                        assets: loaded.assets,
                        standardRuntimeTest: resetRuntime ? undefined : existing?.standardRuntimeTest,
                        extendedRuntimeTest: resetRuntime ? undefined : existing?.extendedRuntimeTest,
                        runtimeTest: resetRuntime ? undefined : existing?.runtimeTest,
                        runtimeTestPhase: shouldRunRuntime
                            ? 'pending'
                            : resetRuntime ? undefined : existing?.runtimeTestPhase,
                        runtimeTestSteps: shouldRunRuntime || resetRuntime ? undefined : existing?.runtimeTestSteps,
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
        if (runtimeActiveRef.current) {
            runtimeActiveRef.current.abortReason = 'invalidated';
            runtimeActiveRef.current.controller.abort();
        }
        const generation = scanGenerationRef.current + 1;
        scanGenerationRef.current = generation;
        const scanController = new AbortController();
        scanAbortRef.current = scanController;

        runtimeQueueRef.current = [];
        runtimeTestedRef.current.clear();
        validationRequestRef.current.clear();
        validatedManifestRef.current.clear();
        assetListCacheRef.current = new WeakMap();

        if (!isArchiveDirectory(dirHandle)) {
            try { localStorage.setItem('ograf-last-directory', dirHandle.name); } catch { /* quota */ }
            void saveDirectoryHandle(dirHandle);
        }

        setState((prev) => ({
            ...prev,
            rootHandle: dirHandle,
            rootName: dirHandle.name,
            view: 'packages',
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

    const openZip = useCallback(async (file: File) => {
        const request = ++projectRequestRef.current;
        zipControllerRef.current?.abort();
        const controller = new AbortController();
        zipControllerRef.current = controller;
        setZipError(null);
        setZipProgress({ name: file.name, done: 0, total: 0 });
        try {
            const { importZip } = await import('./fs/import-zip.js');
            const directory = await importZip(file, controller.signal, (done, total) => {
                if (!controller.signal.aborted) setZipProgress({ name: file.name, done, total });
            });
            if (controller.signal.aborted || !mountedRef.current || request !== projectRequestRef.current) return;
            setZipProgress(null);
            setMobileSidebarOpen(false);
            await loadDirectory(directory);
        } catch (error) {
            if (!controller.signal.aborted && mountedRef.current) setZipError(`Could not open ZIP: ${readErrorMessage(error)}`);
        } finally {
            if (zipControllerRef.current === controller && mountedRef.current) setZipProgress(null);
        }
    }, [loadDirectory]);

    const openDirectory = useCallback(async () => {
        const request = ++projectRequestRef.current;
        zipControllerRef.current?.abort();
        setZipProgress(null);
        setZipError(null);
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
        if (request !== projectRequestRef.current || !mountedRef.current) return;
        void loadDirectory(dirHandle);
    }, [loadDirectory]);

    const reopenLastDirectory = useCallback(async () => {
        const request = ++projectRequestRef.current;
        zipControllerRef.current?.abort();
        setZipProgress(null);
        setZipError(null);
        try {
            const handle = await loadDirectoryHandle();
            if (request !== projectRequestRef.current || !mountedRef.current) return;
            if (!handle) {
                // No persisted handle yet – open normal picker
                void openDirectory();
                return;
            }
            // Same session: permission might already be granted
            const query = (handle as unknown as { queryPermission: (desc: { mode: string }) => Promise<string> }).queryPermission;
            const current = await query.call(handle, { mode: 'read' });
            if (request !== projectRequestRef.current || !mountedRef.current) return;
            if (current === 'granted') {
                void loadDirectory(handle);
                return;
            }
            // After browser restart: Chrome shows the picker pre-navigated to the
            // stored directory – user only needs to click "Select" to confirm.
            const requestPermission = (handle as unknown as { requestPermission: (desc: { mode: string }) => Promise<string> }).requestPermission;
            const perm = await requestPermission.call(handle, { mode: 'read' });
            if (request !== projectRequestRef.current || !mountedRef.current) return;
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

    const requestRuntimeTest = useCallback((suite: RuntimeTestSuite, budgetMinutes: RuntimeBudgetMinutes = 2) => {
        const entry = state.selectedPackage;
        if (!entry) return;
        const cached = state.packageCache[entry.key];
        if (!cached || !cached.validationResult.valid || !readManifestMain(cached.manifest)) return;
        enqueueRuntimeTest(entry, cached.manifest, scanGenerationRef.current, true, suite, budgetMinutes);
    }, [state.selectedPackage, state.packageCache, enqueueRuntimeTest]);

    const cancelRuntimeTest = useCallback((packageKey: string, suite: RuntimeTestSuite) => {
        const queued = runtimeQueueRef.current.find((item) => item.entry.key === packageKey && item.suite === suite);
        runtimeQueueRef.current = runtimeQueueRef.current.filter((item) => item !== queued);
        const active = runtimeActiveRef.current;
        if (active?.key === packageKey && active.suite === suite) {
            active.abortReason = 'user';
            active.controller.abort();
        }
        const runId = queued?.runId ?? (active?.key === packageKey && active.suite === suite ? active.runId : undefined);
        const generation = queued?.generation ?? active?.generation;
        if (!runId) return;
        setState((prev) => {
            if (generation !== scanGenerationRef.current) return prev;
            const cache = prev.packageCache[packageKey];
            if (!cache) return prev;
            const next = updateRuntimeAttempt(cache, suite, runId, (current) => queued
                ? completeRuntimeSuite(current, cancelledQueuedResult(queued))
                : { ...current, active: { ...current.active!, phase: 'cancelling' } });
            return { ...prev, packageCache: { ...prev.packageCache, [packageKey]: next } };
        });
    }, []);

    const handleRootDirectoryChange = useCallback(() => {
        projectRequestRef.current++;
        zipControllerRef.current?.abort();
        setZipProgress(null);
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
        settings.autoRevalidate && !zipProgress && !isArchiveDirectory(state.rootHandle),
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
    const runtimeProgress = useMemo(
        () => deriveRuntimeProgress(Object.values(state.packageCache)),
        [state.packageCache],
    );

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
                    value.extendedRuntimeTest,
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
            currentRawCache.extendedRuntimeTest,
        )
        : null;

    const extendedEntries = Object.entries(state.packageCache)
        .filter(([, cache]) => cache.extendedRuntimeTest?.active);
    const activeExtended = extendedEntries.find(([, cache]) => cache.extendedRuntimeTest?.active?.phase !== 'pending')
        ?? extendedEntries[0];
    const extendedActivity = activeExtended ? {
        packageName: state.packages.find((entry) => entry.key === activeExtended[0])?.displayName ?? activeExtended[0],
        attempt: activeExtended[1].extendedRuntimeTest!.active!,
        onCancel: () => cancelRuntimeTest(activeExtended[0], 'extended'),
    } : undefined;

    return (
        <div className="flex flex-col h-full min-w-0"
            onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
            onDrop={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                const files = [...event.dataTransfer.files];
                if (files.length !== 1 || !files[0]!.name.toLowerCase().endsWith('.zip')) {
                    setZipError('Drop one ZIP archive at a time.');
                    return;
                }
                void openZip(files[0]!);
            }}>
            <input ref={zipInputRef} type="file" accept=".zip,application/zip" aria-label="Choose ZIP archive" className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void openZip(file);
                }} />
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
                    <button type="button" onClick={() => zipInputRef.current?.click()}
                        className="h-8 shrink-0 rounded-sm px-2 text-xs font-semibold text-ss-primary ring-1 ring-inset ring-ss-primary/40 hover:bg-ss-primary/10"
                        title="Open a ZIP archive locally; you can also drag and drop it">Open ZIP</button>
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

            {(zipProgress || zipError || isArchiveDirectory(state.rootHandle)) && <div className="shrink-0 border-b border-ss-outline-variant/30 bg-ss-surface px-3 py-2 text-xs text-ss-on-surface-variant">
                {zipProgress && <div role="status" className="flex flex-wrap items-center gap-2">
                    <span>Opening {zipProgress.name}… {zipProgress.total ? `${zipProgress.done}/${zipProgress.total} entries` : ''}</span>
                    <button className="underline" onClick={() => { zipControllerRef.current?.abort(); setZipProgress(null); }}>Cancel ZIP import</button>
                </div>}
                {zipError && <p role="alert">{zipError} <button className="underline" onClick={() => setZipError(null)}>Dismiss</button></p>}
                {!zipProgress && isArchiveDirectory(state.rootHandle) && <p>ZIP snapshot · Read-only · Stored only in this tab. Reopen the archive to load changes. Current scan-depth settings apply.</p>}
            </div>}
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
                        onRerunRuntimeTest={() => requestRuntimeTest('standard')}
                        onRunExtendedTest={(budget) => requestRuntimeTest('extended', budget)}
                        onCancelExtendedTest={() => {
                            if (state.selectedPackage) cancelRuntimeTest(state.selectedPackage.key, 'extended');
                        }}

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
                extendedActivity={extendedActivity}
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

function cancelledQueuedResult(item: RuntimeQueueItem): RuntimeTestResult {
    return {
        suite: item.suite, runId: item.runId, budgetMinutes: item.budgetMinutes,
        outcome: 'cancelled', passed: true, inconclusive: true, totalDurationMs: 0,
        steps: [{
            name: 'Runtime test', status: 'warning', durationMs: 0,
            error: 'Cancelled before the test started. No scenarios were executed.',
            diagnostic: { code: 'RUNTIME_ABORTED' }, suite: item.suite, runId: item.runId,
        }],
        scenarios: [],
    };
}
