import * as graphlib from 'graphlib';
import { Processor, ResourceState, HypermediaEngine, Hal, HalUtil } from 'hypermedium';
import * as fs from 'fs/promises';

type PropertyPath = HalUtil.PropertyPath;

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
        Processors.Self |
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
        Processors.MatchProfile |
        Processors.Map |
        Processors.Sort |
        Processors.Index |
        Processors.GetIndex |
        Processors.Excerpt |
        Processors.ResourceGraph;

    export namespace Processors {
        export type Self = Processor.Definition<'self'>;
        export type Link = Processor.Definition<'link', {
            property?: PropertyPath;
            name?: Hal.Uri;
        } | undefined>;
        export type Extend = Processor.Definition<'extend', {
            obj: any,
            overwrite: boolean
        }>;
        export type Replace = Processor.Definition<'replace', {
            property: PropertyPath;
        }>;
        export type Copy = Processor.Definition<'copy', {
            uri?: Hal.Uri;
            from: PropertyPath;
            to: PropertyPath;
        }>;
        export type CopyState = Processor.Definition<'copyState', {
            processor: string;
            resourcePath: Hal.Uri;
            from: PropertyPath;
            to: PropertyPath;
        }>;
        /** read file at the uri and copy its contents to the resource property. default encoding: 'utf8' */
        export type CopyFile = Processor.Definition<'copyFile', {
            uri: Hal.Uri;
            to: PropertyPath;
            encoding?: string;
        }>;
        export type Embed = Processor.Definition<'embed', {
            property: PropertyPath;
            // property: PropertyPath;
            /** rel of the embedded resource.
             * if undefined, uses last part of property path */
            rel?: Hal.Uri;
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
        export type MatchProfile = Processor.Definition<'matchProfile', {
            profile: Hal.Uri;
            baseUri?: Hal.Uri;
            processors: Processor;
        }>;
        export type Index = Processor.Definition<'index', {
            /** dot-notation of the property to use as the index */
            property: string;
            /** list of properties to embed on index pages */
            embed?: PropertyPath[];
            // filter: string;
        }>;
        export namespace Index {
            export type State = {[property: string]: PropertyIndex};
            export interface PropertyIndex {
                index: {[value: string]: {[uri: string]: true}};
                /** neeeded to quickly remove all instances of Uri from index */
                reverseIndex: {[uri: string]: {[value: string]: true}};
            }
        }

        export type GetIndex = Processor.Definition<'getIndex', {
            /** property of index */
            property: string;
            /** if provided, only return matching values */
            filter: string;
            to: PropertyPath;
        }>;

        export type Excerpt = Processor.Definition<'excerpt', {
            from?: PropertyPath;
            to?: PropertyPath;
            max?: number;
            breakpoint?: 'word';
        }>;

        export type ResourceGraph = Processor.Definition<'resourceGraph', {
        }>;
    }
}

export const processorDefinitions: Core.Processors[] = [{
    name: 'self',
    onProcess: (rs, options) => {
        HalUtil.setProperty(rs.resource, '_links.self.href', rs.uri);
        if(!HalUtil.getProperty(rs.resource, '_links.self.title')) {
            HalUtil.setProperty(rs.resource, '_links.self.title', rs.resource.title);
        }

        const profiles = HalUtil.getProfiles(rs.resource);
        if(profiles.length > 0) {
            HalUtil.setProperty(rs.resource, '_links.self.profile', profiles[0].href);
        }

        return rs.resource;
    }
}, {
    name: 'link',
    /** maps the uri to a HAL.Link by extracting data from the target resource
     *  - uses "self" link if it exists
     *  - otherwise, tries to scrape title, profile
     *  */
    onProcess: (rs, options) => {
        const uri = HalUtil.getProperty(rs.resource, options?.property);
        if(typeof uri !== 'string') {
            rs.logger.warn(`skipping link: '${options?.property}' must be a string`);
            return rs.resource;
        }
        const resource = rs.getResource(uri);
        if(!resource) {
            throw new Error(`Resource not found: ${uri}`);
        }

        rs.resource = HalUtil.setProperty(rs.resource, options?.property, HalUtil.makeLink(resource, uri, options?.name));
        return rs.resource;
    }
}, {
    /** extend each resource with the properties of an object. does not overwrite existing properties unless overwrite is true */
    name: 'extend',
    onProcess: (rs, options) => {
        if(options.overwrite) {
            Object.keys(options.obj).forEach((property) => {
                rs.resource = HalUtil.setProperty(rs.resource, property, options.obj[property]);
            });

        }
        else {
            Object.keys(options.obj).forEach((property) => {
                if(HalUtil.getProperty(rs.resource, property) === undefined) {
                    rs.resource = HalUtil.setProperty(rs.resource, property, options.obj[property]);
                }
            });
        }

        return rs.resource;
    }
}, {
    /** replace an entire resource with one of its properties. usually only useful inside a 'map' processor */
    name: 'replace',
    onProcess: (rs, options) => {
        rs.resource = HalUtil.getProperty(rs.resource, options.property);
        return rs.resource;
    }
}, {
    name: 'insert',
    onProcess: (rs, options) => {
        if(!Array.isArray(options.values)) {
            options.values = [options.values];
        }

        const value = HalUtil.getProperty(rs.resource, options.property);
        if(value == undefined) {
            rs.resource = HalUtil.setProperty(rs.resource, options.property, options.values)
            return rs.resource;
        }
        else if(!Array.isArray(value)) {
            // make the existing value the first value in the array
            rs.resource = HalUtil.setProperty(rs.resource, options.property, [value, ...options.values]);
            return rs.resource;
        }

        value.splice(options.index == undefined? value.length: options.index, 0, ...options.values);
        return rs.resource;
    }
}, {
    name: 'flatten',
    onProcess: (rs, options) => {
        const value = HalUtil.getProperty(rs.resource, options?.property);
        if(!Array.isArray(value)) {
            rs.logger.warn(`skipping flatten: '${options?.property || 'resource'}': must be an array, but has type ${typeof value}`);
            return rs.resource;
        }

        const flatArray = value.reduce((array, subArray) => array.concat(subArray), []);

        rs.resource = HalUtil.setProperty(rs.resource, options?.property, flatArray);
        return rs.resource;
    }
}, {
    name: 'flattenObject',
    onProcess: (rs, options) => {
        const obj = HalUtil.getProperty(rs.resource, options?.property);
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
                    HalUtil.setProperty(e, options.key, property);
                });
            }

            return array.concat(elements)
        }, []);

        rs.resource = HalUtil.setProperty(rs.resource, options?.property, flatArray);
        return rs.resource;
    }
}, {
    name: 'copy',
    onProcess: (rs, options) => {
        const resource = options.uri?
            rs.getResource(options.uri):
            rs.resource;

        if(!resource) {
            return rs.resource;
        }

        const value = HalUtil.getProperty(resource, options.from);
        rs.resource = HalUtil.setProperty(rs.resource, options.to, value);
        return rs.resource;
    }
}, {
    name: 'copyState',
    onProcess: (rs, options) => {
        const uri = `/~hypermedium/state/${options.processor || rs.processor.name}/${options.resourcePath || ''}`;
        const resource = rs.getResource(uri);
        if(!resource) {
            rs.logger.error(`skipping copyState: '${uri}' not found`);
            return rs.resource;
        }

        const value = JSON.parse(JSON.stringify(HalUtil.getProperty(resource, options.from)));
        rs.resource = HalUtil.setProperty(rs.resource, options.to, value);
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
            rs.resource = HalUtil.setProperty(rs.resource, options.to, contents);
            return rs.resource;
        });
    }
}, {
    name: 'embed',
    onProcess: (rs, options) => {
        let links = HalUtil.getProperty(rs.resource, options.property);
        links = Array.isArray(links)? links: [links];
        if(options.max) {
            links = links.slice(0, options.max);
        }

        links.forEach((link: any) => {
            if(!link?.href) {
                rs.logger.warn(`embed: link '${options.property}' must have an href property to embed`, {link});
            }

            let resource = rs.getResource(link.href);
            if(!resource) {
                rs.logger.warn(`embed: resource not found '${link.href}'`, {link});
            }

            if(options.pick) {
                const defaultProperties = [
                    '_links.self', 
                    '_links.profile', 
                ];
                resource = [...defaultProperties, ...options.pick].reduce((obj, property) => {
                    return HalUtil.setProperty(obj, property, HalUtil.getProperty(resource, property));
                }, {});
            }

            const rel = options.rel ||
                Array.isArray(options.property)?
                    options.property.slice(-1)[0]:
                    options.property.split('.').slice(-1)[0];
            let embeddedArray = HalUtil.getProperty(rs.resource, ['_embedded', rel]);
            if(!embeddedArray) {
                embeddedArray = [];
            }
            else if(!Array.isArray(embeddedArray)) {
                embeddedArray = [embeddedArray];
            }
            // const embeddedResource = embeddedArray.find((r) => r?._links?.self === link.href);
            // TODO: copy all copy all properties onto embedded obj
            // if(embeddedResource) {
                // HalUtil.setProperty(embeddedResource, 
                // embeddedResource.
            // Object.keys(options.obj).forEach((property) => {
                // if(HalUtil.getProperty(rs.resource, property) === undefined) {
                //     rs.resource = HalUtil.setProperty(rs.resource, property, options.obj[property]);
                // }
            // });
            // }
            // else {
                rs.resource = HalUtil.setProperty(rs.resource, ['_embedded', rel], [...embeddedArray, resource]);
            // }
        });
        return rs.resource;
    }
}, {
    name: 'objectEntries',
    onProcess: (rs, options) => {

        if(!options || !options.property) {
            return Object.entries(rs.resource);
        }

        const obj = HalUtil.getProperty(rs.resource, options.property);
        rs.resource = HalUtil.setProperty(rs.resource, options.to || options.property, Object.entries(obj));

        return rs.resource;
    }
}, {
    name: 'objectKeys',
    onProcess: (rs, options) => {
        if(!options || !options.property) {
            return Object.keys(rs.resource);
        }

        const obj = HalUtil.getProperty(rs.resource, options.property);
        rs.resource = HalUtil.setProperty(rs.resource, options.to || options.property, Object.keys(obj));

        return rs.resource;
    }
}, {
    name: 'objectValues',
    onProcess: (rs, options) => {
        if(!options || !options.property) {
            return Object.values(rs.resource);
        }

        const obj = HalUtil.getProperty(rs.resource, options.property);
        rs.resource = HalUtil.setProperty(rs.resource, options.to || options.property, Object.values(obj));

        return rs.resource;
    }
}, {
//     /* higher-order processor that only runs the provided processor if the resource matches the designated profile */
    name: 'matchProfile',
    onProcess: (rs, options) => {
        if(!HalUtil.matchesProfile(rs.resource, options.profile, options.baseUri)) {
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
        const values = HalUtil.getProperty(rs.resource, options.property);
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

        const array = HalUtil.getProperty(rs.resource, options?.property);

        if(!Array.isArray(array)) {
            rs.logger.warn(`skipping sort: '${options?.property}' must be an array`);
        }

        array.sort((a: any, b: any) => {
            let aVal = HalUtil.getProperty(a, options?.key);
            let bVal = HalUtil.getProperty(b, options?.key);

            if(aVal === undefined && a?.href && options?.key) {
                const aResource = rs.getResource(a.href);
                aVal = HalUtil.getProperty(aResource, options.key);
            }

            if(bVal === undefined && b?.href && options?.key) {
                const bResource = rs.getResource(b.href);
                bVal = HalUtil.getProperty(bResource, options.key);
            }

            return compareFn(aVal, bVal);
        });

        rs.resource = HalUtil.setProperty(rs.resource, options?.property, array);

        return rs.resource;
    }
}, {
    name: 'index',
    onProcess: (rs: ResourceState, options) => {
        // never index the indexes (we handle that ourselves to prevent cycles)
        // const stateUri = rs.getState('_links.self.href');
        // if(typeof stateUri === 'string') {
            // const baseStateUri = stateUri.substring(0, stateUri.lastIndexOf('/'));
            // if(rs.uri.startsWith(baseStateUri)) {
                // return rs.resource;
            // }
        // }

        // never index state resources to prevent cycles
        // if(rs.uri.startsWith('/~hypermedium/state')) {
                // return rs.resource;
        // }

        let values = HalUtil.matchProperty(rs.resource, options.property);

        if(values.length === 0) {
            return rs.resource;
        }

        const embeddedProperties = (options.embed || []).reduce((obj, propertyPath) => {
                const embed = HalUtil.getProperty(rs.resource, propertyPath);
                if(embed == undefined) {
                    return obj;
                }
                return HalUtil.setProperty(obj, propertyPath, embed);
        }, {});

        values.forEach((value: any) => {
            const valueStr = '' + value;
            const resourcePath = valueStr.startsWith('/')?
                options.property + valueStr:
                options.property + '/' + valueStr;

            // TODO: embed _links.item on top level indexes, embed options.embed on main indexes and on embedded links.items
            // putting processors in the index does not work how we want
            // instead, we populate each index value with embeded info (instead of true), and create the link list in getIndex
            // const indexProcessors = (name: string) => [{
            //     name: 'objectKeys',
            //     options: {
            //         property: 'index',
            //         to: '_links.item'
            //     }
            // }, {
            //     name: 'map',
            //     options: {
            //         property: '_links.item',
            //         processor: {
            //             name: 'link',
            //             options: {
            //                 name: name
            //             }
            //         }
            //     }
            // }];

            const addProfile = (resourcePath: string, profile: Hal.Uri) => {
                const state = rs.getState('', resourcePath);
                if(!HalUtil.matchesProfile(state, profile)) {
                    const profiles = HalUtil.getProfiles(state);
                    rs.setState('_links.profile', [
                        {href: profile},
                        ...profiles
                    ], resourcePath);
                }
            }

            // setting state initializes the state object if it doesn't exist
            // rs.setState('_processors', indexProcessors(valueStr), resourcePath);
            rs.setState('title', `Index of ${valueStr} in ${options.property}`, resourcePath);
            rs.setState('_links.self.title', `${valueStr}`, resourcePath);
            addProfile(resourcePath,  `/schema/index`);
            addProfile(resourcePath,  `/schema/index/${resourcePath}`);

            rs.setState(['index', rs.uri], embeddedProperties, resourcePath);

            // add this index page to the index of indexes
            const indexStateUri = rs.getState('_links.self.href', resourcePath);
            // rs.setState('_processors', indexProcessors(options.property), options.property);
            rs.setState('title', `Index of ${options.property}`, options.property);
            rs.setState('_links.self.title', `${options.property}`, options.property);
            addProfile(resourcePath,  `/schema/index`);
            addProfile(options.property, `/schema/index/${options.property}`);

            rs.setState(['index', indexStateUri], {}, options.property);


            const propertyStateUri = rs.getState('_links.self.href', options.property);
            // rs.setState('_processors', indexProcessors);
            addProfile(resourcePath,  `/schema/index`);
            addProfile(options.property, `/schema/index`);

            rs.setState(['index', propertyStateUri], {});
        });

        return rs.resource;
    },
}, {
    name: 'getIndex',
    onProcess: (rs, options) => {
        const resourcePath = !options.filter?
            options.property:
            options.filter.startsWith('/')? 
            options.property +  options.filter:
            options.property + '/' + options.filter;

        // copy index object, then copy the key into the "embedded properties" object and use that object as the link.
        // this will insert all the embedded properties into the link, which puts a bunch of non-standard properties into the link.
        // TODO: put the embedded properties somewhere else (_embed), only copy relevant embeds into the link (title, type, profile, etc.)

        return rs.execProcessor([{
            name: 'copyState',
            options: {
                processor: 'index',
                resourcePath,
                from: 'index',
                to: options.to
            }
        }]).then(() => {
            const items = Object.entries(HalUtil.getProperty(rs.resource, options.to)).reduce((links, [uri, embedded]) => {
                    links.push({
                        href: uri,
                        profile: options.filter,
                        ...(embedded as any)
                    });
                    return links;
            }, [] as Hal.Link[]);

            HalUtil.setProperty(rs.resource, options.to, items);

            return rs.execProcessor([{
                name: 'insert',
                options: {
                    property: '_links.profile',
                    values: [
                        {href: `/schema/index/${resourcePath}`},
                        {href: `/schema/index`},
                    ]
                }
            }]);
        });

        // implemented with only processors for some reason
        // return rs.execProcessor([{
        //     name: 'copyState',
        //     options: {
        //         processor: 'index',
        //         resourcePath,
        //         from: 'index',
        //         to: options.to
        //     }
        // }, {
        //     name: 'objectEntries',
        //     options: {
        //         property: options.to
        //     }
        // }, {
        //     name: 'map',
        //     options: {
        //         property: options.to,
        //         processor: {
        //             name: 'copy',
        //             options: {
        //                 from: '0',
        //                 to: '1.href'
        //             }
        //         }
        //     }
        // }, {
        //     name: 'map',
        //     options: {
        //         property: options.to,
        //         processor: {
        //             name: 'replace',
        //             options: {
        //                 property: '1'
        //             }
        //         }
        //     }
        // }, {
        //     name: 'insert',
        //     options: {
        //         property: '_links.profile',
        //         values: [
        //             {href: `/schema/index/${resourcePath}`},
        //             {href: `/schema/index`},
        //         ]
        //     }
        // }]);
    }
}, {
    /** create an excerpt summary from the first N words or paragraphs of a property.
     * reads options from _excerpt and add the result as the "excerpt" property, then delete _excerpt */
    name: 'excerpt',
    onProcess: (rs, options) => {
        const text = HalUtil.getProperty(rs.resource, options.from);
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

        return HalUtil.setProperty(rs.resource, options.to, excerpt);
    }
}, {
    name: 'resourceGraph',
    onProcess: (rs, options) => {
            // graphlib.alg.preorder(rs.hypermedia.resourceGraph, (node) => {
            // });
            // const cycles = graphlib.alg.findCycles(rs.hypermedia.resourceGraph.graph);
            // rs.logger.warn(`cycles: ${cycles.length}`, {cycles});

            // const list = rs.hypermedia.resourceGraph.graph.nodes();
            // rs.setState('list', list);

            // rs.logger.warn(`${rs.hypermedia.resourceGraph.graph.nodeCount()} nodes, ${rs.hypermedia.resourceGraph.graph.edgeCount()} edges`);
            // rs.logger.warn(`${rs.hypermedia.resourceGraph.graph.children('/index.json')}`);

            // rs.logger.warn('resource graph', rs.hypermedia.resourceGraph.graph);
            // Object.keys(rs.hypermedia.resourceGraph.graph).forEach((key) => {
                // rs.logger.warn(`${key} ${typeof (rs.hypermedia.resourceGraph.graph as any)[key]}`);
            // });

            // don't use graphlib json
            // const graph = JSON.stringify(graphlib.json.write(rs.hypermedia.resourceGraph.graph));
            // const graph = list.map((v) => {
            //     return {
            //         v,
            //         edges: rs.hypermedia.resourceGraph.outEdges(v)
            //     };
            // });
            // rs.setState('graph', graph);

            const nodes = rs.hypermedia.resourceGraph.graph.nodes();
            /*
* /
* /a
* /a/b
* /a/b/c
* /b
* /b/a
* /b/a/c
*
*/
            nodes.sort((a, b) => {
                const normalize = (uri: string): string => {
                    if(uri.endsWith('index.json')) {
                        return uri.substring(0, uri.length - 'index.json'.length);
                    }

                    return uri;
                };
                return normalize(a).localeCompare(normalize(b));
            });
            // nodes.sort((a, b) => {
            //     const aParts = a.split('/');
            //     const bParts = b.split('/');

            //     if(aParts.length < bParts.length) {
            //         return -1;
            //     }
            //     else if(aParts.length > bParts.length) {
            //         return 1;
            //     }

            //     // equal length, use alphabetical
            //     return a.localeCompare(b);
            // });
            rs.setState('nodes', nodes);
            rs.setState('edges', rs.hypermedia.resourceGraph.graph.edges());

            return rs.resource;

        // return HalUtil.setProperty(rs.resource, options.to, excerpt);
    }
}];
    /*
        // implementing this with only processors isn't particularly expressive and has weird scoping issues due to how toOption works
        // should it be easier to work with only processors? (probably)
        // TODO: add forEach object
        return rs.executeProcessor({
            name: 'copyState',
            options: {
                from: [options.property, 'index'],
                to: options.to
            }
        }).then((resource) =>
            if(!filter) {
                const indexMap = HalUtil.getProperty(resource, options.to);
                const results = Object.keys(indexMap).reduce((arr: any[], property) => {
                    return arr.concat(Object.keys(indexMap[property]));
                }, []);

                HalUtil.setProperty(resource, options.to, results);
                return resource;
            }

             Object.keys(HalUtil.getProperty(resource, options.to));
            return Object.keys(HalUtil.getProperty(resource, options.to));

            rs.executeProcessor({
                name: 'forEach',
                options: {
                    property: options.to,
                    toOption: 'values',
                    processor: {
                        name: 'insert',
                        options: {
                            property: options.to
                            // values overwritten by toOption
                        }
                    }
                }
            })
        );
                }, {
                    "name": "forEach",
                    options: {
                        property: options.to,
                        processors: [{
                            name: 'insert',
                            options: {
                                property: options.to,
                                values: 
                            }
                        }]
                    }
                }
                }, {
                    "name": "objectKeys",
                    "options": {
                        "property": options.to
                    }
                }];

        return [{
            "name": "insert",
            "options": {
                "index": 0,
                "property": '_processors',
                "values": [{
                    "name": "copyState",
                    "options": {
                        "processor": "index",
                        "from": [options.property, "index", options.filter],
                        "to":options.to
                    }
                }, {
                    "name": "objectKeys",
                    "options": {
                        "property": options.to
                    }
                }];
            }
        }];
        */

// TODO: rewrite the core processors to all work with dot notation, and allow more customization in which properties and values are read and set

// export const processorFactories: {[name: string]: Processor.Factory} = {
//     self: () => ({
//         name: 'self',
//         fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => (
//             Object.assign(rs, {
//                 resource: Object.assign(rs.resource, {
//                     _links: Object.assign({
//                         // self: {href: rs.state.baseUri? Url.resolve(rs.state.baseUri, rs.relativeUri): rs.relativeUri}
//                         self: {href: rs.relativeUri}
//                     }, rs.resource._links)
//                 })
//             })
//         )
//     }),
//     // TODO: detect rels that use curies that haven't been defined
//     // TODO: record local curie rels so we can generate warnings for rels that have no documentation resource */
//     curies: () => ({
//         name: 'curies', 
//         fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => {
//             const matchedCuries = HalUtil.filterCuries(rs.state.curies, Object.keys(rs.resource._links || {}));
//             return matchedCuries.length === 0?
//                 rs:
//                 { ...rs, resource: {
//                     ...rs.resource, _links: {
//                         curies: matchedCuries,
//                         ...rs.resource._links,
//                     }}};
//         }
//     }),
//     /** extend each resource with the properties of an object. does not overwrite existing properties unless overwrite is true
//      */
//     extend: (options: {obj: {[property: string]: any}, overwrite?: boolean}) => ({
//         name: 'extend',
//         fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => {
//             const resource = {
//                 ...rs.resource,
//             };

//             if(options.overwrite) {
//                 Object.keys(options.obj).forEach((property) => {
//                     HalUtil.setProperty(resource, property, options.obj[property]);
//                 });

//             }
//             else {
//                 Object.keys(options.obj).forEach((property) => {
//                     if(HalUtil.getProperty(resource, property) === undefined) {
//                         HalUtil.setProperty(resource, property, options.obj[property]);
//                     }
//                 });
//             }

//             return {
//                 ...rs,
//                 resource,
//             };
//         }
//     }),
//     /** create an excerpt summary from the first N words or paragraphs of a property.
//      * reads options from _excerpt and add the result as the "excerpt" property, then delete _excerpt */
//     excerpt: () => ({
//         name: 'excerpt',
//         fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => {
//             const _excerpt: ExcerptOptions = Object.assign({
//                 property: 'body',
//                 max: 50,
//                 breakpoint: 'word',
//             }, rs.resource._excerpt);

//             let resource = {
//                 ...rs.resource
//             };

//             delete resource._excerpt;

//             const text = HalUtil.getProperty(rs.resource, _excerpt.property);
//             if(!text || typeof text !== 'string') {
//                 return {
//                     ...rs,
//                     resource
//                 };
//             }

//             // TODO: this regex cuts off traililng punctuation, hyphenated text, etc
//             const wordRegex = /\S+/g;
//             let matches: RegExpExecArray | null;
//             let lastIndex = 0;
//             let matchCount = 0;
//             while((matches = wordRegex.exec(text)) && matchCount < _excerpt.max) {
//                 lastIndex = wordRegex.lastIndex;
//                 matchCount++;
//             }

//             resource.excerpt = text.substring(0, lastIndex);
//             if(lastIndex < text.length) {
//                 resource.excerpt += '...';
//             }

//             return {
//                 ...rs,
//                 resource
//             };
//         }
//     }),
//     /** sorts any fields described by _sort a built-in or custom comparison function if it is an array
//      * _sort can be an array of sortoptions object to specify multiple sorts
//      * */
//     sort: (options?: Sort.FactoryOptions) => {
//         const compareFns: {[name: string]: (a: any, b: any) => number} = {
//             'number': (a: number, b: number) => a - b,
//             'date': (a: string, b: string) => new Date(a).valueOf() - new Date(b).valueOf(),
//             'default': (a: string, b: string) => a < b? -1: a > b? 1: 0, // string
//             ...(options && options.compareFns)
//         };

//         return {
//             name: 'sort',
//             fn: (rs) => {
//                 if(!rs.resource._sort) {
//                     return rs;
//                 }

//                 const unsortedOptions = (Array.isArray(rs.resource._sort)?
//                     rs.resource._sort:
//                     [rs.resource._sort]
//                 ).filter((_sort) => {
//                     const sortOptions: Sort.Options = {
//                         ascending: true,
//                         ..._sort
//                     }

//                     if(!sortOptions.key) {
//                         return true;
//                     }

//                     const baseCompareFn = compareFns[sortOptions.key] || compareFns['default'];
//                     const compareFn = sortOptions.ascending?
//                         baseCompareFn:
//                         (a: any, b: any) => baseCompareFn(b, a);

//                     const array = HalUtil.getProperty(rs.resource, sortOptions.property);
//                     if(!array || !Array.isArray(array)) {
//                         return true;
//                     }

//                     // TODO: non-immutible assignment. do we even care about that?
//                     array.sort((a, b) => compareFn(
//                         HalUtil.getProperty(a, sortOptions.key),
//                         HalUtil.getProperty(b, sortOptions.key)
//                     ));

//                     return false;
//                 });

//                 if(unsortedOptions.length === 0) {
//                     delete rs.resource._sort;
//                 }
//                 else {
//                     rs.resource._sort = unsortedOptions;
//                 }
//                 return rs;
//             }
//         };
//     },
//     /*
//     breadcrumb: () => ({
//         name: 'breadcrumb',
//         fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => {
//             const uriParts = rs.relativeUri.split('/').slice(0, -1);
//             rs.resource._links = Object.assign({
//                 'fs:breadcrumb': (uriParts.length === 0)? undefined:
//                 uriParts.map((uriPart, i) => {
//                     const href = '/' + uriParts.slice(1, i+1).join('/');
//                     return {
//                         href,
//                         title: rs.calculateFrom(href, ({resource}) => { return resource && resource.title;}),
//                     };
//                 })
//             }, rs.resource._links);
//             return rs;
//         }
//     }),
//      */

//     /**
//      * add resources to the "_embedded" property for each rel in the "_embed" property. Then remove "_embed"
//      * Also removes "_links" entries for embedded resources
//      * TODO: detect curies in "embed" and add them? include "_embedded" curies by default? lift "_embedded" curies to root?
//      * TODO: resolve hrefs correctly even if they aren't the full uri (e.g. /posts doesn't work but /posts/index.json does)
//      * TODO: put "title" in embedded "_links" into the "self" link in the embedded cocument? it's annoying that the title no longer works correctly when linking to embedded document
//      */
//     embed,
//     makeIndex,
//     tags,

//     /* higher-order processor that only runs the provided processor if the resource matches the designated profile */
//     matchProfile: (options: {profile: Hal.Uri, processorFactory: string, options?: any}): Processor => {
//         let processor: Processor;
//         return {
//             name: `matchProfile-${options.profile}-${options.processorFactory}`,
//             fn: (rs) => {
//                 if(!processor) {
//                     processor = rs.hypermedia.makeProcessor(options.processorFactory, options.options);
//                 }

//                 return HalUtil.resourceMatchesProfile(rs.resource, options.profile, rs.state.baseUri)?
//                     processor.fn(rs):
//                     rs;
//             }
//         };
//     },
//     /**
//      * higher-order processor that runs the provided processor once for every element in an array on the resource.
//      * replaces rs.resource with the object from the selected property in the subprocessor
//      * useful for applying a processor to each element in an index
//      * TODO: consider if this could break with more complicated features
//      * @param property - property of an array to loop over, using dot notation
//      * @param key - a unique key that can be used to match up execAsync results with the elements that produced them. uses dot notation, relative to property
//      * */
//     forEach: (factoryOptions: {property: string, key: string, processorFactory: string, options?: any}): Processor => {
//         // TODO: standardize parameter checking
//         /*
//         if(!options) {
//             throw new Error('forEach factory: options required');
//         }
//         if(!options.property) {
//             throw new Error('forEach factory: options.property required');
//         }

//         if(!options.key) {
//             throw new Error('forEach factory: options.key required');
//         }

//         if(!options.processorFactory) {
//             throw new Error('forEach factory: options.processorFactory required');
//         }
//         */

//         let processor: Processor;
//         return {
//             name: `forEach-${(factoryOptions && factoryOptions.processorFactory)? '-' + factoryOptions.processorFactory: ''}`,
//             fn: (rs) => {
//                 const options = {
//                     ...factoryOptions,
//                     ...rs.resource._forEach
//                 };

//                 if(!options.processorFactory || !options.property || !options.key) {
//                     return rs;
//                 }

//                 if(rs.execAsyncResult && rs.execAsyncResult.status === 'pending') {
//                     return rs;
//                 }

//                 if(!processor) {
//                     processor = rs.hypermedia.makeProcessor(options.processorFactory, options.options);
//                 }

//                 const array = HalUtil.getProperty(rs.resource, options.property);
//                 if(!array || !Array.isArray(array)) {
//                     return rs;
//                 }

//                 const asyncCallbacks: {[key: string]: {
//                     index: number;
//                     fn: () => Promise<any>;
//                 }} = {
//                 };

//                 const newArray = array.map((value, index) => {
//                     if(!value || typeof value !== 'object') {
//                         return value;
//                     }

//                     let keyValue = HalUtil.getProperty(value, options.key);
//                     if(!keyValue) {
//                         throw new Error(`Missing key '${options.key}' on ${options.property}.${index}`);
//                     }

//                     if(typeof keyValue !== 'number') {
//                         keyValue = keyValue.toString();
//                     }

//                     if(typeof keyValue !== 'string') {
//                         throw new Error(`Invalid key type '${typeof keyValue}' on ${options.property}.${index}.${options.key}: Must be type 'string' or 'number'`);
//                     }

//                     if(asyncCallbacks[keyValue]) {
//                         throw new Error(`Duplicate key ${keyValue} on ${options.property}.${asyncCallbacks[keyValue]}.${options.key} and ${options.property}.${index}.${options.key}`);
//                     }

//                     return processor.fn({
//                         ...rs,
//                         resource: value,
//                         execAsync: (fn) => {
//                             asyncCallbacks[keyValue] = {
//                                 index,
//                                 fn,
//                             };
//                             return undefined;
//                         },
//                         execAsyncResult: rs.execAsyncResult && rs.execAsyncResult.result[keyValue],
//                     }).resource;

//                 });

//                 if(Object.keys(asyncCallbacks).length > 0) {
//                     rs.execAsync(() => {
//                         return Promise.all(Object.keys(asyncCallbacks).map((key) => {
//                             let promiseStatus = 'pending';
//                             return asyncCallbacks[key].fn().catch((error) => {
//                                 promiseStatus = 'rejected';
//                                 return error;
//                             }).then((result) => {
//                                 promiseStatus = 'resolved';
//                                 return {
//                                     key,
//                                     result: {
//                                         status: promiseStatus,
//                                         result,
//                                     }
//                                 };
//                             });
//                         })).then((results) => {
//                             return results.reduce((obj, result) => {
//                                 obj[result.key] = result.result;
//                                 return obj;
//                             }, {} as any);
//                         });
//                     });
//                 }

//                 const resource = {
//                     ...rs.resource,
//                 };


//                 HalUtil.setProperty(resource, options.property, newArray);
//                 delete rs.resource._forEach;
//                 return {
//                     ...rs,
//                     resource,
//                 };
//             }
//         };
//     },
//     /** allows a resource to define additional processors to be executed when it is processed.
//      * WARNING: this is a very powerful, but dangerous processor, which allows resources to trigger unbounded processor code execution.
//      */
//     processors: (options?: ProcessorsFactoryOptions) => {
//         return {
//             name: 'processors',
//             fn: (rs) => {
//                 return rs;
//             }
//         };
//     },
// };

// export interface ProcessorsFactoryOptions {
//     processors: {[name: string]: Processor};
//     allowProcessorCreation: boolean;
// }

// export interface ExcerptOptions {
//     /** property containing the text to summarize */
//     property: string;
//     /** max allowed number of words */
//     max: number;
//     /** determines where the excerpt is allowed to end if the text is longer than max.
//      * found by finding the most recent breakPoint before max is reached. */
//     breakpoint: 'character' | 'word' | 'paragraph';
//     /** min allowed number of words when backtracking */
//     // min: number;
// }


// export namespace Sort {
//     export type CompareFn = (a: any, b: any) => number;
//     export interface Options {
//         /** property containing the array to sort */
//         property: string;
//         /** each element of the array will be ordered by this key */
//         key: string;
//         compare?: string;
//         ascending?: boolean;
//     }

//     export interface FactoryOptions {
//         compareFns?: {[compareFnName: string]: CompareFn};
//     }
// }
