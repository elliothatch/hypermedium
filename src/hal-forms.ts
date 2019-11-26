/* types based on spec draft (http://rwcbook.github.io/hal-forms/) */
/** NOTE: The following types are technically in conflict with HAL-FORMS, because they are considered HAL resources in our definition. The HAL-FORMS spec explicitly states that "HAL and HAL-FORMS should not be thought of as interchangable in any way."
 * However, the HAL-FORMS specification also states that "Authors can extend the HAL-FORMS media type as long as "no existing properties or objects are removed or altered in a way that is non-backward compatible, and all new properties are optional". In general, this means that treating HAL-FORMS documents as extendable HAL documents, we are not violating the spec. This allows us to simplify our type definitions, and allow custom extentions if wanted.
 */
import * as HAL from './hal';

export interface Property {
    /** The parameter name. This is a valid JSON string. This is a REQUIRED element. If this attribute is missing or set to empty, the client SHOULD ignore this property object completely. */
    name: string;
    /** The human-readable prompt for the parameter. This is a valid JSON string. This is an OPTIONAL element. If this element is missing, clients MAY act as if the prompt value is set to the value in the name attribute. */
    prompt?: string;
            /** Indicates whether the parameter is read-only. This is a valid JSON boolean. This is an OPTIONAL element. If this element is missing, empty, or set to an unrecognized value, it SHOULD be treated as if the value of readOnly is set to ‘false’. */
    readOnly? : boolean;
    /** A regular expression string to be applied to the value of the parameter. Rules for valid values are the same as the HTML5 pattern attribute [HTML5PAT]. This is an OPTIONAL element. If this attribute missing, is set to empty, or is unparseable , it SHOULD be ignored. */
    regex?: string; 
           /** Indicates whether the parameter is required. This is a valid JSON boolean. This is an OPTIONAL element. If this attribute is missing, set to blank or contains an unrecognized value, it SHOULD be treated as if the value of required is set to ‘false’. */
    required?: boolean;
              /** Indicate whether the value element contains a URI Template [RFC6570] string for the client to resolve. This is a valid JSON boolean. This is an OPTIONAL element. If this element is missing, set to empty, or contains unrecognized content, it SHOULD be treated as if the value of templated is set to ‘false’. */
    templated?: boolean; 
    /** The parameter value. This is a valid JSON string. This string MAY contain a URI Template (see templated for details). This is an OPTIONAL element. If it does not exist, clients SHOULD act as if the value property is set to an empty string. */
    value?: string | HAL.UriTemplate;
}

export interface Template {
    /** The value of contentType is the media type the client SHOULD use when sending a request body to the server. This is an OPTIONAL element. The value of this property SHOULD be set to "application/json" or "application/x-www-form-urlencoded". It MAY be set to other valid media-type values. If the contentType property is missing, is set to empty, or contains an unrecognized value, the client SHOULD act is if the contentType is set to "application/json". */
    contentType?: string;
    /** The HTTP method the client SHOULD use when the service request. Any valid HTTP method is allowed. This is a REQUIRED element. If the value is empty or is not understood by the client, the value MUST be treated as an HTTP GET. */
    method: string;
    /** An array of one or more anonymous property objects (see property) that each describe a parameter for the associated state transition. This is an OPTIONAL element. If the array is missing or empty, the properties collection MUST be treated as an empty set of parameters — meaning that the transition is meant to be executed without passing any parameters. */
    properties?: Property[];
    /** A human-readable string that can be used to identify this template. This is a valid JSON string. This is an OPTIONAL element. If it does not exist or is unparsable, consumers MAY use the key value of the template as the value for title. */
    title?: string;
}

export interface FormResource extends HAL.Resource {
    /** The _templates element describes the available state transition details including the HTTP method, message content-type, and arguments for the transition. This is a REQUIRED element. If the HAL-FORMS document does not contain this element or the contents are unrecognized or unparsable, the HAL-FORMS document SHOULD be ignored. 
     *
     * key - The unique identifier for this template object. This is a REQUIRED element. For this release, the only valid value for key is "default". If this element is missing, set to empty or is unparsable, this template object SHOULD be ignored. */
    '_templates': {[name: string]: Template};
}
