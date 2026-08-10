import { useState, useCallback } from 'react';
import { DEFAULT_SETTINGS, type AppSettings } from './types.js';

const STORAGE_KEY = 'ograf-settings';

export function normalizeSettings(value: unknown): AppSettings {
    const input = typeof value === 'object' && value !== null
        ? value as Record<string, unknown>
        : {};
    const themes: AppSettings['theme'][] = ['dark', 'light', 'system'];
    const intervals: AppSettings['revalidateInterval'][] = [2, 5, 10];
    const numericDepth = typeof input['scanDepth'] === 'number' && Number.isFinite(input['scanDepth'])
        ? Math.trunc(input['scanDepth'])
        : DEFAULT_SETTINGS.scanDepth;
    const hiddenSeverities = Array.isArray(input['hiddenSeverities'])
        ? [...new Set(input['hiddenSeverities'].filter(
            (severity): severity is 'warning' | 'info' => severity === 'warning' || severity === 'info',
        ))]
        : DEFAULT_SETTINGS.hiddenSeverities;

    return {
        theme: themes.includes(input['theme'] as AppSettings['theme'])
            ? input['theme'] as AppSettings['theme']
            : DEFAULT_SETTINGS.theme,
        scanDepth: Math.min(20, Math.max(1, numericDepth)),
        autoRevalidate: typeof input['autoRevalidate'] === 'boolean'
            ? input['autoRevalidate']
            : DEFAULT_SETTINGS.autoRevalidate,
        revalidateInterval: intervals.includes(input['revalidateInterval'] as AppSettings['revalidateInterval'])
            ? input['revalidateInterval'] as AppSettings['revalidateInterval']
            : DEFAULT_SETTINGS.revalidateInterval,
        hiddenSeverities,
    };
}

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        return normalizeSettings(JSON.parse(raw));
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings: AppSettings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch { /* quota exceeded */ }
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
    const [settings, setSettings] = useState<AppSettings>(loadSettings);

    const updateSettings = useCallback((patch: Partial<AppSettings>) => {
        setSettings((prev) => {
            const next = { ...prev, ...patch };
            saveSettings(next);
            return next;
        });
    }, []);

    return [settings, updateSettings];
}
