/* types based on spec draft (https://tools.ietf.org/html/draft-kelly-json-hal-08) */
export type Uri = string;
export type UriTemplate = string;

/** represents a hyperlink from the containing resource to a URI. */
export interface Link {
    href: Uri | UriTemplate;
    /** SHOULD be true when the Link Object's "href" property is a URI Template. */
    templated?: boolean
    /** a hint to indicate the media type (MIME) expected when dereferencing the target resource. */
    type?: string;
    /** presence indicates that the link is to be deprecated (i.e. removed) at a future date.
     * Its value is a URL that SHOULD provide further information about the deprecation. */
    deprecation?: Uri;
    /** Its value MAY be used as a secondary key for selecting Link Objects which share the same relation type. */
    name?: string;
    /** hints about the profile (as defined by [I-D.wilde-profile-link]) of the target resource. */
    profile?: Uri;
    /** labels the link with a human-readable identifier. */
    title?: string;
    /** indicates the language of the target resource. */
    hreflang?: string;
}

export interface Resource {
    /** an object whose property names are link relation types.
     * The subject resource of these links is the Resource Object of which the containing "_links" object is a property. */
    '_links'?: {[rel: string]: Link | Link[]};
    /** an object whose property names are link relation types.
     * MAY be a full, partial, or inconsistent version of the representation served from the target URI. */
    '_embedded'?: {[rel: string]: Resource | Resource[]};
}

export interface Curie {
    /** must contain the {rel} placeholder */
    href: string;
    name: string;
    templated: boolean;
}

export interface ExtendedResource extends Resource {
    [uri: string]: any;
}
