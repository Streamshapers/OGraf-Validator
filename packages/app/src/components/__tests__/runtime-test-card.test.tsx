import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import RuntimeTestCard from '../RuntimeTestCard.js';

it('does not label older warning results as passed when completeness metadata is missing', () => {
    const html = renderToStaticMarkup(<RuntimeTestCard findings={[]} result={{
        passed: true, totalDurationMs: 1,
        steps: [{ name: 'Unverified engine', status: 'warning', durationMs: 0,
            diagnostic: { code: 'PREVIEW_LIMITATION' } }],
    }} />);
    expect(html).toContain('>Inconclusive</span>');
    expect(html).toContain('Not fully tested');
    expect(html).not.toContain('>Passed</span>');
});
