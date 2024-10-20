# Hypermedium
Hypermedium is a NodeJs tool for creating personal websites and blogs.

 - Enhance your pages with dynamic data with hypermedia processors--whether that's creating an index of all your posts or displaying your users' latest comments.
 - Maintain full creative control over the look and feel of your site with the fully customizable HTML renderer, built on the [Handlebars](https://handlebarsjs.com/) template engine.
 - Utilize 3rd party tools like [Sass](https://sass-lang.com/) to perform advanced asset preprocessing with the build manager.

## Hypermedium is alpha software. It may have bugs, and APIs and functionality are subject to change over the course of development.

This is the Hypermedium monorepo, containing the hypermedium project and core plugins. Additional documentation for each component may be found in the package's README.

## Project Status
The core Hypermedium engine and plugin API is mostly stablized. Usage requires some familiarity with Node.js web development. Documentation and usage guides are in development. Default templates and schema.org support are minimal.

The goal for the first major release is to create a "dashboard" plugin, that provides a user-friendly interface for writing posts and managing your Hypermedium website, without needing to have any prior web development experience.

# Quick Start
Hypermedium can be used from the command line, or as a NodeJs module. In either case, you should install Hypermedium and any plugins into a local project directory.

```bash
mkdir my-website
npm init
npm install hypermedium @hypermedium/core 
```

Although not strictly required, you should always use the `@hypermedium/core` plugin, as it provides many useful features for building most websites.

Other useful plugins:
 - `@hypermedium/markdown` - markdown to HTML rendering
 - `@hypermedium/sass` - SASS to CSS compiler

## Plugin File
Your website is a Hypermedium plugin. Before you do anything, you need to make a plugin file. In the root of your project directory, create `index.js`:

```javascript
module.exports = {
	name: 'my-website',
	version: '1.0.0',
	pluginApi: '1',
	dependencies: ['core'],
	moduleFactory: (options) => {
		return {
			files: ['dist'],
			hypermedia: {
				sitePaths: ['site'],
				processors: {
					pre: [{
						name: 'self'
					}],
				}
			},
			renderer: {
				templatePaths: ['templates'],
				partialPaths: ['partials'],
				profileLayouts: {
					'/schema/homepage': 'layouts/homepage.hbs',
				},
				context: {
					title: 'My Website',
				}
			},
			build: {
			}
		};
	}
};
```

If the `main` property in your `package.json` is set, Hypermedium will look there instead of `index.js`.

## JSON-LD Page
Now we need to make a JSON-LD file representing a web page. Hypermedium will turn this into HTML.  
Create a directory in the project root called `site` (the plugin file specifies this in `sitePaths`).

Let's make a homepage `site/index.json`:

```json
{
	"title": "My Website",
	"body": "Welcome to my Hypermedium website!",
	"_links": {
		"profile": {
			"href": "/schema/homepage"
		},
		"socialMedia": [{
			"title": "Github",
			"href": "https://github.com/elliothatch/hypermedium/"
		}, {
			"title": "npm",
			"href": "https://www.npmjs.com/package/hypermedium"
		}]
	}
}
```

## Run Hypermedium
Hypermedium can be used from the command line to generate a static website to be used with any HTTP server.
```bash
> npm start -- hypermedium -O my-website
```

This will create an `export/` directory in your project root, containing your website.

You can also run Hypermedia as its own standalone HTTP server. When running in server mode, all source files are watched and your entire site will be automatically updated to include live edits.
```bash
> npm start -- hypermedium -S my-website
```

Now we can open our web browser and view our page at `localhost:8080`!

## Debugging
If the web page doesn't load, or it shows you an error, we can trace the issue to the source through Hypermedium's log output.

Hypermedium outputs its logs as line-separated JSON, which is difficult to read by itself. It is highly recommended you use a log viewing tool, such as [sift](https://github.com/elliothatch/sift), while working with Hypermedium.

Install sift as a dev dependency:
```bash
> npm install -D sift-cli
```

Then, add the following scripts to your `package.json`:

```javascript
  "scripts": {
  	"build": "sift hypermedium -O my-website",
  	"dev": "sift hypermedium -S my-website",
  	"start": "hypermedium -S my-website"
  }
```

Now you can use `npm run dev` to start an interactive session with live-editing, or `npm run build` to export a static site. If you have errors in your site, sift will display them in bright red. Select a log with the `ARROW KEYS`, then press `ENTER` to expand the view and show the details of the error.

## Layout
The webpage you see is created using the default layout from `@hypermedium/core`. While functional, you probably want to customize the layout for your homepage. Let's make our own layout just for the homepage.

In the root of your project, create a directory called `partials`, containing another directory called `layouts`. Then in the `layouts` folder create a file called `homepage.hbs`.

```handlebars
<h1>{{title}}</h1>
<p>{{body}}</p>
<h2>Social Media</h2>
<ul>
	{{#each _links.socialMedia}}
		<li>{{hal-link "socialMedia" this}}</li>
	{{/each}}
</ul>
```

Hypermedium uses [handlebars.js](https://handlebarsjs.com/) to template and render HTML. When you navigate to a page, Hypermedium checks if the document has any `profile` values among its `_links`. It then uses the plugin file's `renderer.profileLayouts` to search for a layout file.
The search locations for all Handlebars partials, including layouts, are configured with `renderer.partialPaths`.

If a matching layout is found, it is used to render the page using the current template.
A template is the top-level HTML file that layouts are inserted into. The default template places the layout contents in a `<main>` tag inside the body of the page. It also provides some boilerplate HTML and slots for a page header and footer.

To create more layouts for different kinds of pages (posts, profile page, archive), create a new file in the `layouts` folder, then create a `profileLayouts` entry in plugin file. Make sure to restart the Hypermedium server whenever you change the plugin file.  
Ensure you have a corresponding `profile` link on the pages you want to use the layout.

You can use Handlebars expressions to retrieve any data from the current JSON document. The core plugin also provides several useful helpers and partials.

### Includes
You can fill the default template's header and footer slots by creating "include partials". In the `partials` directory, create an `includes` directory and inside it create a file called `header.hbs`.

```handlebars
<header>
	<h1><a href="/">{{_site.title}}</a></h1>
</header>
```

Refresh the page and you will see your header at the top.

To reuse bits of HTML across multiple layouts, create an include, then import it with Handlebars partial syntax:

```handlebars
{{> includes/myInclude }}
```

## Styling
The homepage is looking a little bare, so let's add some color! First let's tell the page where to find a stylesheet, by filling the default template's `head` slot, which is placed in the `<head>` of the HTML document.

Create `partials/includes/head.hbs`:
```
<link rel="stylesheet" href="/css/styles.css">
```

Now we just need to make the stylesheet. We could write it manually, or we can generate it with the `@hypermedium/sass` plugin.

If you don't already have it installed, run:

```bash
> npm install @hypermedium/sass
```

Add `sass` to the dependencies of the plugin file (`index.js`).
We also need to to include a SASS build step in the plugin file. Add the following inside the `build` property.
```javascript
buildSteps: {
	sType: 'task',
	definition: 'sass',
	options: {
		// include node_modules so we can @use any installed package (e.g. sanitize.css)
		includePaths: [require('path').join(__dirname, 'node_modules')]
	},
	watch: true,
	files: [{
		inputs: {target: ['sass/styles.scss']},
		outputs: {
			css: ['dist/css/styles.css'],
			sourceMap: ['dist/css/styles.css.map'],
		}
	}]
}
```

Now create the `sass` directory and inside it create the file `styles.scss`:
```scss

```

Since we configured the build step with `watch: true`, Hypermedium will automatically regenerate `css/styles.css` whenever we change `scss/styles.scss`, while running in server mode.

## Plugin Options
Every plugin is required to have the following fields:
 - `name`: A unique name for your plugin.
 - `version`: Semantic version number of your plugin. This is important for plugins designed to be used by other people.
 - `pluginApi`: Used by Hypermedium to interpret your plugin format, for backwards compatibility in case the plugin API changes in the future.
 - `dependencies`: a list of Hypermedium plugin `name`s that this plugin depends on.
 - `moduleFactory`: Hypermedium calls this function to initialize your plugin and create a Module. You can run any code you need in the moduleFactory, but it must return a valid Module.

There are also optional fields:
 - `defaultOptions`: These are the default options provided to the `moduleFactory` function. They can be manually overridden by the user to configure the plugin.
 - `basePath`: The path to the root directory of the plugin, relative to the plugin file. All file resolutions when accessing files in the module are relative to this path. For example, if a plugin has a file `$basePath/images/image.jpg`, other plugins can access this file with `$name/images/image.jpg`, where `$name` is the name of the plugin.

## Module Factory
A Hypermedium plugin is a collection of code and assets. To use a plugin, Hypermedium calls its `moduleFactory` function, which must return a module--an instance of the plugin. Modules are designed to be highly configurable, and can dynamically configure themselves in their `moduleFactory`.

`moduleFactory` is called with an `options` object. This object can contain configuration data specific to the plugin. There is currently no way for the user to provide custom options to the module on initialization.

`moduleFactory` must return a module object. All of the fields of a module are optional:
 - `hypermedia`
 - `renderer`
 - `build`

<!---
# Overview
Features:
 - Simple templating: Create a template for the overall structure of your site, then further customize how specific types of posts are displayed with the layout system.
 - Fully customizable: Hypermedium completely separates the data that makes up your posts and how they are presented in your web browser, giving you full control over how your website looks, even when extending it with plugins.
 - Extendable: Plugins are simple to integrate into your site and easy to create using modern Javascript tools and libraries. Since the core resources of your site are just JSON objects, plugins can build on each other and enrich your pages without relying on hardcoded HTML or complex hooks.
 - Easy to set up: No need to set up a database to start building your website.

## Hypermedia Engine
The hypermedia engine is at the core of Hypermedium. Every page on your site starts as a simple JSON object in [HAL format](http://stateless.co/hal_specification.html). Then Hypermedium processors you've configured will automatically modify or extend these resources to create a complex and interconnected web of data representing your entire site. For example, the `makeIndex` processor allows you to create a table of contents style index page containing all the blog posts on your site. Then you can add the `embed` plugin to include a short summary of each post based on its first paragraph of text. Whenever you publish a new post or edit an existing post, Hypermedium automatically updates the index page to include the latest title and summary for each of your posts.

Since all this processing is happening at the JSON data layer, it's easy to mix and match multiple processors without needing to worry about compatibility or visual congruity. You have full control over the appearance of your website in the next step with the HTML renderer.

## HTML Renderer
The HTML renderer takes a HAL resource and converts it into a full HTML page that can be viewed in your web browser. Based on the minimal but powerful [handlebars template engine](https://handlebarsjs.com), the HTML renderer allows you to easily display all the rich data from your HAL resources however you like. Create the base template that ties together your whole site with one unified look, and then further customize the layout for each specific type of page, be it a blog post, image gallery, or a unique page like your homepage. Since layouts inherit the look of your base template, it's easy to utilize advanced user interfaces from plugins while maintaining the look and feel of your personal website.

## Build Manager
Advanced sites may require extensive preprocessing steps to generate javascript, stylesheets, and other assets that your webpages rely on. The build manager is a general-purpose tool for organizing and running these tasks, allowing you to leverage 3rd party tools like [SASS](https://sass-lang.com), [Rollup](https://rollupjs.org), and [React](https://reactjs.org) while building your website.

## Plugins
The flexible plugin system allows you to extend any part of your website by enhancing the hypermedia engine, HTML renderer, and build system. In fact, when you create a website, you're really just creating a Hypermedium plugin.

## Dashboard (WIP)
The live dashboard gives you full control over your website. This is where you create, edit, and publish posts. You can also manage plugins, processors, templates, layouts, and build tasks.
--->

# Roadmap
The ultimate goal for Hypermedium is to provide a friendly, WYSIWYG user experience that can be used by anyone to build fully featured, dynamic websites.
This experience will be delivered through a live web dashboard (implemented as a Hypermedium plugin), similar to other popular CMSs.

The primary use case is for blogs and focused websites whose main purpose is to deliver content or information to their audence.
Hypermedium plugins should also enable two-way communication between a creator and their community, through comments, a forum, storefront, etc.

From a technical standpoint, Hypermedium is focused two separate, but related tasks:
1. Building a network of interconnected resources.
2. Presenting those resources to people as a tailored, cohesive experience.

There are already many excellent tools for building different types of websites, but these tools are almost exclusively focused on delivering HTML to be viewed through a web browser.
Hypermedium aims to create a data-driven foundation for managing web content, assets, and interactions in a format easily understood by humans and interpreted by programs, to give users the most possible freedom in how they present that information. Whenever possible, it should leverage existing web standards ([JSON-LD](https://json-ld.org/), [schema.org](https://schema.org/), etc.).

By basing web pages on JSON files, rather than HTML, we make it much easier to work with data and enforce its structure and schema without needing to worry about presentation. Hypermedium plugins use processors to modify and extend this data, for example, to compile Markdown into HTML.

Most importantly, whenever Hypermedium detects a JSON resource representing a web page, it adds that resource to a directed graph. Processors working on a resource can access data from _any other resource_ in the graph. Hypermedium tracks these data dependencies to automatic reprocess resources whenever a dependency is updated. We use this functionality to automatically generate indexes, build complex pages from multiple simple resources, and more.

We can present this data to users by building an API or HTML page from these JSON resources. Hypermedium matches resources to Handlebars templates based on the page's `profile` links, so it is easy to create reusable layouts or individual pages. A REST and Websocket API are planned to facilitate the creation of interactive elements like user comments and forums.

## Planned Features
 - JSON-LD API extension
 	- Plugins can add HTTP and Websocket APIs that are exposed through a standarized JSON-LD extension.
 - Data sources
 	 - Interface for plugins to store and read dynamic data.
 	 - Interchangable data sources including file system, SQL databases, etc.
 - Javascript Components
 	 - Register Javascript modules with the plugin system, so they can be easily integrated into other plugins and templates.
 - Plugins
 	- User authentication
 	- Live admin dashboard
		- create and edit JSON-LD resources
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

# Development
This monorepo contains hypermedium and several crucial plugins, managed with yarn workspaces. The following commands should be run in the repo root directory.

## Install
```
yarn

# use repo local versions of packages
cd hypermedium
yarn link
cd ..
yarn link hypermedium
cd ..
# etc
```

## Build
```
yarn build
```

## Run demo site
```
yarn demo
```

## Export demo site to static HTML
```
yarn demo-export
```

## Run
Create a directory for your plugin/site (see ./hypermedium-demo), then run the following command to start the Hypermedium server:
```
yarn start -S pathToPluginDir
```

Or to launch with sift:

```
yarn dev -S pathToPluginDir
```

## Export
To output static HTML to the directory `pathToPlugin/export`:
```
yarn start -O pathToPluginDir
```

By default, Hypermedium won't overwrite any files on export. Use the `-f` flag to force overwriting:
```
yarn start -O -f pathToPluginDir
```


## Notes
We use nohoist for build assets in the demo workspace, so the sass includePath is the same as if you downloaded and modified the demo package directly.

<!---
Rework markdown processor. Extract title and other metadata directly from md file? Are we just reinventing jekyll frontmatter?
--->

## Publish
cd into the `hypermedium` or plugin directory, update the `package.json` version, and then build and publish.
```
yarn build
yarn publish
```

For the scoped plugin packages, you must explicitly specify public access:
```
yarn publish --access public
```
