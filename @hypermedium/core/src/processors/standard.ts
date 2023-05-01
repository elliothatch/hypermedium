import * as graphlib from 'graphlib';
import { Processor, ResourceState, HypermediaEngine, JsonLD, JsonLDUtil } from 'hypermedium';
import * as fs from 'fs/promises';

type PropertyPath = JsonLDUtil.PropertyPath;

// import { embed } from './embed';
// import { makeIndex } from './make-index';
// import { tags } from './tags';

// TODO: add matchUri using express router
// TODO: fundamental problem: _embedded is kind of hard to use. not sure how json-ld deals with embedded data.
// We have two overlapping concepts of "embedding" right now, the generic HAL _embedded (see 'embed' processor), and index embedding (see 'index' processor option 'embed'). We need to settle on one kind. this is causing duplicate processor execution for one.
// 'embed' processor links an object directly to resources it depends on. this is good
// 'index' embed only links to the index, not the resources itself. is this good?

export namespace Core {
    export type Processors =
        Processors.Link |
        Processors.Extend |
        Processors.Replace |
        Processors.Copy |
        Processors.CopyState |
        Processors.CopyFile |
        Processors.Embed |
        Processors.ObjectEntries |
        Processors.ObjectKeys |
        Processors.ObjectValues |
        Processors.Insert |
        Processors.Flatten |
        Processors.FlattenObject |
        Processors.MatchType |
        Processors.Map |
        Processors.Sort |
        Processors.Excerpt;

    export namespace Processors {
        export type Link = Processor.Definition<'link', {
            property?: PropertyPath;
            name?: JsonLD.IRI;
        } | undefined>;
        export type Extend = Processor.Definition<'extend', {
            obj: any,
            overwrite: boolean
        }>;
        export type Replace = Processor.Definition<'replace', {
            property: PropertyPath;
        }>;
        export type Copy = Processor.Definition<'copy', {
            /** uri to copy from */
            uri?: JsonLD.IRI;
            /** property to use as the value for uri. if uriProperty is provided, uri is ignored */
            uriProperty?: PropertyPath;
            from: PropertyPath;
            to: PropertyPath;
        }>;
        export type CopyState = Processor.Definition<'copyState', {
            processor: string;
            resourcePath: JsonLD.IRI;
            from: PropertyPath;
            to: PropertyPath;
        }>;
        /** read file at the uri and copy its contents to the resource property. default encoding: 'utf8' */
        export type CopyFile = Processor.Definition<'copyFile', {
            uri: JsonLD.IRI;
            to: PropertyPath;
            encoding?: string;
        }>;
        export type Embed = Processor.Definition<'embed', {
            property: PropertyPath;
            // property: PropertyPath;
            /** rel of the embedded resource.
             * if undefined, uses last part of property path */
            rel?: JsonLD.IRI;
            pick?: PropertyPath[];
            max?: number;
        }>;
        export type ObjectEntries = Processor.Definition<'objectEntries', {
            property?: PropertyPath;
            to?: PropertyPath;
        } | undefined>;
        export type ObjectKeys = Processor.Definition<'objectKeys', {
            property?: PropertyPath;
            to?: PropertyPath;
        } | undefined>;
        export type ObjectValues = Processor.Definition<'objectValues', {
            property?: PropertyPath;
            to?: PropertyPath;
        } | undefined>;
        export type Insert = Processor.Definition<'insert', {
            property?: PropertyPath;
            values: any[];
            index: number;
        }>;
        export type Flatten = Processor.Definition<'flatten', {
            property?: PropertyPath;
        } | undefined>;
        export type FlattenObject = Processor.Definition<'flattenObject', {
            property?: PropertyPath;
            key?: PropertyPath;
        } | undefined>;
        export type Sort = Processor.Definition<'sort', {
            property?: PropertyPath;
            key?: PropertyPath;
            compare?: string;
            descending?: boolean;
        } | undefined>;
        export namespace Sort {
            export type CompareFn = (a: any, b: any) => number;
            export const CompareFns: Record<string, CompareFn> = {
                'number': (a: number, b: number) => a - b,
                'date': (a: string, b: string) => new Date(a).valueOf() - new Date(b).valueOf(),
                'string': (a: string, b: string) => a < b? -1: a > b? 1: 0,
            };
        }
        export type Map = Processor.Definition<'map', {
            processor: Processor;
            property?: PropertyPath,
            /** the property 'toOption' will be overwritten with the value of the element in the array each iteration */
            // toOption: string;
        }>;
        export type MatchType = Processor.Definition<'matchType', {
            ldType: JsonLD.IRI;
            processors: Processor;
        }>;
        export type Excerpt = Processor.Definition<'excerpt', {
            from?: PropertyPath;
            to?: PropertyPath;
            max?: number;
            breakpoint?: 'word';
        }>;
    }
}

export const processorDefinitions: Core.Processors[] = [{
    /** extend each resource with the properties of an object. does not overwrite existing properties unless overwrite is true */
    name: 'extend',
    onProcess: (rs, options) => {
        if(options.overwrite) {
            Object.keys(options.obj).forEach((property) => {
                rs.resource = JsonLDUtil.setProperty(rs.resource, property, options.obj[property]);
            });

        }
        else {
            Object.keys(options.obj).forEach((property) => {
                if(JsonLDUtil.getProperty(rs.resource, property) === undefined) {
                    rs.resource = JsonLDUtil.setProperty(rs.resource, property, options.obj[property]);
                }
            });
        }

        return rs.resource;
    }
}, {
    /** replace an entire resource with one of its properties. usually only useful inside a 'map' processor */
    name: 'replace',
    onProcess: (rs, options) => {
        rs.resource = JsonLDUtil.getProperty(rs.resource, options.property);
        return rs.resource;
    }
}, {
    name: 'insert',
    onProcess: (rs, options) => {
        if(!Array.isArray(options.values)) {
            options.values = [options.values];
        }

        const value = JsonLDUtil.getProperty(rs.resource, options.property);
        if(value == undefined) {
            rs.resource = JsonLDUtil.setProperty(rs.resource, options.property, options.values)
            return rs.resource;
        }
        else if(!Array.isArray(value)) {
            // make the existing value the first value in the array
            rs.resource = JsonLDUtil.setProperty(rs.resource, options.property, [value, ...options.values]);
            return rs.resource;
        }

        value.splice(options.index == undefined? value.length: options.index, 0, ...options.values);
        return rs.resource;
    }
}, {
    name: 'flatten',
    onProcess: (rs, options) => {
        const value = JsonLDUtil.getProperty(rs.resource, options?.property);
        if(!Array.isArray(value)) {
            rs.logger.warn(`skipping flatten: '${options?.property || 'resource'}': must be an array, but has type ${typeof value}`);
            return rs.resource;
        }

        const flatArray = value.reduce((array, subArray) => array.concat(subArray), []);

        rs.resource = JsonLDUtil.setProperty(rs.resource, options?.property, flatArray);
        return rs.resource;
    }
}, {
    name: 'flattenObject',
    onProcess: (rs, options) => {
        const obj = JsonLDUtil.getProperty(rs.resource, options?.property);
        if(typeof obj !== 'object') {
            rs.logger.warn(`skipping flattenObject: '${options?.property || 'resource'}': must be an object, but has type ${typeof obj}`);
            return rs.resource;
        }

        const flatArray = Object.keys(obj).reduce((array, property) => {
            const elements = Array.isArray(obj[property])?
                    obj[property]:
                    [obj[property]];

            if(options?.key) {
                elements.forEach((e: any) => {
                    JsonLDUtil.setProperty(e, options.key, property);
                });
            }

            return array.concat(elements)
        }, []);

        rs.resource = JsonLDUtil.setProperty(rs.resource, options?.property, flatArray);
        return rs.resource;
    }
}, {
    name: 'copy',
    onProcess: (rs, options) => {
        const resource = options.uriProperty?
            rs.getResource(JsonLDUtil.getProperty(options.uriProperty)):
            options.uri?
            rs.getResource(options.uri):
            rs.resource;

        if(!resource) {
            if(options.uriProperty) {
                rs.logger.error(`Resource not found: ${JsonLDUtil.getProperty(options.uriProperty)} (from ${options.uriProperty})`);
            }
            else {
                rs.logger.error(`Resource not found: ${options.uri}`);
            }
            return rs.resource;
        }

        // deep clone so we don't accidentally modify the source
        const sourceValue = JsonLDUtil.getProperty(resource, options.from);
        // parse(stringify()) doesn't work on undefined or null
        const value = sourceValue == undefined?
            sourceValue:
            JSON.parse(JSON.stringify(sourceValue));
        rs.logger.trace(`copy '${value}'`);
        rs.resource = JsonLDUtil.setProperty(rs.resource, options.to, value);
        return rs.resource;
    }
}, {
    name: 'copyFile',
    onProcess: (rs, options) => {
        //TODO: rethink how files interact with processors. don't reload HAL resources from disk since they are already in memory
        const path = rs.getFile(options.uri);
        if(path === undefined) {
                rs.logger.error(`skipping copyFile: '${options.uri} has not been loaded as a file.'`);
                return rs.resource;
        }
        return fs.readFile(path, (options.encoding || 'utf8') as BufferEncoding).then((contents: any) => {
            rs.resource = JsonLDUtil.setProperty(rs.resource, options.to, contents);
            return rs.resource;
        });
    }
}, {
    name: 'objectEntries',
    onProcess: (rs, options) => {

        if(!options || !options.property) {
            return Object.entries(rs.resource);
        }

        const obj = JsonLDUtil.getProperty(rs.resource, options.property);
        rs.resource = JsonLDUtil.setProperty(rs.resource, options.to || options.property, Object.entries(obj));

        return rs.resource;
    }
}, {
    name: 'objectKeys',
    onProcess: (rs, options) => {
        if(!options || !options.property) {
            return Object.keys(rs.resource);
        }

        const obj = JsonLDUtil.getProperty(rs.resource, options.property);
        rs.resource = JsonLDUtil.setProperty(rs.resource, options.to || options.property, Object.keys(obj));

        return rs.resource;
    }
}, {
    name: 'objectValues',
    onProcess: (rs, options) => {
        if(!options || !options.property) {
            return Object.values(rs.resource);
        }

        const obj = JsonLDUtil.getProperty(rs.resource, options.property);
        rs.resource = JsonLDUtil.setProperty(rs.resource, options.to || options.property, Object.values(obj));

        return rs.resource;
    }
}, {
//     /* higher-order processor that only runs the provided processor if the resource matches the designated profile */
    name: 'matchType',
    onProcess: (rs, options) => {
        // TODO: replace with matchType
        if(!JsonLDUtil.matchesType(rs.resource, options.ldType)) {
            return rs.resource;
        }

        return rs.execProcessor(options.processors, rs.resource);
    }
}, {
    name: 'map',
    /** run a processor for each element in an array, using the element as the resource. Works on objects, but cannot provide the object key.
* TODO: accept array of processors
* */
    onProcess: (rs, options) => {
        const values = JsonLDUtil.getProperty(rs.resource, options.property);
        if(!Array.isArray(values) && typeof values !== 'object') {
            rs.logger.error(`skipping map: '${options.property}' must be an array or object, but had type ${typeof values}`);
            return rs.resource;
        }

        const valuesArray: {value: any, index: string | number}[] = Array.isArray(values)?
            values.map((value, index) => ({value, index})):
            Object.keys(values).map((index) => ({value: values[index], index}));

        return valuesArray.reduce((execPromise, {value, index}) => {
            return execPromise.then((_) => {
                return rs.execProcessor(options.processor, value).then((result) => {
                    values[index] = result;
                    return result;
                });
            });
        }, Promise.resolve(rs.resource)).then(() => {
            return rs.resource;
        });
    }
}, {
    // TODO: thoughts: shoulds sort auto-embed missing properties? YES!
    name: 'sort',
    /** sort array or */
    onProcess: (rs, options) => {
        const compareFns = {
            ...Core.Processors.Sort.CompareFns
            // ...rs.internalState.sort.compareFns
        };

        let baseCompareFn =  compareFns[options?.compare || 'string'] || compareFns['string'];
        const compareFn = options?.descending?
                (a: any, b: any) => baseCompareFn(b, a):
                baseCompareFn;

        const array = JsonLDUtil.getProperty(rs.resource, options?.property);

        if(!Array.isArray(array)) {
            rs.logger.warn(`skipping sort: '${options?.property}' must be an array`);
            return rs.resource;
        }

        array.sort((a: any, b: any) => {
            let aVal = JsonLDUtil.getProperty(a, options?.key);
            let bVal = JsonLDUtil.getProperty(b, options?.key);

            if(aVal === undefined && a?.href && options?.key) {
                const aResource = rs.getResource(a.href);
                aVal = JsonLDUtil.getProperty(aResource, options.key);
            }

            if(bVal === undefined && b?.href && options?.key) {
                const bResource = rs.getResource(b.href);
                bVal = JsonLDUtil.getProperty(bResource, options.key);
            }

            return compareFn(aVal, bVal);
        });

        rs.resource = JsonLDUtil.setProperty(rs.resource, options?.property, array);

        return rs.resource;
    }
}, {
    /** create an excerpt summary from the first N words or paragraphs of a property.
     * reads options from _excerpt and add the result as the "excerpt" property, then delete _excerpt */
    name: 'excerpt',
    onProcess: (rs, options) => {
        const text = JsonLDUtil.getProperty(rs.resource, options.from);
        if(!text || typeof text !== 'string') {
            rs.logger.warn(`skipping excerpt: '${options.from}' must be a string`);
            return rs.resource;
        }

        // TODO: this regex cuts off traililng punctuation, hyphenated text, etc
        const wordRegex = /\S+/g;
        let matches: RegExpExecArray | null;
        let lastIndex = 0;
        let matchCount = 0;
        while((matches = wordRegex.exec(text)) && matchCount < (options.max || 50)) {
            lastIndex = wordRegex.lastIndex;
            matchCount++;
        }

        let excerpt = text.substring(0, lastIndex);
        if(lastIndex < text.length) {
            excerpt += '...';
        }

        return JsonLDUtil.setProperty(rs.resource, options.to, excerpt);
    }
}];
