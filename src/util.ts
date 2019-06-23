import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { Hypermedia } from './hypermedia';
import * as HAL from './hal';

export type FileProcessor<T> = (filePath: string, relativeUri: string, fileContents: string) => T;

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
