import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const specRoot = resolve(packageRoot, 'spec');

const expectedMetadataKeys = [
    'commit',
    'formatVersion',
    'sourceDate',
    'specification',
    'upstreamRepository',
];
const upstreamRepository = 'https://github.com/ebu/ograf';

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRealIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function formatSnapshotDate(sourceDate) {
    if (!isRealIsoDate(sourceDate)) {
        throw new Error(`Invalid snapshot source date: ${String(sourceDate)}`);
    }
    const [year, month, day] = sourceDate.split('-').map(Number);
    const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ];
    return `${String(day)} ${monthNames[month - 1]} ${String(year)}`;
}

export function validateSnapshotMetadata(value, directory) {
    if (!isRecord(value)) throw new Error('SNAPSHOT.json must contain a JSON object.');

    const actualKeys = Object.keys(value).sort();
    if (actualKeys.join('\n') !== expectedMetadataKeys.join('\n')) {
        throw new Error(
            `SNAPSHOT.json must contain exactly these keys: ${expectedMetadataKeys.join(', ')}.`,
        );
    }
    if (value['formatVersion'] !== 1) {
        throw new Error('SNAPSHOT.json formatVersion must be 1.');
    }
    if (value['specification'] !== 'OGraf Graphics v1') {
        throw new Error('SNAPSHOT.json specification must be "OGraf Graphics v1".');
    }
    if (value['upstreamRepository'] !== upstreamRepository) {
        throw new Error(`SNAPSHOT.json upstreamRepository must be ${upstreamRepository}.`);
    }

    const commit = value['commit'];
    if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/u.test(commit)) {
        throw new Error('SNAPSHOT.json commit must be a lowercase 40-character Git SHA.');
    }
    const sourceDate = value['sourceDate'];
    if (typeof sourceDate !== 'string' || !isRealIsoDate(sourceDate)) {
        throw new Error('SNAPSHOT.json sourceDate must be a real date in YYYY-MM-DD format.');
    }

    const shortCommit = commit.slice(0, 8);
    const expectedDirectory = `ebu-ograf-v1-${shortCommit}`;
    if (directory !== expectedDirectory) {
        throw new Error(
            `Snapshot directory must be ${expectedDirectory}, received ${directory}.`,
        );
    }

    return Object.freeze({
        commit,
        directory,
        formatVersion: 1,
        shortCommit,
        sourceDate,
        sourceDateDisplay: formatSnapshotDate(sourceDate),
        specification: 'OGraf Graphics v1',
        upstreamRepository,
    });
}

export function loadSnapshotMetadata(root = specRoot) {
    if (!existsSync(root)) throw new Error(`Missing specification directory: ${root}`);
    const directories = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('ebu-ograf-v1-'))
        .map((entry) => entry.name);
    if (directories.length !== 1) {
        throw new Error(
            `Expected exactly one EBU OGraf v1 snapshot directory, found ${String(directories.length)}.`,
        );
    }

    const directory = directories[0];
    if (directory === undefined) throw new Error('Snapshot directory lookup failed.');
    const metadataPath = resolve(root, directory, 'SNAPSHOT.json');
    if (!existsSync(metadataPath)) throw new Error(`Missing snapshot metadata: ${metadataPath}`);

    let value;
    try {
        value = JSON.parse(readFileSync(metadataPath, 'utf8'));
    } catch (error) {
        throw new Error(`Invalid SNAPSHOT.json: ${String(error)}`, { cause: error });
    }
    return validateSnapshotMetadata(value, directory);
}

export function validateSnapshotMarkdown(metadata, markdown) {
    const exactLines = [
        ['- Commit:', `- Commit: \`${metadata.commit}\``],
        [
            '- Commit URL:',
            `- Commit URL: ${metadata.upstreamRepository}/tree/${metadata.commit}`,
        ],
        ['- Source date:', `- Source date: ${metadata.sourceDate}`],
    ];
    const lines = markdown.split(/\r?\n/u);
    for (const [prefix, expected] of exactLines) {
        const matches = lines.filter((line) => line.startsWith(prefix));
        if (matches.length !== 1 || matches[0] !== expected) {
            throw new Error(`SNAPSHOT.md must contain exactly this line: ${expected}`);
        }
    }

    const vendoredPaths = '- Vendored paths: `v1/specification/docs/Specification.md`, ' +
        '`v1/specification/json-schemas/**`, and the four upstream ' +
        '`v1/examples/*.ograf.json` manifests';
    if (!markdown.includes(vendoredPaths)) {
        throw new Error(`SNAPSHOT.md is missing or has a stale line: ${vendoredPaths}`);
    }
}

export function assertSnapshotReferences(references) {
    for (const reference of references) {
        for (const token of reference.tokens) {
            if (!reference.content.includes(token)) {
                throw new Error(
                    `${reference.label} does not reference the active OGraf snapshot token: ${token}`,
                );
            }
        }
    }
}

export function assertCurrentSnapshotReferences(metadata, references) {
    assertSnapshotReferences(references);
    const patterns = [
        {
            label: 'EBU commit URL',
            regex: /https:\/\/github\.com\/ebu\/ograf\/(?:commit|tree)\/([a-f0-9]{7,40})/giu,
            expected: metadata.commit,
        },
        {
            label: 'snapshot directory',
            regex: /ebu-ograf-v1-([a-f0-9]{7,40})/giu,
            expected: metadata.shortCommit,
        },
    ];

    for (const reference of references) {
        for (const pattern of patterns) {
            for (const match of reference.content.matchAll(pattern.regex)) {
                if (match[1] !== pattern.expected) {
                    throw new Error(
                        `${reference.label} contains a stale ${pattern.label}: ${String(match[1])}`,
                    );
                }
            }
        }
    }
}

export const snapshotMetadata = loadSnapshotMetadata();
export const snapshotRoot = resolve(specRoot, snapshotMetadata.directory);
