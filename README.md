# Hypermedium
Hypermedium is a NodeJs tool for creating static and dynamic websites.

 - Let hypermedia processors do the hard work by enhancing your pages with dynamic data--whether that's creating an index of all your posts or displaying your users' latest comments.
 - Maintain full creative control over the look and feel of your site with the fully customizable HTML renderer, built on the [Handlebars](https://handlebarsjs.com/) template engine.
 - Utilize 3rd party tools like [Sass](https://sass-lang.com/) to perform advanced asset preprocessing with the build manager.


# Overview
Core goals:
 - Simple templating: Create a template for the overall structure of your site, then further customize how specific types of posts are displayed with the layout system.
 - Fully customizable: Hypermedium completely separates the data that makes up your posts and how they are presented in your web browser, giving you full control over how your website looks, even when extending it with plugins.
 - Extendable: Plugins are simple to integrate into your site and easy to create using modern Javascript tools and libraries. Since the core resources of your site are just JSON objects, plugins can build on each other and enrich your pages without relying on hardcoded HTML or complex hooks.
 - Easy to set up: No need to set up a database to start building your website.

## Hypermedia Engine
The hypermedia engine is at the core of Hypermedium. Every page on your site starts as a simple JSON object in [HAL format](http://stateless.co/hal_specification.html). Then Hypermedium processors you've configured will automatically modify or extend these resources to create a complex and interconnected web of data representing your entire site. For example, the `makeIndex` processor allows you to create a table of contents style index page containing all the blog posts on your site. Then you can add the `embed` plugin to include a short summary of each post based on its first paragraph of text. Whenever you publish a new post or edit an existing post, Hypermedium automatically updates the index page to include the latest title and summary for each of your posts.

Since all this processing is happening at the JSON data layer, it's easy to mix and match multiple processors without needing to worry about compatibility or visual congruity. You have full control over the appearance of your website in the next step with the HTML renderer.

## HTML Renderer
The HTML renderer takes a HAL resource and converts it into a full HTML page that can be viewed in your web browser. Based on the minimal but powerful [handlebars template engine](https://handlebarsjs.com), the HTML renderer allows you to easily display all the rich data from your HAL resources however you like. Create the base template that ties together your whole site with one unified look, and then further customize the layout for each specific type of page, be it a blog post, image gallery, or a unique page like your homepage. Since layouts inherit the look of your base template, its easy to utilize advanced user interfaces from plugins, while maintaining the look and feel of your personal website.

## Build Manager
Advanced sites may require extensive preprocessing steps to generate javascript, stylesheets, and other assets that your webpages rely on. The build manager is a general-purpose tool for organizing and running these tasks, allowing you to leverage 3rd party tools like [SASS](https://sass-lang.com), [Rollup](https://rollupjs.org), and [React](https://reactjs.org) while building your website.

## Plugins
The flexible plugin system allows you to extend any part of your website by enhancing the hypermedia engine, HTML renderer, and build system. In fact, when you create a website, you're really just creating a Hypermedium plugin.

## Dashboard (WIP)
The live dashboard gives you full control over your website. This is where you create, edit, and publish posts. You can also manage plugins, processors, templates, layouts, and build tasks.

# Roadmap
 - HAL API extension
 	- Plugins can add HTTP and Websocket APIs that are exposed through a standarized HAL extension.
 - Data sources
 	 - Interface for plugins to store and read dynamic data.
 	 - Interchangable data sources including file system, SQL databases, etc.
 - Javascript Components
 	 - Register Javascript modules with the plugin system, so they can be easily integrated into other plugins and templates.
 - Plugins
 	- User authentication
 	- Live admin dashboard
		- create and edit HAL resources
		- markdown editor
		- create and edit assets
		- install and remove plugins and modules
		- create live draft versions of the website
		- track and commit changes with git?
		- create tasks that can be used as build steps
		- configure dynamic data store
 	- Comments
 	- Wiki
 	- Art gallery
 	- Forum
 	- Storefront

# Get Started
Starter repo coming soon! In the meantime, you can follow these steps to get started:

1. Copy the `hypermedium-demo` directory and navigate to it.
2. Run `npm install` or `yarn`.

To generate a static website:
Run `npm run static` or `yarn static`. The website will be created in the `static/` directory.

To run the Hypermedium dynamic web server:
Run `npm start` or `yarn start`, and open a web browser to `localhost:8080`.  

It is highly recommended to run the Hypermedium server with [sift-cli](https://www.npmjs.com/package/sift-cli) during development, which will display the log output in a friendly, interactive interface.
1. Install with `npm install -g sift-cli` or `yarn global add sift-cli`.
2. Run the web server with `npm run dev` or `yarn dev`.

See the tutorial (coming soon) for a full overview of Hypermedium's functionality and plugin structure.

## Other usage
Hypermedium can also be used as a library.

# API Reference
TODO: technical overview of the different systems involved, plugin structure, intended usage such as layout format, etc.
TODO: full API documentation with typedoc

# Development
This monorepo contains hypermedium and several crucial plugins, managed with yarn workspaces. The following commands should be run in the repo root directory.

## Install
```
yarn
```

## Build
```
yarn build`
```

## Run demo
```
yarn start
```

Or to launch with sift:

```
yarn dev
```
## Notes
We use nohoist for build assets in the demo workspace, so the sass includePath is the same as if you downloaded and modified the demo package directly.
