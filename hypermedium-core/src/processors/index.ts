import { Processor, HypermediaEngine, Hal, HalUtil } from 'hypermedium';

import { embed } from './embed';
import { makeIndex } from './make-index';
import { tags } from './tags';

// TODO: rewrite the core processors to all work with dot notation, and allow more customization in which properties and values are read and set

export const processorFactories: {[name: string]: Processor.Factory} = {
    self: () => ({
        name: 'self',
        fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => (
            Object.assign(rs, {
                resource: Object.assign(rs.resource, {
                    _links: Object.assign({
                        // self: {href: rs.state.baseUri? Url.resolve(rs.state.baseUri, rs.relativeUri): rs.relativeUri}
                        self: {href: rs.relativeUri}
                    }, rs.resource._links)
                })
            })
        )
    }),
    // TODO: detect rels that use curies that haven't been defined
    // TODO: record local curie rels so we can generate warnings for rels that have no documentation resource */
    curies: () => ({
        name: 'curies', 
        fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => {
            const matchedCuries = HalUtil.filterCuries(rs.state.curies, Object.keys(rs.resource._links || {}));
            return matchedCuries.length === 0?
                rs:
                { ...rs, resource: {
                    ...rs.resource, _links: {
                        curies: matchedCuries,
                        ...rs.resource._links,
                    }}};
        }
    }),
    /** extend each resource with the properties of an object. does not overwrite existing properties unless overwrite is true
     */
    extend: (options: {obj: {[property: string]: any}, overwrite?: boolean}) => ({
        name: 'extend',
        fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => {
            const resource = {
                ...rs.resource,
            };

            if(options.overwrite) {
                Object.keys(options.obj).forEach((property) => {
                    HalUtil.setProperty(resource, property, options.obj[property]);
                });

            }
            else {
                Object.keys(options.obj).forEach((property) => {
                    if(HalUtil.getProperty(resource, property) === undefined) {
                        HalUtil.setProperty(resource, property, options.obj[property]);
                    }
                });
            }

            return {
                ...rs,
                resource,
            };
        }
    }),
    /** create an excerpt summary from the first N words or paragraphs of a property.
     * reads options from _excerpt and add the result as the "excerpt" property, then delete _excerpt */
    excerpt: () => ({
        name: 'excerpt',
        fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => {
            const _excerpt: ExcerptOptions = Object.assign({
                property: 'body',
                max: 50,
                breakpoint: 'word',
            }, rs.resource._excerpt);

            let resource = {
                ...rs.resource
            };

            delete resource._excerpt;

            const text = HalUtil.getProperty(rs.resource, _excerpt.property);
            if(!text || typeof text !== 'string') {
                return {
                    ...rs,
                    resource
                };
            }

            // TODO: this regex cuts off traililng punctuation, hyphenated text, etc
            const wordRegex = /\S+/g;
            let matches: RegExpExecArray | null;
            let lastIndex = 0;
            let matchCount = 0;
            while((matches = wordRegex.exec(text)) && matchCount < _excerpt.max) {
                lastIndex = wordRegex.lastIndex;
                matchCount++;
            }

            resource.excerpt = text.substring(0, lastIndex);
            if(lastIndex < text.length) {
                resource.excerpt += '...';
            }

            return {
                ...rs,
                resource
            };
        }
    }),
    /** sorts any fields described by _sort a built-in or custom comparison function if it is an array
     * _sort can be an array of sortoptions object to specify multiple sorts
     * */
    sort: (options?: Sort.FactoryOptions) => {
        const compareFns: {[name: string]: (a: any, b: any) => number} = {
            'number': (a: number, b: number) => a - b,
            'date': (a: string, b: string) => new Date(a).valueOf() - new Date(b).valueOf(),
            'default': (a: string, b: string) => a < b? -1: a > b? 1: 0, // string
            ...(options && options.compareFns)
        };

        return {
            name: 'sort',
            fn: (rs) => {
                if(!rs.resource._sort) {
                    return rs;
                }

                const unsortedOptions = (Array.isArray(rs.resource._sort)?
                    rs.resource._sort:
                    [rs.resource._sort]
                ).filter((_sort) => {
                    const sortOptions: Sort.Options = {
                        ascending: true,
                        ..._sort
                    }

                    if(!sortOptions.key) {
                        return true;
                    }

                    const baseCompareFn = compareFns[sortOptions.key] || compareFns['default'];
                    const compareFn = sortOptions.ascending?
                        baseCompareFn:
                        (a: any, b: any) => baseCompareFn(b, a);

                    const array = HalUtil.getProperty(rs.resource, sortOptions.property);
                    if(!array || !Array.isArray(array)) {
                        return true;
                    }

                    // TODO: non-immutible assignment. do we even care about that?
                    array.sort((a, b) => compareFn(
                        HalUtil.getProperty(a, sortOptions.key),
                        HalUtil.getProperty(b, sortOptions.key)
                    ));

                    return false;
                });

                if(unsortedOptions.length === 0) {
                    delete rs.resource._sort;
                }
                else {
                    rs.resource._sort = unsortedOptions;
                }
                return rs;
            }
        };
    },
    /*
    breadcrumb: () => ({
        name: 'breadcrumb',
        fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => {
            const uriParts = rs.relativeUri.split('/').slice(0, -1);
            rs.resource._links = Object.assign({
                'fs:breadcrumb': (uriParts.length === 0)? undefined:
                uriParts.map((uriPart, i) => {
                    const href = '/' + uriParts.slice(1, i+1).join('/');
                    return {
                        href,
                        title: rs.calculateFrom(href, ({resource}) => { return resource && resource.title;}),
                    };
                })
            }, rs.resource._links);
            return rs;
        }
    }),
     */

    /**
     * add resources to the "_embedded" property for each rel in the "_embed" property. Then remove "_embed"
     * Also removes "_links" entries for embedded resources
     * TODO: detect curies in "embed" and add them? include "_embedded" curies by default? lift "_embedded" curies to root?
     * TODO: resolve hrefs correctly even if they aren't the full uri (e.g. /posts doesn't work but /posts/index.json does)
     * TODO: put "title" in embedded "_links" into the "self" link in the embedded cocument? it's annoying that the title no longer works correctly when linking to embedded document
     */
    embed,
    makeIndex,
    tags,

    /* higher-order processor that only runs the provided processor if the resource matches the designated profile */
    matchProfile: (options: {profile: Hal.Uri, processorFactory: string, options?: any}): Processor => {
        let processor: Processor;
        return {
            name: `matchProfile-${options.profile}-${options.processorFactory}`,
            fn: (rs) => {
                if(!processor) {
                    processor = rs.hypermedia.makeProcessor(options.processorFactory, options.options);
                }

                return HalUtil.resourceMatchesProfile(rs.resource, options.profile, rs.state.baseUri)?
                    processor.fn(rs):
                    rs;
            }
        };
    },
    /**
     * higher-order processor that runs the provided processor once for every element in an array on the resource.
     * replaces rs.resource with the object from the selected property in the subprocessor
     * useful for applying a processor to each element in an index
     * TODO: consider if this could break with more complicated features
     * @param property - property of an array to loop over, using dot notation
     * @param key - a unique key that can be used to match up execAsync results with the elements that produced them. uses dot notation, relative to property
     * */
    forEach: (factoryOptions: {property: string, key: string, processorFactory: string, options?: any}): Processor => {
        // TODO: standardize parameter checking
        /*
        if(!options) {
            throw new Error('forEach factory: options required');
        }
        if(!options.property) {
            throw new Error('forEach factory: options.property required');
        }

        if(!options.key) {
            throw new Error('forEach factory: options.key required');
        }

        if(!options.processorFactory) {
            throw new Error('forEach factory: options.processorFactory required');
        }
        */

        let processor: Processor;
        return {
            name: `forEach-${(factoryOptions && factoryOptions.processorFactory)? '-' + factoryOptions.processorFactory: ''}`,
            fn: (rs) => {
                const options = {
                    ...factoryOptions,
                    ...rs.resource._forEach
                };

                if(!options.processorFactory || !options.property || !options.key) {
                    return rs;
                }

                if(rs.execAsyncResult && rs.execAsyncResult.status === 'pending') {
                    return rs;
                }

                if(!processor) {
                    processor = rs.hypermedia.makeProcessor(options.processorFactory, options.options);
                }

                const array = HalUtil.getProperty(rs.resource, options.property);
                if(!array || !Array.isArray(array)) {
                    return rs;
                }

                const asyncCallbacks: {[key: string]: {
                    index: number;
                    fn: () => Promise<any>;
                }} = {
                };

                const newArray = array.map((value, index) => {
                    if(!value || typeof value !== 'object') {
                        return value;
                    }

                    let keyValue = HalUtil.getProperty(value, options.key);
                    if(!keyValue) {
                        throw new Error(`Missing key '${options.key}' on ${options.property}.${index}`);
                    }

                    if(typeof keyValue !== 'number') {
                        keyValue = keyValue.toString();
                    }

                    if(typeof keyValue !== 'string') {
                        throw new Error(`Invalid key type '${typeof keyValue}' on ${options.property}.${index}.${options.key}: Must be type 'string' or 'number'`);
                    }

                    if(asyncCallbacks[keyValue]) {
                        throw new Error(`Duplicate key ${keyValue} on ${options.property}.${asyncCallbacks[keyValue]}.${options.key} and ${options.property}.${index}.${options.key}`);
                    }

                    return processor.fn({
                        ...rs,
                        resource: value,
                        execAsync: (fn) => {
                            asyncCallbacks[keyValue] = {
                                index,
                                fn,
                            };
                            return undefined;
                        },
                        execAsyncResult: rs.execAsyncResult && rs.execAsyncResult.result[keyValue],
                    }).resource;

                });

                if(Object.keys(asyncCallbacks).length > 0) {
                    rs.execAsync(() => {
                        return Promise.all(Object.keys(asyncCallbacks).map((key) => {
                            let promiseStatus = 'pending';
                            return asyncCallbacks[key].fn().catch((error) => {
                                promiseStatus = 'rejected';
                                return error;
                            }).then((result) => {
                                promiseStatus = 'resolved';
                                return {
                                    key,
                                    result: {
                                        status: promiseStatus,
                                        result,
                                    }
                                };
                            });
                        })).then((results) => {
                            return results.reduce((obj, result) => {
                                obj[result.key] = result.result;
                                return obj;
                            }, {} as any);
                        });
                    });
                }

                const resource = {
                    ...rs.resource,
                };


                HalUtil.setProperty(resource, options.property, newArray);
                delete rs.resource._forEach;
                return {
                    ...rs,
                    resource,
                };
            }
        };
    },
    /** allows a resource to define additional processors to be executed when it is processed.
     * WARNING: this is a very powerful, but dangerous processor, which allows resources to trigger unbounded processor code execution.
     */
    processors: (options?: ProcessorsFactoryOptions) => {
        return {
            name: 'processors',
            fn: (rs) => {
                return rs;
            }
        };
    },
};

export interface ProcessorsFactoryOptions {
    processors: {[name: string]: Processor};
    allowProcessorCreation: boolean;
}

export interface ExcerptOptions {
    /** property containing the text to summarize */
    property: string;
    /** max allowed number of words */
    max: number;
    /** determines where the excerpt is allowed to end if the text is longer than max.
     * found by finding the most recent breakPoint before max is reached. */
    breakpoint: 'character' | 'word' | 'paragraph';
    /** min allowed number of words when backtracking */
    // min: number;
}


export namespace Sort {
    export type CompareFn = (a: any, b: any) => number;
    export interface Options {
        /** property containing the array to sort */
        property: string;
        /** each element of the array will be ordered by this key */
        key: string;
        compare?: string;
        ascending?: boolean;
    }

    export interface FactoryOptions {
        compareFns?: {[compareFnName: string]: CompareFn};
    }
}
