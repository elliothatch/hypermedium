// import { HypermediaEngine, Hal, HalUtil, Processor } from 'hypermedium';

// export const tags: Processor.Factory = () => ({
//     name: 'tags',
//     fn: (rs: HypermediaEngine.ResourceState): HypermediaEngine.ResourceState => {
//         const tagIndexProfile = '/schema/index/tags';
//         const tagIndex = HalUtil.getProfiles(rs.resource)
//             .reduce((tIndex, profile) => {
//                 if(tIndex) {
//                     return tIndex;
//                 }

//                 if(profile.href.startsWith(tagIndexProfile) && profile.href.length > tagIndexProfile.length) {
//                     return '/tags' + profile.href.substring(tagIndexProfile.length);
//                 }

//                 return undefined;
//             }, undefined as string | undefined);

//         if(tagIndex) {
//             const tagUriSet = rs.state.tags.get(tagIndex);
//             const tagLinks = (tagUriSet? Array.from(tagUriSet): []).map((href: Hal.Uri) => ({
//                 href,
//                 title: rs.calculateFrom(href, ({resource}) => { return resource && resource.title;}),
//             }));

//             return {
//                 ...rs, 
//                 resource: {
//                     ...rs.resource,
//                     _links: {
//                         'fs:entries': tagLinks,
//                         ...rs.resource._links,
//                     }
//                 }
//             };
//         }

//         const tags = getTags(rs.resource);
//         tags.forEach((t) => {
//             let tagUris = rs.state.tags.get(t.href);
//             if(!tagUris) {
//                 tagUris = new Set();
//                 rs.state.tags.set(t.href, tagUris);
//             }

//             tagUris.add(rs.relativeUri);
//         });

//         tags.map((t) => {
//             rs.markDirty(t.href, {
//                 "title": t.href.substring('/tags/'.length),
//                 "_links": {
//                     "profile": [{
//                         "href": `/schema/index${t.href}`
//                     }, {
//                         "href": `/schema/index/tags`
//                     }]
//                 }
//             });
//         });
//         return rs;
//     }
// });

// /** get all "tag" links, or empty array */
// function getTags(resource: Hal.Resource): Hal.Link[] {
//     let tags = resource._links && resource._links.tag;
//     if(!tags) {
//         return [];
//     }

//     if(!Array.isArray(tags)) {
//         tags = [tags];
//     }
//     return tags;
// }
