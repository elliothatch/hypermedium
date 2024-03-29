/**
 * The difference between partials and templates:
 * In handlebars, a template is the base of an HTML page, while a partial is a snippet of HTML that can be injected into a template.
 * In hypermedium, templates and partials are applied to HAL resources in distinct ways. Partials that are used as layout are associated with a resource based on its `profile` field. This allows you to reuse layouts for common types of resources (e.g. a blog post with profile `/schema/post` is expected to have certain fields [name, body, author, etc.]. by associating a this profile with a layout, we can quickly create new posts without needing to worry about how to generate the HTML to display a post)
 * In contrast, templates can be thought of as "themes" for an entire website, and are selected by configuring URL routing paths with expressjs. While multiple websites can easily share the same partial layout, templates dictate the look and feel of the website "around" the blog post, and thus are not selected based on the content of the HAL resource.
 * You can still acheive powerful profile-based templating through the use of layouts by using a minimal template and very large layout partials, but templates allow the look of a website to remain consistent for many different types of resources.
 */
import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { Observable, Observer, Subject } from 'rxjs';
import { publish, refCount } from 'rxjs/operators';

import { NextFunction, Router, Request, Response } from 'express';
import * as Handlebars from 'handlebars';

import { HypermediaEngine } from './hypermedia-engine';
import * as JsonLD from './json-ld';
import * as JsonLDUtil from './json-ld-util';
import { File } from './util';

export type Html = string;
export namespace Html {
    export type Link = string;
}

// maps uri to a compiled template
export type TemplateMap = {[uri: string]: Handlebars.TemplateDelegate};
// maps a partial uri to the string content partial
export type PartialMap = {[uri: string]: string};
// maps resource 'profile' Uris to layout partial Uris
export type ProfileLayoutMap = {[uri: string]: JsonLD.IRI};

/** list of objects that map an express.js router path glob to a template URI
 * paths are applied to the router in order from beginning to end.
 * The defaultTemplate is used if none of the paths match */
export interface TemplateRoute {
    routerPattern: string;
    templateUri: string;
};

/**
 * Renders HAL into HTML using the handlebars templating engine
 * Uses the resource's profile to apply a layout
 */
export class HtmlRenderer {
    public hypermedia: HypermediaEngine;
    public router: Router;

    public handlebarsEnvironment: typeof Handlebars

    public partials: PartialMap;
    public templates: TemplateMap;
    public profileLayouts: ProfileLayoutMap;
    public templateRoutes: TemplateRoute[];
    // template paths are grouped into a router so we can add more paths dynamically and still have the fallback template last
    public templateRouter: Router;

    public defaultTemplate: JsonLD.IRI;
    public siteContext: object;

    public events: Observable<HtmlRenderer.Event>;
    protected eventsSubject: Subject<HtmlRenderer.Event>;

    constructor(options: HtmlRenderer.Options) {
        this.handlebarsEnvironment = Handlebars.create();
        // we have to register these partials here because they access the handlebars environment.
        // TODO: initialize handlebars helpers with factory function that is provided handlebars environment and other renderer data
        this.handlebarsEnvironment.registerHelper('escapedPartial', (partial, context) => {
            return this.handlebarsEnvironment.partials[partial](context);
        });
        this.handlebarsEnvironment.registerHelper('lookupLayout', (types) => {
            return this.getProfileLayout(Array.isArray(types)? types: [types]);
        });

        this.hypermedia = options.hypermedia;
        this.defaultTemplate = options.defaultTemplate || 'default.hbs';
        this.siteContext = options.siteContext || {};
        this.profileLayouts = options.profileLayouts || {};


        this.partials = {};
        this.templates = {};

        this.eventsSubject = new Subject();
        this.events = this.eventsSubject.pipe(
            publish(),
            refCount(),
        );

        this.router = Router();
        this.templateRouter = Router();

        this.templateRoutes = [];
        (options.templateRoutes || []).forEach((templateRoute) => this.addTemplatePath(templateRoute.routerPattern, templateRoute.templateUri));
        this.router.use(this.templateRouter);
        this.router.get('/*', this.middleware());
    }

    public addTemplatePath(routerPattern: string, templateUri: string): void {
        this.templateRoutes.push({
            routerPattern,
            templateUri
        });
        this.templateRouter.get(
            routerPattern,
            this.middleware(templateUri)
        );
    }

    public setProfileLayout(profile: string, layoutUri: string): void {
        this.profileLayouts[profile] = layoutUri;
    }

    /** recursively load partials
     * deprecated
     * */
    // public loadPartials(partialsPath: string, uriPrefix?: JsonLD.IRI): Promise<PartialMap> {
    //     return walkDirectory(
    //         partialsPath,
    //         (filePath: string, uri: string, fileContents: string) => {
    //             // strip leading slash, since partials can't start with a slash
    //             const partialName = uri.replace(/^\//, '');
    //             this.handlebarsEnvironment.registerPartial(partialName, fileContents);
    //             this.partials[partialName] = fileContents;
    //             return fileContents;
    //         },
    //         uriPrefix);
    // }

    public registerPartial(uri: string, contents: string): void {
        this.handlebarsEnvironment.registerPartial(uri, contents);
        this.partials[uri] = contents;
    }

    public unregisterPartial(uri: string): boolean {
        if(!this.partials[uri]) {
            return false;
        }

        this.handlebarsEnvironment.unregisterPartial(uri);
        delete this.partials[uri];
        return true;
    }

    /**
     * recursively load and compile files as templates
     * @param partialsPath - path to the partials directory in the file system
     * @param relativeUri - this prefix is prepended to the URI that all partials are mapped to
     */
    // public loadTemplates(templatesPath: string, uriPrefix?: JsonLD.IRI): Promise<TemplateMap> {
    //     return walkDirectory(
    //         templatesPath,
    //         (filePath: string, uri: string, fileContents: string) => {
    //             const template = this.handlebarsEnvironment.compile(fileContents);
    //             // execute the template to check for compile errors
    //             // template({});
    //             this.templates[uri] = template;
    //             return template;
    //         },
    //         uriPrefix);
    // }
    public registerHelper(name: string, helper: Handlebars.HelperDelegate): void {
        // TODO: store map of helpers for UI
        this.handlebarsEnvironment.registerHelper(name, helper);
    }

    public unregisterHelper(name: string): void {
        this.handlebarsEnvironment.unregisterHelper(name);
    }

    public registerTemplate(uri: string, contents: string): void {
        const template = this.handlebarsEnvironment.compile(contents);
        // execute the template to check for compile errors
        // template({});
        this.templates[uri] = template;
    }

    public unregisterTemplate(uri: string): boolean {
        if(!this.templates[uri]) {
            return false
        }

        delete this.templates[uri];
        return true;
    }

    public getProfileLayout(types: string[]): JsonLD.IRI | undefined {
        return types.reduce((layout, ldType) => {
            return layout || (ldType && this.profileLayouts[ldType]);
        }, undefined as JsonLD.IRI | undefined);
    }

    /**
     * @param uri - used only for logging
     */
    public render(resource: JsonLD.Document, templateUri: string, uri?: JsonLD.IRI): Html {
        // let links: Html.Link[] = [];
        // if(resource._links) {
        //     links = Object.keys(resource._links).reduce((l: Html.Link[], rel) => {
        //         const relLinks = resource._links![rel];
        //         return Array.isArray(relLinks)?
        //             l.concat(relLinks.map((link) => this.renderLink(rel, link))):
        //             l.concat([this.renderLink(rel, relLinks)]);
        //     }, []);
        // }

        const layout = this.getProfileLayout(JsonLDUtil.getTypes(resource));
        const context = Object.assign({}, {
            _site: Object.assign({}, this.siteContext, {layout}),
        },
            resource
        );


        // use the first layout found
        // TODO: match layout with path-to-regexp
        try {
            const html = this.templates[templateUri](context);
            this.eventsSubject.next({
                eType: 'render-resource',
                uri,
                context,
                html
            });
            return html;
        }
        catch(error) {
            const layoutUsed = layout || 'layouts/default.hbs';
            const e =  new Error(`Renderer (Handlebars): Error rendering ${uri} with layout ${layoutUsed}: ${error.message}`);
            (e as any).cause = error;
            (e as any).uri = uri;
            (e as any).layout = layoutUsed;
            throw e;
        }
    }

    /** if templateUri is empty or undefined, use the default template */
    protected middleware = (templateUri?: string) => (req: Request, res: Response, next: NextFunction) => {
        const suffix = '.json';
        if(Path.extname(req.url) === suffix || req.headers.accept === "application/ld+json" || req.headers.accept === "application/json") {
            return next();
        }

        const resource = this.hypermedia.resourceGraph.getResource(req.path);
        if(!resource) {
            return next();
        }

        const html = this.render(resource, templateUri || this.defaultTemplate, req.path);
        return res.status(200).send(html);
    }
}

export namespace HtmlRenderer {
    export interface Options {
        hypermedia: HypermediaEngine;
        defaultTemplate?: JsonLD.IRI;
        /** provides dynamic context data that can be accessed in partials as the "_site" object
         * e.g. providing the object {title: "hypermedium"} allows you to use {{_site.title}} in a partial to display "hypermedium"
         * WARNING: if the underlying HAL resource contains a "_site" property on the root object, it will override these values
         * TODO: only partially override (e.g. keep _site.title if the HAL only contains {_site: {author: "elliot"}}
         */
        siteContext?: object;
        profileLayouts?: ProfileLayoutMap;
        templateRoutes?: TemplateRoute[];
    }

    export type Event = Event.RenderResource;
    export namespace Event {
        export interface RenderResource {
            eType: 'render-resource';
            uri?: JsonLD.IRI;

            context: JsonLD.Document;
            html: Html;
        }
    }
}
