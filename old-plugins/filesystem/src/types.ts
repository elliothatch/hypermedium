export type Entry = Entry.File | Entry.Directory | Entry.Unknown;
export namespace Entry {
    export interface Base {
        name: string;
        path: string;
    }
    export interface File extends Base {
        fType: 'file',
    }
    export interface Directory extends Base {
        fType: 'dir';
        contents: Entry[];
    }
    export interface Unknown extends Base {
        fType: 'unknown';
    }
}

export interface WatchEvent {
    eType: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
    /** path on disk */
    path: string;
    /** 'relative' path of the file */
    uri: string;
}
