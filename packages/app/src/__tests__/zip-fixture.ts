import { deflateRawSync } from 'node:zlib';

export interface ZipFixtureEntry {
    name: string;
    content: string | Uint8Array;
    stored?: boolean;
    attributes?: number;
    declaredSize?: number;
    flags?: number;
}

export function zipFixture(entries: ZipFixtureEntry[]): Uint8Array<ArrayBuffer> {
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name);
        const data = Buffer.from(entry.content);
        let crc = 0xffffffff;
        for (const byte of data) {
            crc ^= byte;
            for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        const compressed = entry.stored ? data : deflateRawSync(data);
        const method = entry.stored ? 0 : 8;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(entry.flags ?? 0x800, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(entry.declaredSize ?? data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50);
        cd.writeUInt16LE(0x314, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(entry.flags ?? 0x800, 8);
        cd.writeUInt16LE(method, 10);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(compressed.length, 20);
        cd.writeUInt32LE(entry.declaredSize ?? data.length, 24);
        cd.writeUInt16LE(name.length, 28);
        cd.writeUInt32LE(entry.attributes ?? 0, 38);
        cd.writeUInt32LE(offset, 42);
        locals.push(local, name, compressed);
        central.push(cd, name);
        offset += local.length + name.length + compressed.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
