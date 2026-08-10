export interface InspectorThumbnail {
    file: string;
    external: boolean;
    resolution?: {
        width: number;
        height: number;
    };
}

export interface InspectorEngineRequirement {
    type: string;
    minimumVersion?: string;
}

export interface InspectorRenderRequirement {
    index: number;
    resolution?: {
        width?: unknown;
        height?: unknown;
    };
    frameRate?: unknown;
    accessToPublicInternet?: unknown;
    engines: InspectorEngineRequirement[];
}

export interface InspectorCustomAction {
    id: string;
    name: string;
    description?: string;
    hasSchema: boolean;
}

export interface InspectorActionStepDuration {
    step?: number;
    duration: number;
}

export interface InspectorActionDuration {
    type: string;
    duration: number;
    customActionId?: string;
    steps: InspectorActionStepDuration[];
}

export function readManifestName(manifest: unknown): string | undefined {
    const value = readRecord(manifest)?.['name'];

    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readThumbnails(manifest: unknown): InspectorThumbnail[] {
    const thumbnails = readRecord(manifest)?.['thumbnails'];
    if (!Array.isArray(thumbnails)) return [];

    return thumbnails.flatMap((thumbnail) => {
        const entry = readRecord(thumbnail);
        if (!entry) return [];
        const file = entry['file'];
        if (typeof file !== 'string' || file.length === 0) return [];

        const resolution = readRecord(entry['resolution']);
        const width = resolution?.['width'];
        const height = resolution?.['height'];

        return [{
            file,
            external: isExternalReference(file),
            ...(isPositiveInteger(width) && isPositiveInteger(height)
                ? { resolution: { width, height } }
                : {}),
        }];
    });
}

export function readRenderRequirements(manifest: unknown): InspectorRenderRequirement[] {
    const requirements = readRecord(manifest)?.['renderRequirements'];
    if (!Array.isArray(requirements)) return [];

    return requirements.flatMap((requirement, index) => {
        const entry = readRecord(requirement);
        if (!entry) return [];

        const resolution = readRecord(entry['resolution']);
        const engines = Array.isArray(entry['engine'])
            ? entry['engine'].flatMap((engine) => {
                const engineEntry = readRecord(engine);
                if (!engineEntry) return [];
                const type = engineEntry['type'];
                if (typeof type !== 'string' || type.length === 0) return [];
                const version = readRecord(engineEntry['version']);
                const minimumVersion = version?.['min'];

                return [{
                    type,
                    ...(typeof minimumVersion === 'string' ? { minimumVersion } : {}),
                }];
            })
            : [];

        return [{
            index,
            ...(resolution
                ? { resolution: { width: resolution['width'], height: resolution['height'] } }
                : {}),
            ...('frameRate' in entry ? { frameRate: entry['frameRate'] } : {}),
            ...('accessToPublicInternet' in entry
                ? { accessToPublicInternet: entry['accessToPublicInternet'] }
                : {}),
            engines,
        }];
    });
}

export function formatRenderResolutionSummary(
    requirements: readonly InspectorRenderRequirement[],
): string | undefined {
    const resolutions = requirements.flatMap((requirement) => {
        if (!requirement.resolution) return [];
        const width = formatResolutionDimension(requirement.resolution.width);
        const height = formatResolutionDimension(requirement.resolution.height);
        if (!width && !height) return [];

        if (width && height) {
            const suffix = width.kind === 'ideal' && height.kind === 'ideal' ? ' ideal' : '';
            const formattedWidth = width.kind === 'ideal' && height.kind !== 'ideal' ? `~${width.value}` : width.value;
            const formattedHeight = height.kind === 'ideal' && width.kind !== 'ideal' ? `~${height.value}` : height.value;
            return [`${formattedWidth} × ${formattedHeight}${suffix}`];
        }
        return [width ? `width ${width.value}` : `height ${height!.value}`];
    });
    const distinct = [...new Set(resolutions)];
    if (distinct.length === 0) return undefined;
    return distinct.length === 1 ? distinct[0] : `${distinct[0]} · +${distinct.length - 1}`;
}

export function readCustomActions(manifest: unknown): InspectorCustomAction[] {
    const actions = readRecord(manifest)?.['customActions'];
    if (!Array.isArray(actions)) return [];

    return actions.flatMap((action) => {
        const entry = readRecord(action);
        if (!entry) return [];
        const id = entry['id'];
        const name = entry['name'];
        if (typeof id !== 'string' || typeof name !== 'string') return [];
        const description = entry['description'];

        return [{
            id,
            name,
            ...(typeof description === 'string' ? { description } : {}),
            hasSchema: entry['schema'] !== undefined && entry['schema'] !== null,
        }];
    });
}

export function readActionDurations(manifest: unknown): InspectorActionDuration[] {
    const durations = readRecord(manifest)?.['actionDurations'];
    if (!Array.isArray(durations)) return [];

    return durations.flatMap((duration) => {
        const entry = readRecord(duration);
        if (!entry) return [];
        const type = entry['type'];
        const value = entry['duration'];
        if (typeof type !== 'string' || !Number.isInteger(value)) return [];
        const customActionId = entry['customActionId'];
        const steps = Array.isArray(entry['steps'])
            ? entry['steps'].flatMap((step) => {
                const stepEntry = readRecord(step);
                if (!stepEntry) return [];
                const stepDuration = stepEntry['duration'];
                if (!Number.isInteger(stepDuration)) return [];
                const stepIndex = stepEntry['step'];

                return [{
                    ...(Number.isInteger(stepIndex) ? { step: stepIndex as number } : {}),
                    duration: stepDuration as number,
                }];
            })
            : [];

        return [{
            type,
            duration: value as number,
            ...(typeof customActionId === 'string' ? { customActionId } : {}),
            steps,
        }];
    });
}

export function formatNumberConstraint(constraint: unknown): string | undefined {
    if (typeof constraint === 'number' && Number.isFinite(constraint)) return String(constraint);
    const value = readRecord(constraint);
    if (!value) return undefined;

    const parts: string[] = [];
    if (isFiniteNumber(value['exact'])) parts.push(`exact ${value['exact']}`);
    if (isFiniteNumber(value['ideal'])) parts.push(`ideal ${value['ideal']}`);
    if (isFiniteNumber(value['min'])) parts.push(`min ${value['min']}`);
    if (isFiniteNumber(value['max'])) parts.push(`max ${value['max']}`);

    return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function formatBooleanConstraint(constraint: unknown): string | undefined {
    if (typeof constraint === 'boolean') return String(constraint);
    const value = readRecord(constraint);
    if (!value) return undefined;

    const parts: string[] = [];
    if (typeof value['exact'] === 'boolean') parts.push(`exact ${String(value['exact'])}`);
    if (typeof value['ideal'] === 'boolean') parts.push(`ideal ${String(value['ideal'])}`);

    return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function formatDuration(duration: number): string {
    if (duration === -1) return 'dynamic';
    if (duration === 0) return '0 ms';
    return `${duration.toLocaleString()} ms`;
}

export function isExternalReference(file: string): boolean {
    return file.startsWith('/') || file.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(file);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function isPositiveInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 1;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function formatResolutionDimension(value: unknown): { value: string; kind: 'exact' | 'ideal' | 'range' } | undefined {
    if (isFiniteNumber(value)) return { value: String(value), kind: 'exact' };
    const constraint = readRecord(value);
    if (!constraint) return undefined;

    if (isFiniteNumber(constraint['exact'])) {
        return { value: String(constraint['exact']), kind: 'exact' };
    }
    if (isFiniteNumber(constraint['ideal'])) {
        return { value: String(constraint['ideal']), kind: 'ideal' };
    }

    const min = constraint['min'];
    const max = constraint['max'];
    if (isFiniteNumber(min) && isFiniteNumber(max)) {
        return { value: `${min}–${max}`, kind: 'range' };
    }
    if (isFiniteNumber(min)) return { value: `≥${min}`, kind: 'range' };
    if (isFiniteNumber(max)) return { value: `≤${max}`, kind: 'range' };
    return undefined;
}
