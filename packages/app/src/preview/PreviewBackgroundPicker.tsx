import { useRef } from 'react';
import { Upload } from 'lucide-react';
import type { PreviewBackground } from './preview-types.js';

// ─── Preset swatches ──────────────────────────────────────────────────────────

interface Preset {
    label: string;
    bg: PreviewBackground;
}

const PRESETS: Preset[] = [
    { label: 'Transparent (checker)', bg: { type: 'checker' } },
    { label: 'Black',                 bg: { type: 'color', value: '#000000' } },
    { label: 'Dark grey (#1a1a1a)',   bg: { type: 'color', value: '#1a1a1a' } },
    { label: 'White',                 bg: { type: 'color', value: '#ffffff' } },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
    value: PreviewBackground;
    onChange: (bg: PreviewBackground) => void;
}

export default function PreviewBackgroundPicker({ value, onChange }: Props) {
    const colorInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef  = useRef<HTMLInputElement>(null);

    const isPresetActive = (preset: Preset): boolean => {
        if (preset.bg.type !== value.type) return false;
        if (preset.bg.type === 'color' && value.type === 'color') {
            return preset.bg.value === value.value;
        }

        return preset.bg.type === value.type;
    };

    // Custom color = a color that doesn't match any preset exactly
    const isCustomColor =
        value.type === 'color' &&
        !PRESETS.some((p) => p.bg.type === 'color' && (p.bg as { value: string }).value === value.value);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            // Warn if > ~3 MB as base64 (4 bytes per 3 raw bytes → ~4 MB base64 for 3 MB image)
            if (dataUrl.length > 4 * 1024 * 1024) {
                window.alert('Image is too large (> ~3 MB). Please use a smaller file — large images may not persist between sessions.');
            }
            onChange({ type: 'image', dataUrl });
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // allow re-selecting the same file
    };

    const ring = 'ring-2 ring-ss-primary ring-offset-1 ring-offset-ss-dark-2';
    const swatch = 'h-5 w-5 rounded-sm border border-ss-outline-variant/40 cursor-pointer transition-all hover:scale-110 shrink-0';

    return (
        <div className="flex items-center gap-2 justify-end flex-wrap">
            <span className="text-[10px] text-ss-on-surface-variant uppercase tracking-wide font-semibold">
                Background
            </span>

            {/* Preset swatches */}
            {PRESETS.map((preset) => (
                <button
                    key={preset.label}
                    title={preset.label}
                    onClick={() => onChange(preset.bg)}
                    className={`${swatch} ${isPresetActive(preset) ? ring : ''}`}
                    style={
                        preset.bg.type === 'checker'
                            ? {
                                background:
                                    'repeating-conic-gradient(#808080 0% 25%, #555555 0% 50%) 0 0 / 10px 10px',
                            }
                            : { backgroundColor: (preset.bg as { value: string }).value }
                    }
                />
            ))}

            {/* Custom color picker */}
            <button
                title="Custom color"
                onClick={() => colorInputRef.current?.click()}
                className={`${swatch} overflow-hidden ${isCustomColor ? ring : ''}`}
                style={
                    isCustomColor
                        ? { backgroundColor: value.value }
                        : {
                            background:
                                'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                        }
                }
            />
            <input
                ref={colorInputRef}
                type="color"
                value={value.type === 'color' ? value.value : '#ff0000'}
                onChange={(e) => onChange({ type: 'color', value: e.target.value })}
                className="sr-only"
            />

            {/* Image upload */}
            <button
                title={value.type === 'image' ? 'Change background image' : 'Upload background image'}
                onClick={() => fileInputRef.current?.click()}
                className={`${swatch} overflow-hidden bg-ss-surface-high flex items-center justify-center ${value.type === 'image' ? ring : ''}`}
                style={
                    value.type === 'image'
                        ? {
                            backgroundImage: `url(${value.dataUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                        }
                        : undefined
                }
            >
                {value.type !== 'image' && <Upload size={12} className="text-ss-on-surface-variant" />}
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="sr-only"
            />
        </div>
    );
}

