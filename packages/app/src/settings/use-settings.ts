import { useState, useCallback } from 'react';
import { DEFAULT_SETTINGS, type AppSettings } from './types.js';

const STORAGE_KEY = 'ograf-settings';

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        return { ...DEFAULT_SETTINGS, ...parsed };
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
