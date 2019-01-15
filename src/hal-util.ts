import * as HAL from './hal';
import * as Url from 'url';

/**
 * @returns only curies that are referenced in the target rels
 */
export function filterCuries(curies: HAL.Curie[], rels: string[]): HAL.Curie[] {
    const namespaces = rels.reduce((namespaces, ref) => {
        const refParts = ref.split(':');
        if(refParts.length > 1) {
            namespaces.push(refParts[0]);
        }
        return namespaces;
    }, [] as string[])

    return curies.filter((curi) => namespaces.indexOf(curi.name) !== -1);
}

/**
 * check if the resource contains the provided profile link
 * @param resource - HAL resource
 * @param profile - uri of the profile to match
 * @param baseUri - if the URI doesn't match exactly, tries again with this used as a prefix
 */
export function resourceMatchesProfile(resource: HAL.Resource, profile: HAL.Uri, baseUri?: HAL.Uri): boolean {
    const resourceProfile = resource._links && resource._links.profile;

    if(!resourceProfile) {
        return false;
    }

    return Array.isArray(resourceProfile)?
        !!(resourceProfile.find((link) => profilesMatch(profile, link.href, baseUri))):
        profilesMatch(profile, resourceProfile.href, baseUri);
}

export function getProfiles(resource: HAL.Resource): HAL.Link[] {
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
export function profilesMatch(profile: HAL.Uri, targetProfile?: HAL.Uri, baseUri?: HAL.Uri): boolean {
    return baseUri?
        profile === targetProfile || Url.resolve(baseUri, profile) === targetProfile:
        profile === targetProfile;
}
