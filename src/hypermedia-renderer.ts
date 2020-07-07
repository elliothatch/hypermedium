/**
 * The difference between partials and templates:
 * In handlebars, a template is the base of an HTML page, while a partial is a snippet of HTML that can be injected into a template.
 * In freshr, templates and partials are applied to HAL resources in distinct ways. Partials that are used as layout are associated with a resource based on its `profile` field. This allows you to reuse layouts for common types of resources (e.g. a blog post with profile `/schema/post` is expected to have certain fields [name, body, author, etc.]. by associating a this profile with a layout, we can quickly create new posts without needing to worry about how to generate the HTML to display a post)
 * In contrast, templates can be thought of as "themes" for an entire website, and are selected by configuring URL routing paths with expressjs. While multiple websites can easily share the same partial layout, templates dictate the look and feel of the website "around" the blog post, and thus are not selected based on the content of the HAL resource.
 * You can still acheive powerful profile-based templating through the use of layouts by using a minimal template and very large layout partials, but templates allow the look of a website to remain consistent for many different types of resources.
 */
import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { Observable, Observer } from 'rxjs';

import { NextFunction, Router, Request, Response } from 'express';
import * as Handlebars from 'handlebars';

import { Hypermedia } from './hypermedia';
import * as HAL from './hal';
import { expandCuri, getProfiles, htmlUri } from './hal-util';
import { File, walkDirectory } from './util';

export type Html = string;
export namespace Html {
    export type Link = string;
}

// maps uri to a compiled template
export type TemplateMap = {[uri: string]: Handlebars.TemplateDelegate};
// maps a partial uri to the string content partial
export type PartialMap = {[uri: string]: string};
// maps resource 'profile' Uris to layout partial Uris
export type ProfileLayoutMap = {[uri: string]: HAL.Uri};

/** list of objects that map an express.js router path glob to a template URI
 * paths are applied to the router in order from beginning to end.
 * The defaultTemplate is used if none of the paths match */
export interface TemplatePath {
    routerPath: string;
    templateUri: string;
};

/**
 * Renders HAL into HTML using the handlebars templating engine
 * Uses the resource's profile to apply a layout
 */
export class HypermediaRenderer {
    public hypermedia: Hypermedia;
    public router: Router;

    public handlebarsEnvironment: typeof Handlebars

    public partials: PartialMap;
    public templates: TemplateMap;
    public profileLayouts: ProfileLayoutMap;
    public templatePaths: TemplatePath[];
    // template paths are grouped into a router so we can add more paths dynamically and still have the fallback template last
    public templateRouter: Router;

    public defaultTemplate: HAL.Uri;
    public siteContext: object;

    constructor(options: HypermediaRenderer.Options) {
        this.handlebarsEnvironment = Handlebars.create();

        this.hypermedia = options.hypermedia;
        this.defaultTemplate = options.defaultTemplate || 'core/default.hbs';
        this.siteContext = options.siteContext || {};
        this.profileLayouts = options.profileLayouts || {};
        this.templatePaths = options.templatePaths || [];


        this.partials = {};
        this.templates = {};

        this.router = Router();
        this.templateRouter = Router();

        this.templatePaths.forEach((templatePath) => this.addTemplatePath(templatePath));
        this.router.use(this.templateRouter);
        this.router.get('/*', this.middleware());
    }

    public addTemplatePath(templatePath: TemplatePath): void {
        this.templateRouter.get(
            templatePath.routerPath,
            this.middleware(templatePath.templateUri)
        );
    }

    public setProfileLayout(profile: string, layoutUri: string): void {
        this.profileLayouts[profile] = layoutUri;
    }

    /** recursively load partials
     * @deprecated
     * */
    // public loadPartials(partialsPath: string, uriPrefix?: HAL.Uri): Promise<PartialMap> {
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

    public registerPartial(uri: string, contents: string, namespace: string): void {
        const partialName = namespace.length > 0?
            `${namespace}/${uri.replace(/^\//g, '')}`:
            uri.replace(/^\//g, '');
        this.handlebarsEnvironment.registerPartial(partialName, contents);
        this.partials[partialName] = contents;
    }

    public unregisterPartial(uri: string, namespace: string): boolean {
        const partialName = namespace.length > 0?
            `${namespace}/${uri.replace(/^\//g, '')}`:
            uri.replace(/^\//g, '');

        if(!this.partials[partialName]) {
            return false;
        }

        this.handlebarsEnvironment.unregisterPartial(partialName);
        delete this.partials[partialName];
        return true;
    }

    /**
     * recursively load and compile files as templates
     * @param partialsPath - path to the partials directory in the file system
     * @param relativeUri - this prefix is prepended to the URI that all partials are mapped to
     */
    // public loadTemplates(templatesPath: string, uriPrefix?: HAL.Uri): Promise<TemplateMap> {
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

    public registerTemplate(uri: string, contents: string, namespace: string): void {
        const templateName = namespace.length > 0?
            `${namespace}/${uri.replace(/^\//g, '')}`:
            uri.replace(/^\//g, '');
        const template = this.handlebarsEnvironment.compile(contents);
        // execute the template to check for compile errors
        // template({});
        this.templates[templateName] = template;
    }

    public unregisterTemplate(uri: string, namespace: string): boolean {
        const templateName = namespace.length > 0?
            `${namespace}/${uri.replace(/^\//g, '')}`:
            uri.replace(/^\//g, '');
        if(!this.templates[templateName]) {
            return false
        }

        delete this.templates[templateName];
        return true;
    }

    public render(resource: Hypermedia.ExtendedResource, templateUri: string): Html {
        // let links: Html.Link[] = [];
        // if(resource._links) {
        //     links = Object.keys(resource._links).reduce((l: Html.Link[], rel) => {
        //         const relLinks = resource._links![rel];
        //         return Array.isArray(relLinks)?
        //             l.concat(relLinks.map((link) => this.renderLink(rel, link))):
        //             l.concat([this.renderLink(rel, relLinks)]);
        //     }, []);
        // }

        // use the first layout found
        const layout: HAL.Uri | undefined = getProfiles(resource).reduce((layout, profile) => {
            return layout || this.profileLayouts[profile.href];
        }, undefined as HAL.Uri | undefined);
        const context = Object.assign({}, {
            _site: Object.assign({}, this.siteContext, {layout}),
        },
            resource
        );
        return this.templates[templateUri](context);
    }

    public renderLink(rel: HAL.Uri, link: HAL.Link): Html.Link {
        return `<a rel=${rel} href=${link.href}>${link.title || rel}</a>`;
    }

    /** if templateUri is empty or undefined, use the default template */
    protected middleware = (templateUri?: string) => (req: Request, res: Response, next: NextFunction) => {
        if(Path.extname(req.path) === this.hypermedia.state.suffix || req.headers.accept === "application/hal+json") {
            return next();
        }
        const resource = this.hypermedia.getResource(req.path);
        if(!resource) {
            return next();
        }

        try {
            const html = this.render(resource, templateUri || this.defaultTemplate);
            return res.status(200).send(html);
        }
        catch(err) {
            return next(err);
        }

    }
}

export namespace HypermediaRenderer {
    export interface Options {
        hypermedia: Hypermedia;
        defaultTemplate?: HAL.Uri;
        /** provides dynamic context data that can be accessed in partials as the "_site" object
         * e.g. providing the object {title: "freshr"} allows you to use {{_site.title}} in a partial to display "freshr"
         * WARNING: if the underlying HAL resource contains a "_site" property on the root object, it will override these values
         * TODO: only partially override (e.g. keep _site.title if the HAL only contains {_site: {author: "elliot"}}
         */
        siteContext?: object;
        profileLayouts?: ProfileLayoutMap;
        templatePaths?: TemplatePath[];
    }
}
