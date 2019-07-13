export type Html = string;
export namespace Html {
    export type Link = string;
}

// maps resource 'profile' Uris to layout partial Uris
export type ProfileLayoutMap = {[uri: string]: HAL.Uri};
