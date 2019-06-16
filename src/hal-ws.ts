import * as HAL from './hal';

/** An extension to the HAL spec, indicating that the client may interact with a resource over a websocket interface
 *
 * A few reasonable options:
 * 1. a site that supports _ws resources contains a special ws resource with information for establishing a ws connection for the site. connection is kept open and _ws only declare the API (links) for a given resource
 * 2. Each _ws resource describes how to establish a connection for that single resource, and loading a different resource requires a separate ws connection (although the same connection may be reused).
 *
 * WS apis should be standardized. always support a request the latest document if it has changed, using checksum of resource.
 * use PATCH spec?
 */
export interface WsResource extends HAL.Resource {
    _ws: {[rel: string]: HAL.Link | HAL.Link[]};
}


/**
 * NOTE: Here are the problems we need to solve:
 * REST API format:
 *  - we need a way to specify actions in HAL resources that the client can make in a traditional HTTP REST way. Requirements:
 *    - Describe which links are "actions" (e.g. post comment)
 *    - Describe how to interact with "actions" (HTTP method, body format)
 *    - Describe the response structure. In many cases the response is not a resource.
 *
 * WS API
 *  - be able to do the things we can do with the REST API (?)
 *  - also specify additional actions that may only make sense over the WS connection for more interactive elements
 *  - describe expected WS events
 *  - subscribe to WS events we are interested in. possibly scoped by API and/or resource
 *
 * Considerations:
 *  - should we expect WS events to be similar to HAL resources? e.g. containing a "profile" link to identify the type of event? probably not??? many events are definitely NOT resources, and shouldn't necessarily be treated as such.
 *  - should expected WS events be tied to a given resource? this makes a lot of sense for getting updates to a specific resource as it is updated, and is very generic, but also requires us to retrieve WS information and subscriptions for each resource, which could be troublesome. However, we could also get some nice standardized behavior. e.g. subscribe to a resource to get updates to that single resource, subscribe to the index of that resource to get updates to all indexed resources, as well as newly created or deleted resources.
 *  - should you be able to use the entire site over WS in the same way as HTML? more complex and probably unnecesasry, but also prevents the need for HTTP request -> WS connection -> check if HTTP resource changed while we were subscribing to WS events.
 *
 *
 * REST API solutions:
 *  - "pure HAL": require the client to make an OPTIONS request to find possible HTTP actions. require looking up the (machine readable) docs based on the link's "rel".
 *    - Pros:
 *        - simple, uses standard HAL and HTTP concepts
 *    - Cons:
 *        - requires many more requests to the server. For a "generic, interactive HAL client" each resource may require dozens of requests to get all the information the GUI needs
 *        - only the "rel" can distinguish "actions" from resources. There are several types of links that are not really resources (log in, etc.)
 *    - Concessions:
 *        - provide a single resource that embeds all rel documentation together. interactive clients can make a single request to get all the information they need. Even for large sites, this will be a farily small document. We can also bundle the OPTIONS response data into this resource. Potential issues: more dynamic APIs will need many rels defined, even for very similar things. This might be a desired outcome.
 *        - HTML renderer will also need this information to create buttons, forms, etc. This is probably fine.
 *        - Say you have a resource "/posts/hello" that you want to update. should the resource contain an "update" link that is identical in value to the self link? I guess. same for POSTing to "/posts"
 *
 * - extend HAL to include extra data about the links
 *
 * WS API solutions:
 *  - each HAL resource describes the available WS events and actions in a _ws property. The client may establish a WS connection and send standard "subscribe" events to begin receiving specified events over the connectinon. may also support an "all" parameter to subscribe to all events for that resource.
 *  - "transactional" ws actions/events?
 *
 *  How are APIs defined? some REST and WS actions should be automatically added to the relevant resources via a processor. custom APIs may be described through a prviate property that is removed by the processor and replaced with the api links.
 */
