import {
    DEFAULT_RENDER_CHARACTERISTICS,
    type RenderCharacteristics,
} from './preview-types.js';

export interface RenderRequirementOption {
    /** Zero-based manifest array index. */
    index: number;
    characteristics: RenderCharacteristics;
    label: string;
    engineLabel?: string;
    internetLabel?: string;
    unverifiable: string[];
}

export function getRenderRequirementOptions(manifest: unknown): RenderRequirementOption[] {
    const requirements = record(manifest)['renderRequirements'];
    if (!Array.isArray(requirements)) return [];

    return requirements.flatMap((requirement, index) => {
        const option = resolveRenderRequirement(requirement, index);
        return option ? [option] : [];
    });
}

/** First locally representable alternative, or validator defaults when absent. */
export function selectRuntimeRenderRequirement(manifest: unknown): RenderRequirementOption {
    return getRenderRequirementOptions(manifest)[0] ?? {
        index: -1,
        characteristics: DEFAULT_RENDER_CHARACTERISTICS,
        label: `Default - ${formatCharacteristics(DEFAULT_RENDER_CHARACTERISTICS)}`,
        unverifiable: [],
    };
}

export function sameRenderCharacteristics(
    left: RenderCharacteristics,
    right: RenderCharacteristics,
): boolean {
    return left.width === right.width &&
        left.height === right.height &&
        left.frameRate === right.frameRate &&
        left.accessToPublicInternet === right.accessToPublicInternet;
}

function resolveRenderRequirement(value: unknown, index: number): RenderRequirementOption | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const requirement = value as Record<string, unknown>;
    const resolution = record(requirement['resolution']);
    const width = resolveConstraint(resolution['width'], DEFAULT_RENDER_CHARACTERISTICS.width);
    const height = resolveConstraint(resolution['height'], DEFAULT_RENDER_CHARACTERISTICS.height);
    const frameRate = resolveConstraint(requirement['frameRate'], DEFAULT_RENDER_CHARACTERISTICS.frameRate);
    if (width === null || height === null || frameRate === null) return null;

    const internetConstraint = record(requirement['accessToPublicInternet']);
    const internet = typeof internetConstraint['exact'] === 'boolean'
        ? internetConstraint['exact']
        : typeof internetConstraint['ideal'] === 'boolean'
            ? internetConstraint['ideal']
            : undefined;
    const characteristics: RenderCharacteristics = {
        width,
        height,
        frameRate,
        ...(internet === undefined ? {} : { accessToPublicInternet: internet }),
    };
    const engineLabel = formatEngines(requirement['engine']);
    const internetLabel = formatInternet(internetConstraint);
    const qualifiers = [engineLabel, internetLabel].filter((entry): entry is string => entry !== undefined);
    const unverifiable: string[] = [];
    if (engineLabel) unverifiable.push(`The validator cannot check the rendering engine (${engineLabel}).`);
    if (internetLabel) unverifiable.push(`The validator cannot check the public internet setting (${internetLabel}).`);

    return {
        index,
        characteristics,
        label: `Alternative ${index + 1} - ${formatCharacteristics(characteristics)}${
            qualifiers.length > 0 ? ` - ${qualifiers.join(', ')}` : ''
        }`,
        ...(engineLabel ? { engineLabel } : {}),
        ...(internetLabel ? { internetLabel } : {}),
        unverifiable,
    };
}

function resolveConstraint(value: unknown, fallback: number): number | null {
    if (value === undefined) return fallback;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const constraint = value as Record<string, unknown>;
    const min = finiteNumber(constraint['min']);
    const max = finiteNumber(constraint['max']);
    const exact = finiteNumber(constraint['exact']);
    const ideal = finiteNumber(constraint['ideal']);
    if (min !== undefined && max !== undefined && min > max) return null;

    if (exact !== undefined) {
        if (exact <= 0 || (min !== undefined && exact < min) || (max !== undefined && exact > max)) return null;
        return exact;
    }

    let selected = ideal ?? fallback;
    if (min !== undefined) selected = Math.max(selected, min);
    if (max !== undefined) selected = Math.min(selected, max);
    return Number.isFinite(selected) && selected > 0 ? selected : null;
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatCharacteristics(value: RenderCharacteristics): string {
    return `${value.width}x${value.height} @ ${value.frameRate} fps`;
}

function formatEngines(value: unknown): string | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const labels = value.flatMap((candidate) => {
        const engine = record(candidate);
        if (typeof engine['type'] !== 'string') return [];
        const version = record(engine['version']);
        const minimum = typeof version['min'] === 'string' ? ` >= ${version['min']}` : '';
        return [`${engine['type']}${minimum}`];
    });
    return labels.length > 0 ? labels.join(' / ') : undefined;
}

function formatInternet(value: Record<string, unknown>): string | undefined {
    if (typeof value['exact'] === 'boolean') {
        return value['exact'] ? 'public internet required' : 'no public internet required';
    }
    if (typeof value['ideal'] === 'boolean') {
        return value['ideal'] ? 'public internet preferred' : 'no public internet preferred';
    }
    return undefined;
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
