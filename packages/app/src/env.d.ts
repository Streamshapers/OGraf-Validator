/// <reference types="vite/client" />

// File System Access API – available in Chromium-based browsers.
// TypeScript's DOM lib declares these but `showDirectoryPicker` becomes `unknown`
// after `in`-narrowing, so we extend Window explicitly here.
interface DirectoryPickerOptions {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
