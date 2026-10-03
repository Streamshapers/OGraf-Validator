import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import IssueList from '../IssueList.js';
import RuntimeEvidence from '../RuntimeEvidence.js';
import ManifestTab from '../ManifestTab.js';
import { locateManifestIssue } from '../../inspector/manifest-location.js';

it('escapes actual values and distinguishes missing evidence from undefined', () => {
    const html = renderToStaticMarkup(<RuntimeEvidence inputs step={{
        name: 'load()', status: 'fail', durationMs: 1,
        invocation: { method: 'load', dispatched: true, startedAt: 'test',
            parameters: { type: 'json', value: '<script>test</script>' }, response: { type: 'undefined' },
        },
    }} />);
    expect(html).toContain('&lt;script&gt;test&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('>undefined</pre>');
    expect(html).not.toContain('Expected');
});

it('expands deep manifest ancestors and marks exactly the requested node', () => {
    const manifest = { schema: { properties: { title: { default: null } } } };
    const html = renderToStaticMarkup(<ManifestTab manifest={manifest}
        location={locateManifestIssue(manifest, 'schema.properties.title.default')} />);
    expect(html.match(/data-manifest-target="true"/g)).toHaveLength(1);
    expect(html).toContain('Selected field:');
    expect(html).toContain('null');
});

it('does not turn filesystem diagnostics into manifest links when names coincide', () => {
    const issue = { code: 'LARGE_FILE' as const, severity: 'warning' as const, path: 'name', message: 'Large file' };
    const html = renderToStaticMarkup(<IssueList manifest={{ name: 'Graphic' }}
        result={{ valid: true, errors: [], warnings: [issue], infos: [], issues: [issue] }}
        onShowManifest={() => {}} />);
    expect(html).not.toContain('Show in manifest');
    expect(html).not.toContain('Current manifest value');
});
