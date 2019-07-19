import { HAL, filterCuries, getProfiles, resourceMatchesProfile, createSchema, objectDifference, Hypermedia, Embed, Processor } from 'freshr';

type ResourceState = Hypermedia.ResourceState;
type ExtendedResource = Hypermedia.ExtendedResource;
type CalculateFromResourceParams = Hypermedia.CalculateFromResourceParams;

export const tags: Processor = {
    name: 'tags',
    fn: (rs: ResourceState): ResourceState => {
        const tagIndexProfile = '/schema/index/tags';
        const tagIndex = getProfiles(rs.resource)
            .reduce((tIndex, profile) => {
                if(tIndex) {
                    return tIndex;
                }

                if(profile.href.startsWith(tagIndexProfile) && profile.href.length > tagIndexProfile.length) {
                    return '/tags' + profile.href.substring(tagIndexProfile.length);
                }

                return undefined;
            }, undefined as string | undefined);

        if(tagIndex) {
            return { ...rs, 
                resource: {
                    ...rs.resource, _links: {
                        'fs:entries': (rs.state.tags[tagIndex] || []).map((href: HAL.Uri) => ({
                            href,
                            title: rs.calculateFrom(href, ({resource}) => { return resource && resource.title;}),
                        })),
                        ...rs.resource._links,
                    }}};
        }
        const tags = getTags(rs.resource);
        tags.forEach((t) => {
            if(!rs.state.tags[t.href]) {
                rs.state.tags[t.href] = [];
            }
            rs.state.tags[t.href].push(rs.relativeUri);
        });

        tags.map((t) => {
            rs.markDirty(t.href, {
                "title": t.href.substring('/tags/'.length),
                "_links": {
                    "profile": [{
                        "href": `/schema/index${t.href}`
                    }, {
                        "href": `/schema/index/tags`
                    }]
                }
            });
        });
        return rs;
    }
};

/** get all "tag" links, or empty array */
function getTags(resource: HAL.Resource): HAL.Link[] {
    let tags = resource._links && resource._links.tag;
    if(!tags) {
        return [];
    }

    if(!Array.isArray(tags)) {
        tags = [tags];
    }
    return tags;
}
