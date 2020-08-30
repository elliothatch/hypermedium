import * as Path from 'path';

import * as UriTemplate from 'uri-template';
import * as Url from 'url';

import * as Hal from './hal';

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
export function resourceMatchesProfile(resource: Hal.Resource, profile: Hal.Uri, baseUri?: Hal.Uri): boolean {
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
 * @param profile
 * @param targetProfile
 * @param baseUri - if the URI doesn't match exactly, tries again with this used as a prefix
 */
export function profilesMatch(profile: Hal.Uri, targetProfile?: Hal.Uri, baseUri?: Hal.Uri): boolean {
    return baseUri?
        profile === targetProfile || Url.resolve(baseUri, profile) === targetProfile:
        profile === targetProfile;
}

/**
 * Gets a property from an object if it exists. Supports nested properties with dot notation
 * @param obj - root object
 * @param propertyName - name of the property to retrieved. Nested properties are specified with dot notation ('a.b.c')
 */
export function getProperty(obj: any, propertyName: string): any {
    if(!obj) {
        return undefined;
    }

    const properties = propertyName.split('.');
    const value = obj[properties[0]];
    if(properties.length === 1) {
        return value;
    }

    return getProperty(value, properties.slice(1).join('.'));
}

/**
 * sets a property on an object. Supports nested properties, creates nested objects when necessary
 * @param obj - root object
 * @param propertyName - name of the property to set. Nested properties are specified with dot notation ('a.b.c')
 * @param value - the value to set. if undefined, do nothing and don't create nested objects
 */
export function setProperty(obj: any, propertyName: string, value: any): any {
    if(!obj) {
        return undefined;
    }

    const properties = propertyName.split('.');
    if(properties.length === 1) {
        obj[properties[0]] = value;
        return obj;
    }

    if(!obj[properties[0]]) {
        obj[properties[0]] = {};
    }
    return setProperty(obj[properties[0]], properties.slice(1).join('.'), value);
}
