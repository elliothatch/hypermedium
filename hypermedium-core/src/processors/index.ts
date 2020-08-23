import { Processor, ProcessorFactory, HypermediaEngine, Hal, HalUtil } from 'hypermedium';

import { embed } from './embed';
import { makeIndex } from './make-index';
import { tags } from './tags';

export const processorFactories: {[name: string]: ProcessorFactory} = {
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
    embed: () => ({
        name: 'embed',
        fn: embed,
    }),
    makeIndex,
    tags: () => tags,

    /* higher-order processor that only runs the provided processor if the resource matches the designated profile */
    matchProfile: (options: {profile: Hal.Uri, processor: Processor}): Processor => {
        return {
            name: `matchProfile-${options.profile}`,
            fn: (rs) => HalUtil.resourceMatchesProfile(rs.resource, options.profile, rs.state.baseUri)?
            options.processor.fn(rs):
            rs
        };
    },
};


