import { Processor } from '../hypermedia/processor';
import * as Path from 'path';
import { promises as fs } from 'fs';

import { Plugin } from '../plugin';

export namespace FileSystem {
    export const Plugin: Plugin.Factory = (options) => {
        return {
            name: 'filesystem',
            websocketMiddleware: (socket, next) => {
                socket.on('filesystem/files', (data) => {
                    socket.emit('filesystem/files', getEntry(options.basePath, ''));
                });
            },
        };
    };

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

    /**
     * Get the file entry for the specified path. If it is a directory recursively gets the directory contents. base path is not included in the 'path' property
     * @param basePath: path to the base directory
     * @param relativePath: relative path to the target file/directory
     * */
    export function getEntry(basePath: string, relativePath: string): Promise<Entry> {
        const filePath = Path.join(basePath, relativePath);
        const name = Path.basename(relativePath);
        const path = relativePath.replace(/\\/g, '/');
        return fs.lstat(filePath).then((stats) => {
            if(stats.isFile()) {
                return {
                    fType: 'file',
                    name,
                    path,
                };
            }
            else if(stats.isDirectory()) {
                return fs.readdir(filePath).then((files) => {
                    return Promise.all(files.map((filename) => {
                        return getEntry(basePath, Path.join(relativePath, filename));
                    }));
                }).then((entries) => {
                    return {
                        fType: 'dir',
                        name,
                        path,
                        contents: entries
                    };
                });
            }
            else {
                return {
                    fType: 'unknown',
                    name,
                    path,
                };
            }
        });
    }
}
