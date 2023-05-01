import { DynamicResource, Hal, HalUtil } from 'hypermedium';

type PropertyPath = HalUtil.PropertyPath;

function createIndexResource(propertyName: string, index: Map<string, Set<Hal.Uri>>): Hal.ExtendedResource {
    const indexObj = Array.from(index.entries()).reduce((obj, [key, uris]) => {
        obj[key] = Array.from(uris);
        return obj;
    }, {} as Record<string, Hal.Uri[]>);

    return {
        "@type": [
            "/schema/index",
            `/schema/index/${propertyName}`,
        ],
        "@context": {
            "@version": 1.1,
            "index": {
                "@container": "@index",
            }
        },
        "index": indexObj
    }
}
/** given a property, creates an index for each value found in a resource, linking the value to the resource uri.
* the index can be easily accessed with the proecssor 'ld:getIndex' 
* all values are serialized to a string before indexing
* */
export const Index: DynamicResource.Definition<'index', {
    property: PropertyPath;
}, {
        /** maps each indexed value to the set of resources that contain that value */
        index: Map<string, Set<Hal.Uri>>;
        /** reverse index is required to detect when indexed values are removed from a resource or when a resource is deleted, without needing to check every index */
        reverseIndex: Map<Hal.Uri, Set<string>>;
    }> = {
        name: 'index',
        init: (api, options) => {
            api.state = {
                index: new Map(),
                reverseIndex: new Map()
            };
        },
        resourceEvents: {
            onProcess: (uri, resource, api, options) => {
                const oldMatches = api.state.reverseIndex.get(uri) || new Set();
                const matches = new Set(HalUtil.matchProperty(resource, options.property).map((match) => {
                    if(typeof match === 'object') {
                        return JSON.stringify(match)
                    }
                    else {
                        return '' + match;
                    }
                }));
                const newMatches = new Set([...matches].filter((x) => !oldMatches.has(x)));
                const removedMatches = new Set([...oldMatches].filter((x) => !matches.has(x)));

                if(newMatches.size === 0 && removedMatches.size === 0) {
                    return;
                }

                removedMatches.forEach((key) => {
                    let uris = api.state.index.get(key)!;
                    uris.delete(uri);
                    if(uris.size === 0) {
                        api.state.index.delete(key);
                    }

                    oldMatches.delete(key);
                    if(oldMatches.size === 0) {
                        api.state.reverseIndex.delete(uri);
                    }
                });

                newMatches.forEach((key) => {
                    let uris = api.state.index.get(key);
                    if(!uris) {
                        uris = new Set();
                        api.state.index.set(key, uris);
                    }

                    uris.add(uri);

                    let values = api.state.reverseIndex.get(uri);
                    if(!values) {
                        values = new Set();
                        api.state.reverseIndex.set(uri, values);
                    }

                    values.add(key);
                });

                // update the dynamic resource
                const propertyName = Array.isArray(options.property)?
                options.property.join('.'):
                options.property;

                return api.createResource(`/${propertyName}`, createIndexResource(propertyName, api.state.index));
            },
            onDelete: (uri, resource, api, options) => {
                const matches = api.state.reverseIndex.get(uri);
                if(!matches) {
                    return;
                }

                matches.forEach((match) => {
                    let uris = api.state.index.get(match)!;
                    uris.delete(uri);
                    if(uris.size === 0) {
                        api.state.index.delete(match);
                    }
                });

                api.state.reverseIndex.delete(uri);
                const propertyName = Array.isArray(options.property)?
                    options.property.join('.'):
                    options.property;
                return api.createResource(`/${propertyName}`, createIndexResource(propertyName, api.state.index));
            }
        }

    };

export const dynamicResourceDefinitions: DynamicResource.Definition[] = [
    Index
];
