import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { Observable, Observer } from 'rxjs';

import { NextFunction, Router, Request, Response } from 'express';
import { compile, registerHelper, registerPartial, SafeString, TemplateDelegate } from 'handlebars';

import { Hypermedia } from './hypermedia';
import * as HAL from './hal';
import { expandCuri, getProfiles, htmlUri } from './hal-util';
import { walkDirectory } from './util';

export type Html = string;
export namespace Html {
    export type Link = string;
}

/**
 * renders the link as an anchor tag. automatically expands curies based on the root resource. to use a different resource to resolve the curi, pass it as the third parameter
 * TODO: this doesn't work with link arrays.
 * TODO: add option to not use html-link shortening
 * */
registerHelper('hal-link', (rel, link, ...options) => {
    let resource = options[0];
    if(options.length === 1) {
        // no resource provided, use the root resource
        resource = options[0].data.root;
    }

    const relHtml = typeof rel === 'string'? `rel=${expandCuri(resource, rel)}`: '';

    return new SafeString(`<a ${relHtml} href=${htmlUri(link.href)}>${link.title || link.href}</a>`)
});
registerHelper('eq', (lhs, rhs) => lhs == rhs);
registerHelper('startsWith', (str, seq) => str.startsWith(seq));
registerHelper('isArray', (val) => Array.isArray(val));
registerHelper('json', (val) => JSON.parse(val));
registerHelper('html-uri', htmlUri);
registerHelper('expandCuri', expandCuri);

// maps uri to a compiled template
export type TemplateMap = {[uri: string]: TemplateDelegate};
// maps a partial uri to the string content partial
export type PartialMap = {[uri: string]: string};
// maps resource 'profile' Uris to layout partial Uris
export type ProfileLayoutMap = {[uri: string]: HAL.Uri};

/**
 * Renders HAL into HTML using the handlebars templating engine
 * Uses the resource's profile to apply a layout
 */
export class HypermediaRenderer {
    public hypermedia: Hypermedia;
    public router: Router;

    public partials: PartialMap;
    public templates: TemplateMap;
    public profileLayouts: ProfileLayoutMap;

    public defaultTemplate: HAL.Uri;
    public siteContext: object;

    constructor(options: HypermediaRenderer.Options) {
        this.hypermedia = options.hypermedia;
        this.defaultTemplate = options.defaultTemplate || 'core/layouts/default.hbs';
        this.siteContext = options.siteContext || {};
        this.profileLayouts = options.profileLayouts || {};


        this.partials = {};
        this.templates = {};

        this.router = Router();
        this.router.get('/*', this.middleware);
    }

    /** recursively load partials */
    public loadPartials(partialsPath: string, uriPrefix?: HAL.Uri): Promise<PartialMap> {
        return walkDirectory(
            partialsPath,
            (filePath: string, uri: string, fileContents: string) => {
                // strip leading slash, since partials can't start with a slash
                const partialName = uri.replace(/^\//, '');
                registerPartial(partialName, fileContents);
                this.partials[partialName] = fileContents;
                return fileContents;
            },
            uriPrefix);
    }

    /**
     * recursively load and compile files as templates
     * @param partialsPath - path to the partials directory in the file system
     * @param relativeUri - this prefix is prepended to the URI that all partials are mapped to
     */
    public loadTemplates(templatesPath: string, uriPrefix?: HAL.Uri): Promise<TemplateMap> {
        return walkDirectory(
            templatesPath,
            (filePath: string, uri: string, fileContents: string) => {
                const template = compile(fileContents);
                // execute the template to check for compile errors
                // template({});
                this.templates[uri] = template;
                return template;
            },
            uriPrefix);
    }

    public render(resource: Hypermedia.ExtendedResource): Html {
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
        return this.templates[this.defaultTemplate](context);
    }

    public renderLink(rel: HAL.Uri, link: HAL.Link): Html.Link {
        return `<a rel=${rel} href=${link.href}>${link.title || rel}</a>`;
    }

    protected middleware = (req: Request, res: Response, next: NextFunction) => {
        if(Path.extname(req.path) === this.hypermedia.state.suffix || req.headers.accept === "application/hal+json") {
            return next();
        }
        const resource = this.hypermedia.getResource(req.path);
        if(!resource) {
            return next();
        }

        try {
            const html = this.render(resource);
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
    }
}
