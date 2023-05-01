import * as Path from 'path';

import * as UriTemplate from 'uri-template';
import * as Url from 'url';

import { match } from 'path-to-regexp';

import * as Hal from './hal';

/** either a 'dot.separated.path' or array of property names */
export type PropertyPath = string | string[];


export function makeLink(resource: any, uri?: Hal.Uri, name?: string): Hal.Link {
    const profiles = getProfiles(resource);
    return {
        title: resource.title,
        profile: profiles.length > 0? profiles[0].href: undefined,
        ...resource._links?.self,
        href: uri,
        name,
    };
}

/**
 * @returns a copy of the uri pointing to the html version of the resource
 */
export function htmlUri(uri: Hal.Uri): Hal.Uri {
    const extname = Path.extname(uri);
    if(extname === '.json') {
        return uri.slice(0, -extname.length);
    }
    return uri;
}

/**
 * @returns only curies that are referenced in the target rels
 */
export function filterCuries(curies: Hal.Curie[], rels: string[]): Hal.Curie[] {
    const namespaces = rels.reduce((namespaces, ref) => {
        const refParts = ref.split(':');
        if(refParts.length > 1) {
            namespaces.push(refParts[0]);
        }
        return namespaces;
    }, [] as string[])

    return curies.filter((curi) => namespaces.indexOf(curi.name) !== -1);
}

export function expandCuri(resource: Hal.Resource, rel: string): Hal.Uri {
    if(!rel.includes(':')) {
        return rel;
    }

    const resourceCuries = resource._links && resource._links.curies;
    if(!resourceCuries) {
        return rel;
    }

    const curiParts = rel.split(':');
    const curies = Array.isArray(resourceCuries)? resourceCuries : [resourceCuries];

    const curi = curies.find((curi) => curi.name === curiParts[0]);
    if(!curi) {
        return rel;
    }

    const template = UriTemplate.parse(curi!.href);
    return template.expand({rel: curiParts[1]});
}


/**
 * check if the resource contains the provided profile link
 * @param resource - HAL resource
 * @param profile - uri of the profile to match
 * @param baseUri - if the URI doesn't match exactly, tries again with this used as a prefix
 */
export function matchesProfile(resource: Hal.Resource, profile: Hal.Uri, baseUri?: Hal.Uri): boolean {
    const resourceProfile = resource._links && resource._links.profile;

    if(!resourceProfile) {
        return false;
    }

    return Array.isArray(resourceProfile)?
        !!(resourceProfile.find((link) => profilesMatch(profile, link.href, baseUri))):
        profilesMatch(profile, resourceProfile.href, baseUri);
}

export function getProfiles(resource: Hal.Resource): Hal.Link[] {
    const profiles = resource._links && resource._links.profile;
    return !profiles? []:
        Array.isArray(profiles)?
        profiles:
        [profiles];
}

/**
 * check if the profile Uris match
 * @param profile - express path to match
 * @param targetProfile - profile we are checking
 * @param baseUri - if the URI doesn't match exactly, tries again with this used as a prefix
 */
export function profilesMatch(profile: Hal.Uri, targetProfile: Hal.Uri, baseUri?: Hal.Uri): boolean {
    // TODO: this may not work as expected if targetProfile starts with a slash '/' since Url.resolve will always ignore the baseUri in that case
    let matchFn: ReturnType<typeof match>;
    try {
        matchFn = match(profile);
    }
    catch(e: any) {
        e.pathMatch = profile;
        // nested urls (/a/b/https://c.org) cause issues with path-to-regexp
        // just compare directly
        return  !!(baseUri?
            targetProfile === profile || Url.resolve(baseUri, targetProfile) === profile:
            targetProfile === profile);
        // console.error('bad match', profile, targetProfile);
        // return false;
        // throw e;
    }
    const matchResult = baseUri?
        matchFn(targetProfile) || matchFn(Url.resolve(baseUri, targetProfile)):
        matchFn(targetProfile);

    // console.log('hi', targetProfile, profile, matchResult);
    return !!matchResult;
}

/**
 * Gets a property from an object if it exists. Supports nested properties with dot notation.
 * @param obj - root object
 * @param propertyName - name of the property to retrieved. Nested properties are specified with dot notation ('a.b.c')
 */
export function getProperty(obj: any, propertyName?: PropertyPath): any {
    if(!obj) {
        return obj;
    }

    if(!propertyName) {
        return obj;
    }

    // empty property is identity function
    const properties = Array.isArray(propertyName)? propertyName: propertyName.split('.');

    if(properties.length === 1) {
        return obj[properties[0]];
    }

    return getProperty(obj[properties[0]], properties.slice(1));
}

/**
 * returns all instances of a property, searching all values in any arrays in the property chain
* for example. matchProperty({items: [{name: 'a'}, {name: 'b'}]}, 'items.name') returns ['a', 'b']
* }
 */
export function matchProperty(obj: any, propertyName: PropertyPath): any[] {
    if(!obj) {
        return [];
    }

    const properties = Array.isArray(propertyName)? propertyName: propertyName.split('.');
    const value = obj[properties[0]];
    if(!value) {
        return [];
    }

    const values = Array.isArray(value)? value: [value];

    if(properties.length === 1) {
        return values;
    }

    return values.reduce((arr, v) => arr.concat(matchProperty(v, properties.slice(1))), [] as any[]);
}

/**
 * sets a property on an object. Supports nested properties, creates nested objects when necessary
 * @param obj - root object
 * @param propertyName - name of the property to set. Nested properties are specified with dot notation ('a.b.c') or as an array ['a', 'b', 'c']
 * @param value - the value to set. if undefined, do nothing and don't create nested objects
 * @returns obj
 */
export function setProperty(obj: any, propertyName: PropertyPath | undefined, value: any): any {
    if(!obj) {
        return obj;
    }

    if(!propertyName) {
        return value;
    }

    const properties = Array.isArray(propertyName)? propertyName: propertyName.split('.');

    if(properties.length === 1) {
        obj[properties[0]] = value;
        return obj;
    }

    if(!obj[properties[0]]) {
        obj[properties[0]] = {};
    }
    setProperty(obj[properties[0]], properties.slice(1), value);
    return obj;
}

// TODO: make this work with different MIME types with sensible default beahvior
export function normalizeUri(uri: Hal.Uri): Hal.Uri {
    const suffix = '.json';
    if(uri.slice(-1) === '/') {
        return `${uri}index${suffix}`;
    }
    else if(uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
        return uri + suffix;
    }
    return uri;
}

/** returns an object containing only the properties listed in 'properties' */
export function pickProperties<T extends {[key: string]: any}>(target: T, properties: PropertyPath[]): Partial<T> {

    properties.reduce((result, property) => {
        setProperty(result, property, getProperty(target, property));
        return result;
    }, {});
    return target;
}

/** recursively merge two objects. source values overwrite target values
* arrays are overwritten rather than merged. */
export function mergeObjects<T extends {[key: string]: any}, U extends {[key: string]: any}>(target: T, source: U): T & U {
    Array.from(Object.entries(source)).forEach(([key, value]) => {
        if(typeof value !== 'object' || Array.isArray(value)) {
            target[key as keyof T & U] = value;
            return;
        }

        if(typeof target[key] !== 'object' || Array.isArray(target[key])) {
            // target value is not an object, overwite it with the object
            target[key as keyof T & U] = value;
            return;
        }

        // both values are objects, merge
        mergeObjects(target[key], value);
    });

    return target as T & U;
}

// TODO: what is the purpose of this
// sometimes we have a link and we ant to get extra data about it to manipulate it in some way (e.g. sorting a list of _links)
// it would be nice to be able to easily get the resource a link refers to if it is already embedded
// considerations:
// a rel hint can be provided to reduce search time, but is it worth the complication?
// otherwise we have to blindly search through all embedded resources for the correct _links.self.href
// we probably don't care about getting a specific property
// that was meant as a fallback to return a property on the link, but the link and resource are completely different things
// that being said, in sort, you might actually want to sort by link name, etc, since you don't necessarily know that you're sorting a link?
// idk
// export function getEmbedded(resource: Hal.Resource, link: Hal.Link, property: PropertyPath): any {
//     let result = getProperty(link, property);
//     if(!resource._embedded) {
//         return result;
//     }

//     const embeddedRel = resource._embedded[rel];
//     const embeddedResources =
//         Array.isArray(embeddedRel)?
//         embeddedRel:
//         resource._embedded[rel]?
//         [resource._embedded[rel]]:
//         [];

//     const embeddedResource = embeddedResources.find(
//         (r: any) => r?._links?.self?.href === link.href
//     );

//     if(!embeddedResource) {
//         return options.inverse(link);
//     }
// }

