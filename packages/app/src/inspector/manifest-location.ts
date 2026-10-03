export interface ManifestLocation {
    issuePath: string;
    segments: string[];
    pointer: string;
    exists: boolean;
    value: unknown;
}

const ROOT_FIELDS = new Set(['$schema', 'id', 'name', 'version', 'description', 'author', 'main',
    'supportsRealTime', 'supportsNonRealTime', 'stepCount', 'schema', 'customActions',
    'actionDurations', 'renderRequirements', 'thumbnails']);

export function manifestPointer(segments: string[]): string {
    return segments.map((segment) => '/' + segment.replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

/** Legacy diagnostic paths may be ambiguous for keys containing dots or brackets. Never guess. */
export function createManifestIssueLocator(manifest: unknown): (issuePath?: string) => ManifestLocation | undefined {
    if (!manifest || typeof manifest !== 'object') return () => undefined;
    const nodes: { path: string; segments: string[]; value: unknown }[] = [];
    let limited = false;
    const ancestors = new Set<object>();
    const visit = (value: unknown, path: string, segments: string[]) => {
        if (nodes.length >= 20_000 || segments.length > 50) { limited = true; return; }
        nodes.push({ path, segments, value });
        if (!value || typeof value !== 'object') return;
        if (ancestors.has(value)) { limited = true; return; }
        ancestors.add(value);
        for (const [key, child] of Object.entries(value)) {
            const childPath = /^\d+$/.test(key) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
            visit(child, childPath, [...segments, key]);
            if (limited) break;
        }
        ancestors.delete(value);
    };
    visit(manifest, '', []);
    if (limited) return () => undefined;
    return (issuePath?: string) => {
        if (!issuePath) return undefined;
        const exact = nodes.filter((node) => node.path === issuePath);
        const parents = nodes.filter((node) => {
            if (!node.value || typeof node.value !== 'object') return false;
            if (!node.path) return ROOT_FIELDS.has(issuePath) && !Object.hasOwn(node.value, issuePath);
            const suffix = issuePath.slice(node.path.length);
            if (!issuePath.startsWith(node.path)) return false;
            const key = /^\.[^.[\]]+$/.test(suffix) ? suffix.slice(1)
                : /^\[\d+\]$/.test(suffix) ? suffix.slice(1, -1) : undefined;
            return key !== undefined && !Object.hasOwn(node.value, key);
        });
        // A flat diagnostic path must identify exactly one existing field or missing child.
        if (exact.length + parents.length !== 1) return undefined;
        const selected = exact[0] ?? parents[0];
        if (!selected) return undefined;
        return { issuePath, segments: selected.segments, pointer: manifestPointer(selected.segments),
            exists: exact.length === 1, value: selected.value };
    };
}

export function locateManifestIssue(manifest: unknown, issuePath?: string): ManifestLocation | undefined {
    return createManifestIssueLocator(manifest)(issuePath);
}
