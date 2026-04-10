import { useState, useCallback } from 'react';
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import { validatePackage } from '@streamshapers/ograf-validator-core';
import { scanPackages, type PackageEntry } from './scanner/scan-packages.js';
import { BrowserFS } from './fs/browser-fs.js';
import { usePreviewSW } from './preview/use-preview-sw.js';
import Sidebar from './components/Sidebar.js';
import ContentArea, { type PackageCache } from './components/ContentArea.js';

interface AppState {
    rootHandle: FileSystemDirectoryHandle | null;
    rootName: string | null;
    packages: PackageEntry[];
    isScanning: boolean;
    selectedPackage: PackageEntry | null;
    packageCache: Record<string, PackageCache>;
    isValidating: boolean;
    validationError: string | null;
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
};

export default function App() {
    const [state, setState] = useState<AppState>(INITIAL_STATE);

    // Register preview SW once for the entire app lifetime
    const swReady = usePreviewSW(state.selectedPackage?.dirHandle ?? null);

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
            const found = await scanPackages(dirHandle);
            setState((prev) => ({ ...prev, packages: found, isScanning: false }));

            // Validate all packages in background so the sidebar shows results immediately.
            // We skip packages that the user already selected (cache entry exists).
            void Promise.all(
                found.map(async (entry) => {
                    try {
                        const fs = new BrowserFS(entry.dirHandle);
                        const manifestText = await fs.readFile(entry.manifestFilename);
                        const manifest: unknown = JSON.parse(manifestText);
                        const [result, assets] = await Promise.all([
                            validatePackage(manifest, fs),
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
                                    },
                                },
                            };
                        });
                    } catch {
                        // Silently ignore – the user will see the error when they select the package
                    }
                }),
            );
        } catch (err) {
            console.error('Failed to scan packages', err);
            setState((prev) => ({ ...prev, isScanning: false }));
        }
    }, []);

    const selectPackage = useCallback(async (entry: PackageEntry) => {
        setState((prev) => ({
            ...prev,
            selectedPackage: entry,
            isValidating: true,
            validationError: null,
        }));

        try {
            const fs = new BrowserFS(entry.dirHandle);
            const manifestText = await fs.readFile(entry.manifestFilename);
            const manifest: unknown = JSON.parse(manifestText);

            const [result, assets] = await Promise.all([
                validatePackage(manifest, fs),
                fs.listFiles(),
            ]);

            setState((prev) => {
                const previous = prev.packageCache[entry.path]?.manifest;

                return {
                    ...prev,
                    isValidating: false,
                    packageCache: {
                        ...prev.packageCache,
                        [entry.path]: {
                            validationResult: result,
                            manifest,
                            previousManifest: previous,
                            assets,
                        },
                    },
                };
            });
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

    const currentCache =
        state.selectedPackage != null
            ? (state.packageCache[state.selectedPackage.path] ?? null)
            : null;

    // Derive validationResults map for the sidebar status dots
    const sidebarResults = Object.fromEntries(
        Object.entries(state.packageCache).map(([k, v]) => [k, v.validationResult]),
    ) satisfies Record<string, ValidationResult>;

    return (
        <div className="flex flex-col h-full">
            <header className="flex-shrink-0 h-12 bg-ss-dark-1 border-b border-ss-border flex items-center px-4 gap-3">
                <img src="https://streamshapers.com/logo-light.png" alt="StreamShapers" className="h-6" />
                <span className="text-ss-border select-none">|</span>
                <span className="text-sm font-semibold text-ss-text-1 tracking-wide">OGraf Validator</span>
            </header>

            <div className="flex flex-1 min-h-0">
                <Sidebar
                    rootName={state.rootName}
                    packages={state.packages}
                    selectedPath={state.selectedPackage?.path ?? null}
                    validationResults={sidebarResults}
                    isScanning={state.isScanning}
                    onOpenDirectory={openDirectory}
                    onSelectPackage={selectPackage}
                />
                <ContentArea
                    selectedPackage={state.selectedPackage}
                    cache={currentCache}
                    isValidating={state.isValidating}
                    validationError={state.validationError}
                    swReady={swReady}
                />
            </div>
        </div>
    );
}
