export interface AppSettings {
    /** UI theme */
    theme: 'dark' | 'light' | 'system';
    /** How deep the package scanner recurses into subdirectories (1–20) */
    scanDepth: number;
    /** Automatically re-validate on file changes */
    autoRevalidate: boolean;
    /** Polling interval for auto-revalidate in seconds */
    revalidateInterval: 2 | 5 | 10;
    /** Severities to hide from the validation UI (errors cannot be hidden) */
    hiddenSeverities: ('warning' | 'info')[];
}

export const DEFAULT_SETTINGS: AppSettings = {
    theme: 'dark',
    scanDepth: 6,
    autoRevalidate: false,
    revalidateInterval: 2,
    hiddenSeverities: [],
};
