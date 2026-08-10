export async function getLocalFile(
    root: FileSystemDirectoryHandle,
    path: string,
): Promise<File> {
    const parts = path.replace(/\\/g, '/').split('/').filter((part) => part.length > 0 && part !== '.');
    const filename = parts.pop();
    if (!filename) throw new Error(`Invalid asset path: "${path}"`);

    let directory = root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    const handle = await directory.getFileHandle(filename);

    return handle.getFile();
}
