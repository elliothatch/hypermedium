/** simplified JSON-LD types based on JSON-LD 1.1 (16 July 2020): https://www.w3.org/TR/json-ld/
* Hypermedium operates on simplified, compacted form JSON-LD documents. Currently, it only supports documents that contain a top-level Node object (not an array or graph). Support of most keywords is extremely limited. The ultimate goal is to fully support the JSON-LD spec.
* */

/** An IRI is the absolute form of an IRI containing a scheme along with a path and optional query and fragment segments.
* IRIReference Denotes the common usage of an Internationalized Resource Identifier. An IRI reference may be absolute or relative. However, the "IRI" that results from such a reference only includes absolute IRIs; any relative IRI references are resolved to their absolute form.
* In JSON-LD, any IRI can be an IRI Reference. We use the type name IRI as shorthand for IRI Reference */
export type IRI = string;

/** A compact IRI has the form of prefix:suffix and is used as a way of expressing an IRI without needing to define separate term definitions for each IRI contained within a common vocabulary identified by prefix.
* A blank node identifier is a string that can be used as an identifier for a blank node within the scope of a JSON-LD document. Blank node identifiers begin with _:.
* In JSON-LD, blank node identifiers may be used anywhere a Compact IRI is used, so we use CompactIRI as a shorthand. */
export type CompactIRI = string;
/** A keyword is a string that is specific to JSON-LD, described in the Syntax Tokens and Keywords section of JSON-LD 1.1, and normatively specified in the Keywords section of JSON-LD 1.1 */

/** A term is a short-hand string that expands to an IRI, blank node identifier, or keyword. */
export type Term = string;

/** Node type or Value type */
export type LdType = IRI | CompactIRI | Term | null | '@id' | '@json' | '@none' | '@vocab';

/** An expanded term definition is a term definition where the value is a map containing one or more keyword keys to define the associated IRI, if this is a reverse property, the type associated with string values, and a container mapping.
* This is a very simplified definition that doesn't enforce restrictions on properties for various term definition shapes */
export interface ExpandedTermDefinition {
    '@id'?: IRI |  CompactIRI | Term | null;
    '@reverse'?: IRI | CompactIRI | Term;
    '@type'?: LdType;
    '@language'?: string | null;
    '@index'?: IRI | CompactIRI | Term;
    '@container'?: '@list' | '@set' | '@language' | '@index' | '@id' | '@graph' | '@type' | null | Array<'@list' | '@set' | '@language' | '@index' | '@id' | '@graph' | '@type'>;
    '@context'?: ContextDefinition;
    '@nest'?: '@nest' | Term;
    '@prefix'?: boolean;
    '@propegate'?: boolean;
    '@protected'?: boolean;
}

/** A context definition defines a local context in a node object. */
export type ContextDefinition = {
    '@base'?: IRI | null;
    '@direction'?: 'ltr' | 'rtl' | null;
    '@import'?: IRI;
    '@language'?: string | null;
    '@propegate'?: boolean;
    '@protected'?: boolean;
    '@type'?: {
        '@container': '@set',
        '@protected'?: boolean;
    };
    '@version'?: number /* 1.1 */;
    '@vocab'?: IRI | CompactIRI | Term | null;
} | {
    [property: string /*IRI | CompactIRI | Term*/]: IRI | CompactIRI | Term | ExpandedTermDefinition | null;
}

/** A node object represents zero or more properties of a node in the graph serialized by the JSON-LD document. */
export type Node = {
    '@context'?: null | IRI | ContextDefinition | Array<null | IRI | ContextDefinition>;
    '@id'?: IRI | CompactIRI;
    '@graph'?: Node | Array<Node>;
    '@type'?: IRI | CompactIRI | Term | Array<IRI | CompactIRI | Term>;
    '@reverse'?: IRI | CompactIRI | Node | Array<IRI | CompactIRI | Node>;
    '@included'?: Node | Array<Node>;
    '@nest'?: Record<string, any> | Array<Record<string, any>>;
    '@index'?: string;
} & {[key: string /*IRI | CompactIRI | Term*/]: any};

// export type Document = Node | Array<Node> | {"@context"?: any; "@graph"?: any}
// TODO: support array of nodes and graph as valid document
export type Document = Node
