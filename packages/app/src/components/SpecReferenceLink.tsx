import { safeSpecReference } from '../readiness/spec-reference.js';

export default function SpecReferenceLink({ reference }: { reference?: string }) {
    const href = safeSpecReference(reference);
    if (!href) return null;

    return (
        <a href={href} target="_blank" rel="noopener noreferrer"
           className="inline-block mt-2 text-[11px] text-ss-primary-container underline underline-offset-2">
            Specification reference
        </a>
    );
}
