import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { Observable, Observer } from 'rxjs';

import { NextFunction, Router, Request, Response } from 'express';
import { compile, registerHelper, registerPartial, SafeString, TemplateDelegate } from 'handlebars';

import { HAL, Hypermedia } from './hypermedia';
import { walkDirectory } from './util';

export type Html = string;
export namespace Html {
    export type Link = string;
}

// TODO: this doesn't work with link arrays.
registerHelper('hal-link', (rel, link) => new SafeString(`<a rel=${rel} href=${link.href}>${link.title || link.href}</a>`));
registerHelper('eq', (lhs, rhs) => lhs == rhs);
registerHelper('isArray', (val) => Array.isArray(val));

export type TemplateMap = {[uri: string]: TemplateDelegate};

/** Render's HAL into HTML using the handlebars templating engine */
export class HypermediaRenderer {
    public hypermedia: Hypermedia;
    public router: Router;
    public templates: TemplateMap;

    constructor(options: HypermediaRenderer .Options) {
        this.hypermedia = options.hypermedia;
        this.templates = {};
        this.router = Router();
        this.router.get('/*', this.middleware);
    }

    /** recursively load and compile files as partial tempaltes */
    public loadPartials(partialsPath: string): Promise<TemplateMap> {
        return walkDirectory(
            partialsPath,
            (filePath: string, uri: string, fileContents: string) => {
                const partial = registerPartial(uri, fileContents);
                this.templates[uri] = partial;
                return partial;
            });
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
        return template(resource);
    }

    public renderLink(rel: HAL.Uri, link: HAL.Link): Html.Link {
        return `<a rel=${rel} href=${link.href}>${link.title || rel}</a>`;
    }

    protected middleware = (req: Request, res: Response, next: NextFunction) => {
        if(Path.extname(req.path) === this.hypermedia.state.suffix) {
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
        partialPath: string;
    }
}
