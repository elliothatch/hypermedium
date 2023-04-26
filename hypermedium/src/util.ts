import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { merge, forkJoin, Observable, of, from, empty, fromEventPattern, Subject, using, Unsubscribable } from 'rxjs';
import { map, mergeMap, catchError, takeUntil } from 'rxjs/operators';

import * as chokidar from 'chokidar';

import * as HAL from './hal';

export type FileProcessor<T> = (filePath: string, relativeUri: string, fileContents: string) => T;

export interface File {
    path: string;
    uri: string;
    contents: string;
}

export interface FileError {
    path: string;
    uri: string;
    error: Error;
}

export class NotFoundError extends Error {
    public path: string;
    constructor(path: string) {
        super(`Resource not found: ${path}`);
        this.name = this.constructor.name;
        Object.setPrototypeOf(this, NotFoundError);

        this.path = path;
    }
}

export class ProcessFileError extends Error {
    public filePath: string;
    public innerError: Error;
    constructor(filePath: string, innerError: Error) {
        super(`${filePath}: processing error. ${innerError.message || ''}`);
        this.name = this.constructor.name;
        Object.setPrototypeOf(this, ProcessFileError);

        this.filePath = filePath;
        this.innerError = innerError;
    }
}

// TODO: more descriptive schemas. number ranges, string matches, array descriptors
// export namespace Schema {
    /** describes the type of a value in a JSON object
     * the value may be the URI of another schema */
export type Schema = 'string' | 'number' | 'array' | 'null' | 'undefined' | HAL.Uri | {[prop: string]: Schema };
// }

export function createSchema(target: any): Schema {
    if(typeof target === 'number') {
        return 'number';
    }
    if(typeof target === 'string') {
        return 'string';
    }
    if(Array.isArray(target)) {
        return 'array';
    }
    if(typeof target === 'object') {
        if(target === null) {
            return 'null';
        }
        else {
            return Object.keys(target).reduce((obj, prop) => {
                obj[prop] = createSchema(target[prop]);
                return obj;
            }, {} as any);
        }
    }

    return 'undefined';
}

/** returns a copy of "a" that does not contain any properties of "b" */
export function objectDifference<A extends {[propery: string]: any}, B extends {[propery: string]: any}>(a: A, b: B): Exclude<A, B> {
    return Object.keys(a).reduce((obj, prop) => {
        if(!b[prop]) {
            obj[prop] = a[prop];
        }
        else if(typeof a[prop] === 'object' && a[prop] !== null && typeof b[prop] === 'object' && b[prop] !== null) {
            obj[prop] = objectDifference(a[prop], b[prop]);
        }

        return obj;
    }, {} as any);
}

export type WatchEvent = WatchEvent.File | WatchEvent.Ready;
export namespace WatchEvent {
    export interface File {
        eType: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
        path: string;
        uri: string;
    }
    export interface Ready {
        /** ready event is fired after the initial scan of files has completed. */
        eType: 'ready';
    }
}

/** watch a file or directory (recursively) and emit events when files and directories are added, changed, or removed
 * @returns object with an observable of the watch events, and a function that can be used to stop watching the files
 */
export function watchFiles(path: string | string[], uriPrefix?: string, chokidarOptions?: any): Observable<WatchEvent> {
    return using(() => {
        const paths = Array.isArray(path)? path: [path];
        const watchers = paths.map((path) => ({path, watcher: chokidar.watch(path, chokidarOptions)}));
        return {
            watchers,
            unsubscribe: () => {
                watchers.forEach((watcher) => {
                    watcher.watcher.close();
                });
            },
        };
    }, (resource) => {
        const watchers = (resource as ({watchers: Array<{path: string, watcher: chokidar.FSWatcher}>} & Unsubscribable)).watchers;
        // TODO: are rxjs types for "using" incorrect?
        const eventObservables = watchers.map(({path, watcher}) => {
            return fromEventPattern<[string, string, any]>((handler) => {
                ['add', 'change', 'unlink', 'addDir', 'unlinkDir', 'ready'].forEach((eventName) => {
                    watcher.on(eventName, (...args: any[]) => handler([eventName, ...args]));
                });
            }).pipe(
                map(([eventType, filename, stats]) => {
                    if(eventType === 'ready') {
                        return {
                            eType: 'ready' as const,
                        };
                    }

                    // file event
                    return {
                        eType: eventType as 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir',
                        path: filename,
                        uri: Url.resolve(uriPrefix || '', Path.relative(path, filename).replace(/\\/g, '/')),
                    };
                }),
            );
        });

        return merge(...eventObservables);
    });
}

/**
* @returns true if the filePath ends with any of the strings in extensions
 */
export function matchesFullExtension(filePath: string, extensions: string[]): boolean {
    const basename = Path.basename(filePath);
    for(let i = 0; i < extensions.length; i++) {
        if(basename.endsWith(extensions[i])) {
            return true;
        }
    }
    return false;
}
