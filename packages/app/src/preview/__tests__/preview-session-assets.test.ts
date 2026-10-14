import { describe, expect, it, vi } from 'vitest';
import { createArchiveDirectory } from '../../fs/archive-directory.js';
import {
    createPreviewSession,
    readPreviewSessionBlob,
    readPreviewSessionFile,
} from '../use-preview-sw.js';

describe('session-bound file-backed asset reads', () => {
    it('retains the original Blob without copying its contents into an ArrayBuffer', async () => {
        const file = new File(['PNG bytes'], 'image.png', { type: 'image/png' });
        const read = vi
            .spyOn(file, 'arrayBuffer')
            .mockRejectedValue(new Error('Unexpected full copy'));
        const session = createPreviewSession(
            createArchiveDirectory('package', new Map([['images/image.png', file]])),
        );
        try {
            expect(await readPreviewSessionBlob(session.sessionId, 'images/image.png')).toBe(file);
            expect(read).not.toHaveBeenCalled();
            // Byte consumers still use the explicit ArrayBuffer path.
            await expect(
                readPreviewSessionFile(session.sessionId, 'images/image.png'),
            ).rejects.toThrow('Unexpected full copy');
        } finally {
            session.close();
        }
    });

    it('rejects traversal, absolute paths and reads after the session closes', async () => {
        const session = createPreviewSession(createArchiveDirectory('package', new Map()));
        try {
            await expect(
                readPreviewSessionBlob(session.sessionId, '../outside.png'),
            ).rejects.toThrow('Parent traversal');
            await expect(readPreviewSessionBlob(session.sessionId, '/outside.png')).rejects.toThrow(
                'Absolute',
            );
        } finally {
            session.close();
        }
        await expect(readPreviewSessionBlob(session.sessionId, 'image.png')).rejects.toThrow(
            'not registered',
        );
    });

    it('keeps package ownership and missing-resource causes intact', async () => {
        const first = new File(['first'], 'image.png');
        const second = new File(['second'], 'image.png');
        const a = createPreviewSession(
            createArchiveDirectory('a', new Map([['image.png', first]])),
        );
        const b = createPreviewSession(
            createArchiveDirectory('b', new Map([['image.png', second]])),
        );
        try {
            expect(await readPreviewSessionBlob(a.sessionId, 'image.png')).toBe(first);
            expect(await readPreviewSessionBlob(b.sessionId, 'image.png')).toBe(second);
            await expect(readPreviewSessionBlob(a.sessionId, 'missing.png')).rejects.toMatchObject({
                cause: { name: 'NotFoundError' },
            });
        } finally {
            a.close();
            b.close();
        }
    });
});
