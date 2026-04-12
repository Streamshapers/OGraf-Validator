import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
    previous: unknown;
    current: unknown;
}

// ─── LCS line diff ────────────────────────────────────────────────────────────

type DiffOp = { type: 'equal' | 'insert' | 'delete'; line: string };

function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
    const m = oldLines.length;
    const n = newLines.length;

    const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            dp[i]![j] = oldLines[i] === newLines[j]
                ? dp[i + 1]![j + 1]! + 1
                : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
    }

    const result: DiffOp[] = [];
    let i = 0;
    let j = 0;
    while (i < m || j < n) {
        if (i < m && j < n && oldLines[i] === newLines[j]) {
            result.push({ type: 'equal', line: oldLines[i]! });
            i++; j++;
        } else if (j < n && (i >= m || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
            result.push({ type: 'insert', line: newLines[j]! });
            j++;
        } else {
            result.push({ type: 'delete', line: oldLines[i]! });
            i++;
        }
    }

    return result;
}

// ─── Context collapse (git -U3 style) ────────────────────────────────────────

const CONTEXT_LINES = 3;

type ViewLine =
    | { kind: 'equal' | 'insert' | 'delete'; line: string }
    | { kind: 'hunk'; count: number };

function buildView(ops: DiffOp[]): ViewLine[] {
    const visible = new Uint8Array(ops.length);
    for (let i = 0; i < ops.length; i++) {
        if (ops[i]!.type !== 'equal') {
            const lo = Math.max(0, i - CONTEXT_LINES);
            const hi = Math.min(ops.length - 1, i + CONTEXT_LINES);
            for (let k = lo; k <= hi; k++) visible[k] = 1;
        }
    }

    const result: ViewLine[] = [];
    let i = 0;
    while (i < ops.length) {
        if (visible[i]) {
            result.push({ kind: ops[i]!.type, line: ops[i]!.line });
            i++;
        } else {
            let count = 0;
            while (i < ops.length && !visible[i]) { count++; i++; }
            result.push({ kind: 'hunk', count });
        }
    }

    return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

function safeStringify(v: unknown): string {
    try { return JSON.stringify(v, null, 2); } catch { return ''; }
}

export default function ManifestDiffPanel({ previous, current }: Props) {
    const [expanded, setExpanded] = useState(false);

    const oldText = safeStringify(previous);
    const newText = safeStringify(current);

    if (!previous || oldText === newText) return null;

    const ops  = diffLines(oldText.split('\n'), newText.split('\n'));
    const view = buildView(ops);

    const added   = ops.filter((o) => o.type === 'insert').length;
    const removed = ops.filter((o) => o.type === 'delete').length;

    return (
        <div className="rounded overflow-hidden" style={{ border: '1px solid var(--ss-border-subtle)' }}>
            {/* Accordion header */}
            <button
                onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-ss-surface-high hover:bg-ss-surface-highest transition-colors text-left"
            >
                <ChevronRight
                    size={12}
                    className={`flex-shrink-0 text-ss-on-surface-variant transition-transform ${expanded ? 'rotate-90' : ''}`}
                />
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ss-on-surface-variant">
                    Manifest Diff
                </span>
                <span className="text-[10px] font-mono ml-1">
                    <span style={{ color: '#28af62' }}>+{added}</span>
                    <span className="text-ss-on-surface-variant/40 mx-1">/</span>
                    <span style={{ color: '#cc5662' }}>-{removed}</span>
                </span>
            </button>

            {/* Diff body */}
            {expanded && (
                <div className="overflow-x-auto bg-ss-surface/40">
                    <pre className="text-xs font-mono leading-5 min-w-0">
                        {view.map((vl, idx) => {
                            if (vl.kind === 'hunk') {
                                return (
                                    <div
                                        key={idx}
                                        className="px-3 py-0.5 text-ss-on-surface-variant/50 bg-ss-surface-high/60 select-none"
                                    >
                                        {'@@ '}{vl.count} unchanged line{vl.count !== 1 ? 's' : ''}{' @@'}
                                    </div>
                                );
                            }

                            const [prefix, cls] =
                                vl.kind === 'insert'
                                    ? ['+', 'bg-ss-success/10 text-ss-success']
                                    : vl.kind === 'delete'
                                        ? ['-', 'bg-ss-error/10 text-ss-error']
                                        : [' ', 'text-ss-on-surface-variant/60'];

                            return (
                                <div key={idx} className={`px-3 py-px whitespace-pre ${cls}`}>
                                    <span className="select-none opacity-50 mr-2 inline-block w-3 text-center">
                                        {prefix}
                                    </span>
                                    {vl.line}
                                </div>
                            );
                        })}
                    </pre>
                </div>
            )}
        </div>
    );
}
