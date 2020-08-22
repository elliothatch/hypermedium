// Type definitions for uri-template
// Project: https://github.com/grncdr/uri-template
// Definitions by: Elliot Hatch <https://github.com/elliothatch>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

declare module 'uri-template' {
    export interface Template {
        expand: (values: object) => string;
    }
    export function parse(uri: string): Template;
}
