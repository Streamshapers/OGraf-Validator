import { useEffect, useRef, useState } from 'react';
import type { ValidationResult } from '@streamshapers/ograf-validator-core';
import type { PackageEntry } from '../scanner/scan-packages.js';
import type { RuntimeSuiteState, RuntimeTestResult } from '../preview/runtime-test-types.js';
import type { RuntimeTestPhase } from '../readiness/package-readiness.js';
import { BrowserFS } from '../fs/browser-fs.js';
import { fingerprintPackage } from '../readiness/report-context.js';
import { createValidationReport, renderValidationReportHtml, type ValidationReport } from '../readiness/validation-report.js';

type ExportFormat = 'JSON' | 'HTML';

export default function ExportButtons({ result, packageName, packageEntry, runtimeResult, runtimePhase, extendedState }: {
    result: ValidationResult;
    packageName: string;
    packageEntry: PackageEntry;
    runtimeResult?: RuntimeTestResult;
    runtimePhase?: RuntimeTestPhase;
    extendedState?: RuntimeSuiteState;
}) {
    const [preparing, setPreparing] = useState(false);
    const [pending, setPending] = useState<{ format: ExportFormat; report: ValidationReport }>();
    const controller = useRef<AbortController | null>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => () => controller.current?.abort(), []);
    useEffect(() => {
        if (pending) dialog.current?.showModal();
    }, [pending]);

    const prepare = async (format: ExportFormat) => {
        controller.current?.abort();
        const attempt = new AbortController();
        controller.current = attempt;
        setPreparing(true);
        // Freeze the selected results before awaiting file IO or user review.
        const report = JSON.parse(JSON.stringify(createValidationReport(
            packageName, result, runtimeResult, runtimePhase, undefined, extendedState,
        ))) as ValidationReport;
        const fingerprint = await fingerprintPackage(new BrowserFS(packageEntry.dirHandle), attempt.signal);
        if (attempt.signal.aborted) return;
        report.packageAtExport = { manifestFilename: packageEntry.manifestFilename, fingerprint };
        setPending({ format, report });
        setPreparing(false);
    };
    const close = () => { dialog.current?.close(); setPending(undefined); };
    const download = () => {
        if (!pending) return;
        const content = pending.format === 'JSON'
            ? JSON.stringify(pending.report, null, 2) : renderValidationReportHtml(pending.report);
        const slug = pending.report.packageName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        const url = URL.createObjectURL(new Blob([content], {
            type: pending.format === 'JSON' ? 'application/json' : 'text/html',
        }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${slug}-validation-report.${pending.format.toLowerCase()}`;
        anchor.click();
        URL.revokeObjectURL(url);
        close();
    };
    const buttonClass = 'inline-flex items-center justify-center whitespace-nowrap px-2.5 py-1.5 rounded-sm text-xs font-medium border border-ss-outline-variant text-ss-on-surface-variant hover:bg-ss-surface-high disabled:opacity-50';

    return <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
        {(['JSON', 'HTML'] as const).map((format) => <button key={format}
            className={buttonClass} disabled={preparing} onClick={() => void prepare(format)}>
            Export {format}
        </button>)}
        {preparing && <span role="status" className="text-xs">Preparing report…</span>}
        <dialog ref={dialog} onCancel={() => setPending(undefined)}
            aria-labelledby="export-review-title"
            className="m-auto w-[calc(100%-2rem)] max-w-2xl max-h-[85vh] overflow-auto rounded-md border border-ss-outline-variant bg-ss-surface p-5 text-ss-on-surface backdrop:bg-black/60">
            <h3 id="export-review-title" className="font-semibold">Review report contents</h3>
            <p className="mt-3 text-sm">This report includes version and browser information, package fingerprints,
                test scenarios, call parameters, Graphic responses and diagnostic messages.</p>
            <p className="mt-2 text-sm">Test data can include names, text, URLs and other values from manifest defaults.
                Review the contents before sharing. Package source files are not embedded. The download stays local.</p>
            <details className="mt-4">
                <summary className="cursor-pointer text-sm">Inspect included data</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                    {pending ? JSON.stringify(pending.report, null, 2) : ''}
                </pre>
            </details>
            <div className="mt-5 flex justify-end gap-2">
                <button className={buttonClass} onClick={close}>Cancel</button>
                <button className={buttonClass} onClick={download}>Download {pending?.format}</button>
            </div>
        </dialog>
    </div>;
}
