import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { Hypermedia } from './hypermedia';
import * as HAL from './hal';

type FileProcessor<T> = (filePath: string, relativeUri: string, fileContents: string) => T;

function walkDirectory<T>(directoryPath: string, f: FileProcessor<T>, relativeUri: HAL.Uri = ''): Promise<{[uri: string]: T}> {
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

class NotFoundError extends Error {
    public path: string;
    constructor(path: string) {
        super(`Resource not found: ${path}`);
        this.name = this.constructor.name;
        Object.setPrototypeOf(this, NotFoundError);

        this.path = path;
    }
}

class ProcessFileError extends Error {
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

export { walkDirectory, NotFoundError, ProcessFileError };
