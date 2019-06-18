import { Edge, json as graphJson } from 'graphlib';
import * as HAL from '../../hal';
import { filterCuries, getProfiles, resourceMatchesProfile } from '../../hal-util';
import { createSchema, objectDifference } from '../../util';
import { Hypermedia, Embed } from '../';

import * as makeIndex from './make-index';
import * as tags from './tags';
export { makeIndex, tags };

type ResourceState = Hypermedia.ResourceState;
type ExtendedResource = Hypermedia.ExtendedResource;
type CalculateFromResourceParams = Hypermedia.CalculateFromResourceParams;

export interface Processor {
    name: string;
    fn: ProcessorFn;
}

/** takes in a HAL object and some external state, and returns transformed versions
 * of each. */
export type ProcessorFn = (rs: ResourceState) => ResourceState;

export namespace Processor {
    export const self = {
        name: 'self',
       fn: (rs: ResourceState): ResourceState => (
            Object.assign(rs, {
                resource: Object.assign(rs.resource, {
                    _links: Object.assign({
                        // self: {href: rs.state.baseUri? Url.resolve(rs.state.baseUri, rs.relativeUri): rs.relativeUri}
                        self: {href: rs.relativeUri}
                    }, rs.resource._links)
                })
            })
        )
    };

    /** try to auto-generate missing schema
     *
     * If a schema is missing and can be generated, the schema resource is initialized with a blueprint it will use to generate the full schema when it is processed
     *
     * schema generation steps:
     *  1. if the resource only has one profile: create schema describing all fields and links in the resource, excluding self and profile links. 
         u  2. if the resource has multiple profiles: if all profiles are already defined except one, create a schema describing fields and links that are not defined in the other profile schemas (set difference).
     *  3. if the resource has multiple undefined profiles: emit a warning and do not generate any schemas.
     * */
    export const schema: Processor = {
        name: 'schema',
        fn: (rs) => {
            const ignoredSchemas = ['/schema/freshr/resource-graph'];
            const schemaProfile = '/schema';
            if(rs.relativeUri.startsWith(schemaProfile)) {
                // generate the schema if it was initialized with a schema-source
                const schemaSourceLink = rs.resource._links && rs.resource._links['fs:schema-source'] as HAL.Link | undefined;
                if(schemaSourceLink) {
                    const schemaSource = rs.calculateFrom(schemaSourceLink.href, ({resource}) => resource);
                    const otherSchemaHrefs = getProfiles(schemaSource)
                        .map((profile) => profile.href)
                        .filter((href) => rs.hypermedia.normalizeUri(href) !== rs.relativeUri);

                    const otherSchemas = rs.calculateFrom(otherSchemaHrefs, (r) => r.filter(({resource}) => resource));
                    const prunedObject = otherSchemas.reduce((obj: ExtendedResource, schema: CalculateFromResourceParams) => {
                        return objectDifference(obj, schema.resource!.schema);
                    }, schemaSource);

                    const schema = createSchema(prunedObject);
                    return {
                        ...rs,
                        resource: {
                            ...rs.resource,
                            schema,
                        }
                    };
                }
            }
            else {
                // initialize a schema if there isn't already one and we can generate it, or emit a warning if the resource does not conform to the schema
                // TODO: add option to disable schema validation
                const profileHrefs = getProfiles(rs.resource).map((p) => p.href);
                const missingProfiles = profileHrefs;
                // const missingProfiles = rs.calculateFrom(profileHrefs, (r) => r.filter(({resource}) => !resource).map(({href}) => href));
                if(missingProfiles.length === 0) {
                    // TODO: validate the schema
                }
                else if(missingProfiles.length === 1) {
                    // only one missing schema, initialize so it will be auto-generated
                    if(!ignoredSchemas.includes(missingProfiles[0])) {
                        rs.markDirty(missingProfiles[0], {
                            "_links": {
                                "profile": {
                                    "href": schemaProfile
                                },
                                "fs:schema-source": {
                                    "href": rs.relativeUri
                                }
                            }
                        });
                    }
                }
                else {
                    // TODO: add logging capabilities to processors
                    console.log(JSON.stringify({
                        level: 'warn',
                        message: `processor.schema: ${rs.relativeUri} has ${missingProfiles.length} unspecified profiles: ${missingProfiles.join(', ')}`
                    }));
                }

            }
            return rs;
        }
    };

    /** updates the resource graph resource */
    export const resourceGraph: Processor = {
        name: 'resourceGraph',
        fn: (rs) => {
            const resourceGraphProfile = '/schema/freshr/resource-graph';
            const resourceGraphUri = '/freshr/resource-graph';
            if(resourceMatchesProfile(rs.resource, resourceGraphProfile)) {
                const graph = graphJson.write(rs.state.resourceGraph) as any;
                // create a copy of the resource-graph node without the "resource" property, to prevent circular reference
                graph.nodes = graph.nodes.map((node: any) => {
                    if(node.v !== `${resourceGraphUri}.json`) { // TODO: uri normalization
                        return node;
                    }

                    const newNodeValue = Object.assign({}, node.value);
                    delete newNodeValue.resource;

                    return {
                        ...node,
                        value: newNodeValue
                    };
                });
                return {
                    ...rs,
                    resource: {
                        ...rs.resource,
                        graph
                    }
                };
            }

            rs.markDirty(resourceGraphUri, {
                "_links": {
                    "profile": {
                        "href": resourceGraphProfile
                    }
                }
            });
            return rs;
        }
    };

    // TODO: detect rels that use curies that haven't been defined
    // TODO: record local curie rels so we can generate warnings for rels that have no documentation resource */
    export const curies = {
        name: 'curies', 
        fn: (rs: ResourceState): ResourceState => {
            const matchedCuries = filterCuries(rs.state.curies, Object.keys(rs.resource._links || {}));
            return matchedCuries.length === 0?
                rs:
                { ...rs, resource: {
                    ...rs.resource, _links: {
                        curies: matchedCuries,
                        ...rs.resource._links,
                    }}};
            }
    };

    export const breadcrumb = {
        name: 'breadcrumb',
        fn: (rs: ResourceState): ResourceState => {
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
    };

    /**
     * add resources to the "_embedded" property for each rel in the "_embed" property. Then remove "_embed"
     * Also removes "_links" entries for embedded resources
     * TODO: detect curies in "embed" and add them? include "_embedded" curies by default? lift "_embedded" curies to root?
     * TODO: resolve hrefs correctly even if they aren't the full uri (e.g. /posts doesn't work but /posts/index.json does)
     * TODO: put "title" in embedded "_links" into the "self" link in the embedded cocument? it's annoying that the title no longer works correctly when linking to embedded document
     */
    export const embed = {
        name: 'embed',
        fn: (rs: ResourceState): ResourceState => {
            const _embed: Embed = rs.resource._embed;
            if(!_embed) {
                return rs;
            }

            let resource = Object.assign({}, rs.resource);

            const embedded = Object.keys(_embed).reduce((embedded, embedRel) => {
                const embedEntry = _embed[embedRel];

                // collect hrefs to embed
                const embedHrefs = embedEntry.href && (Array.isArray(embedEntry.href)? embedEntry.href: [embedEntry.href]) || [];

                const links = rs.resource._links && rs.resource._links[embedRel];
                const linkHrefs = links && (Array.isArray(links)? links: [links]).map((link) => link.href) || [];

                let hrefs = embedHrefs.concat(linkHrefs);
                let linkHrefsUsed = linkHrefs.length;
                if(embedEntry.max) {
                    // embed hrefs are always used first, and linkHrefs are used in order, so we can easily calculate how many link hrefs were used (and should be deleted)
                    linkHrefsUsed = Math.max(0, linkHrefs.length - Math.max(0, hrefs.length - embedEntry.max));
                    hrefs = hrefs.slice(0, embedEntry.max);
                }

                embedded[embedRel] = rs.calculateFrom(hrefs, (resourceParams) => {
                    return resourceParams.map(({resource: r, href}) => {
                        // TODO: do something reasonable if the document to embed does not exist
                        if(!r) {
                            return r;
                        }

                        // TODO: implement depth
                        if(embedEntry.properties) {
                            return Object.assign(
                                // always include the "self" link
                                {_links: {self: r._links && r._links.self || href}},
                                embedEntry.properties.reduce((obj, property) => {
                                    if(property in r) {
                                        obj[property] = r[property];
                                    }
                                    return obj;
                                }, {} as ExtendedResource));
                        }
                        return r;
                    });
                }).filter((r?: HAL.Resource) => !!r);

                // special case: if we got the href from a non-array "_link" entry, and there were no additional hrefs in "_embed", don't make the embedded resource an array.
                // this simplifies template code when you were only expecting a single link
                if(linkHrefs.length === 1 && embedded[embedRel].length === 1) {
                    embedded[embedRel] = embedded[embedRel][0];
                }

                // delete links that were embedded
                // TODO: don't delete links to resources that couldnt' be loaded?
                if(linkHrefsUsed > 0) {
                    if(!Array.isArray(links) || linkHrefsUsed === links.length) {
                        delete resource._links![embedRel];
                    }
                    else {
                        resource._links![embedRel] = links.slice(linkHrefsUsed);
                    }
                }

                return embedded;
            }, {} as any);

            delete resource._embed;

            return Object.assign(rs, {
                resource: Object.assign(resource, {_embedded: embedded})
            });
        }
    };
}

/* higher-order processor that only runs the provided processor if the resource matches the designated profile */
export const matchProfile = (profile: HAL.Uri, processor: Processor): Processor => {
    return {
        name: 'matchProfile',
        fn: (rs) => resourceMatchesProfile(rs.resource, profile, rs.state.baseUri)?
            processor.fn(rs):
            rs
    };
};
