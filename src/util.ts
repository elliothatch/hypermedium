import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { merge, forkJoin, Observable, of, from, empty, fromEventPattern, Subject } from 'rxjs';
import { map, mergeMap, catchError, takeUntil } from 'rxjs/operators';

import * as chokidar from 'chokidar';

import { Hypermedia } from './hypermedia';
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

/** finds all files at the specified paths. all files in a directory are read, recursively
 * the first invocation has baseUri '.', which means that any directories in "paths" will not add their basename to the output URI for its contents--effectively "flattening" the directory 
 */
export function loadFiles(paths: string[], baseUri: HAL.Uri = '.'): Observable<File | FileError> {
    return merge(...paths.map((path) => {
        const uri = baseUri === '.' || baseUri.length === 0?
            Path.basename(path):
            `${baseUri}/${Path.basename(path)}`;
        return from(fs.lstat(path)).pipe(
            mergeMap((stat) => {
                if(stat.isFile()) {
                    return from(fs.readFile(path, 'utf-8')).pipe(
                        map((contents) => ({
                            path,
                            uri,
                            contents: contents as string,
                        })),
                        catchError((error) => {
                            // failed to load file
                            return of({
                                path,
                                uri,
                                error
                            });
                        })
                    );
                }
                else {
                    return from(fs.readdir(path)).pipe(
                        mergeMap((files) => {
                            return loadFiles(
                                files.map((file) => Path.join(path, file)),
                                baseUri === '.'? '': uri
                            );
                        }),
                        catchError((error) => {
                            // failed to load directory
                            return of({
                                path,
                                uri,
                                error
                            });
                        })
                    );
                }
            }),
            catchError((error) => {
                // failed to load path
                return of({
                    path,
                    uri,
                    error
                });
            })
        );
    }));
}

export function walkDirectory<T>(directoryPath: string, f: FileProcessor<T>, relativeUri: HAL.Uri = ''): Promise<{[uri: string]: T}> {
    return fs.readdir(directoryPath).then((files) => {
        return Promise.all(files.map((filename) => {
            const filePath = Path.join(directoryPath, filename);
            const fileRelativeUri = `${relativeUri}/${filename}`;
            return fs.lstat(filePath).then((stats) => {
                if(stats.isFile()) {
                    return fs.readFile(filePath, 'utf8').then(
                        (contents) => ({[fileRelativeUri]: f(filePath, fileRelativeUri, contents)})
                    ).catch((error) => {
                        throw new ProcessFileError(filePath, error);
                    });
                }
                else if(stats.isDirectory()) {
                    return walkDirectory(filePath, f, fileRelativeUri);
                }
                else {
                    return Promise.resolve({});
                }
            });
        })).then((resources) => resources.reduce(
            (resourceMap, resource) => Object.assign(resourceMap, resource), {})
        );
    });
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
export function objectDifference<A extends any, B extends any>(a: A, b: B): Exclude<A, B> {
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

export interface WatchEvent {
    eType: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
    path: string;
    uri: string;
}

export interface Watcher<T = WatchEvent> {
    events: Observable<T>;
    close: () => void;
}

/** watch a file or directory (recursively) and emit events when files and directories are added, changed, or removed
 * @returns object with an observable of the watch events, and a function that can be used to stop watching the files
 */
export function watchFiles(path: string | string[], uriPrefix?: string): Watcher {
    const paths = Array.isArray(path)? path: [path];

    const closeSubject = new Subject<boolean>();
    const watchers = paths.map((path) => ({path, watcher: chokidar.watch(path)}));
    const eventObservables = watchers.map(({path, watcher}) => {
        return fromEventPattern<[string, string]>((addHandler) => {
            ['add', 'change', 'unlink', 'addDir', 'unlinkDir'].forEach((eventName) => {
                watcher.on(eventName, (...args: any[]) => addHandler(eventName, ...args));
            });
        }).pipe(
            map(([eventType, filename]) => {
                return {
                    eType: eventType,
                    path: filename,
                    uri: (uriPrefix || '') + '/' + Path.relative(path, filename).replace(/\\/g, '/'),
                } as WatchEvent;
            }),
            takeUntil(closeSubject),
        );
    });

    return {
        events: merge(...eventObservables),
        close: () => {
            watchers.forEach((watcher) => {
                watcher.watcher.close();
            });
            closeSubject.next(true);
            closeSubject.complete();
        }
    };
}
