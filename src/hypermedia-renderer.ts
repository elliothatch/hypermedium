import * as Path from 'path';
import { promises as fs } from 'fs';
import * as Url from 'url';

import { Observable, Observer } from 'rxjs';

import { NextFunction, Router, Request, Response } from 'express';
import { compile, registerHelper, SafeString } from 'handlebars';

import { HAL, Hypermedia } from './hypermedia';

export type Html = string;
export namespace Html {
    export type Link = string;
}

const template = compile(`
<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8">
        <title>{{title}}</title>
    </head>
    <body>
    <div>Links:
    <ul>
    {{#each _links}}
        <li>{{hal-link @key this}}</li>
    {{/each}}
    </ul>
    </div>
    </body>
</html>
`);

// TODO: this doesn't work with link arrays.
registerHelper('hal-link', (rel, link) => new SafeString(`<a rel=${rel} href=${link.href}>${link.title || link.href}</a>`));

/** Render's HAL into HTML using the handlebars templating engine */
export class HypermediaRenderer {
    public hypermedia: Hypermedia;
    public router: Router;

    constructor(options: HypermediaRenderer .Options) {
        this.hypermedia = options.hypermedia;
        this.router = Router();
        this.router.get('/*', this.middleware);
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

        const html = this.render(resource);

        return res.status(200).send(html);
    }
}

export namespace HypermediaRenderer {
    export interface Options {
        hypermedia: Hypermedia;
    }
}
