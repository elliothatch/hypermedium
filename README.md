# freshr
## a blogging platform for all!
Freshr lets you create dynamic, personalized websites with its reactive hypermedia engine, customizable HTML renderer, and flexible build system, and allows you to enhance your site with its extendable plugin system.

 - Let freshr processors do the hard work by enhancing your pages with dynamic data--whether that's creating an index of all your posts or displaying your users' latest comments.
 - Maintain full creative control over the look and feel of your site with the fully customizable HTML renderer
 - Utilize 3rd party tools to perform advanced asset preprocessing with the build system.

Freshr can be used as a library or a standalone webserver.

# Overview
## Hypermedia Engine
The hypermedia engine is at the core of freshr. Every page on your site starts as a simple JSON object in [HAL format](http://stateless.co/hal_specification.html). Then freshr processors you've configured will automatically modify or extend these resources to create a complex and interconnected web of data representing your entire site. For example, the `makeIndex` processor allows you to create a table of contents style index page containing all the blog posts on your site. Then you can add the `embed` plugin to include a short summary of each post based on its first paragraph of text. Whenever you publish a new post or edit an existing post, freshr automatically updates the index page to include the latest title and summary for each of your posts.

Since all this processing is happening at the JSON data layer, it's easy to mix and match multiple processors without needing to worry about compatibility or visual congruity. You have full control over the appearance of your website in the next step with the HTML renderer.

## HTML Renderer
The HTML renderer takes a HAL resource and converts it into a full HTML page that can be viewed in your browser. Based on the simple but powerful [handlebars template engine](https://handlebarsjs.com), the HTML renderer allows you to easily display all the rich data from your HAL resources however you like. Create the base template that ties together your whole site with one unified look, and then further customize the layout for each specific type of page, be it a blog post, image gallery, or a unique page like your homepage. Since layouts inherit the look of your base template, its easy to utilize advanced user interfaces from plugins, while maintaining the look and feel of your personal website.

## Build System
Advanced sites may require extensive preprocessing steps to generate javascript, stylesheets, and other assets that your webpages rely on. The build system is a general-purpose tool for organizing and running these tasks, allowing you to leverage 3rd party tools like [SASS](https://sass-lang.com), [Rollup](https://rollupjs.org), and [React](https://reactjs.org) while building your website.

## Plugins
The flexible plugin system allows you to extend any part of your website by enhancing the hypermedia engine, HTML renderer, and build system. In fact, when you create a website, you're really just creating a freshr plugin.

## Dashboard (WIP)
The live dashboard gives you full control over your website. This is where you create, edit, and publish posts. You can also manage plugins, processors, templates, layouts, and build tasks.

# usage
## standalone server
### install

## library

# development
## build

```
yarn
```

or

```
npm install
```

## run demo

```
yarn start
```

or

```
npm start
```

# road plan
the platform can perform these actions live, through the dashboard:
 - create and edit HAL resources
 - create and edit assets
 - install and remove plugins
 - create live draft versions of the website
 - track and commit changes with git
 - create tasks that can be used as build steps
 - configure dynamic data store

## plugins
the goal: I want to add a forum to my website. Install Plugin "Forum". The plugin is live and can be configured through the dashboard. Customize the HTML template for forum posts, or import a template file and use that instead. The forum posts are stored in the configured data store.

breaking down the structure of this plugin (ignoring user authentication):
 - HAL assets
 	 - resources describing the homepage, thread pages, etc. these resources create the structure of the site's URIs and describe how dynamic data is embedded
 - HTML assets
 	 - handlebars templates and helpers to render those HAL assets (identified by profile)
 	 - scss to be used in the build system, css, javascript, etc.
 - Express middleware
 	 - handles endpoints for creating threads and posts. in this case, creates a corresponding HAL resource. the hypermedia engine detects the change and reprocesses the "thread" resource to include the new post.
 	 - if we were using an external data source, we could implement custom code here to fetch and process the data.
 - webhooks using the Webhook plugin, so other sites can immediately be notified of new posts

each plugin can:
 - extend the hypermedia engine
   - add custom processors
   - add triggers? periodic processors that can update or create resources
 - extend the HTML engine
   - add handlebars helpers
 - extend the build engine
	 - add tasks that can be used as build steps
 	 - add task blueprints that depend on external libraries (e.g. compile sass)
 - add endpoints in express
 - create new data store types?
 - include assets
 	 - static assets that can be used in the build engine, e.g. templates, images
 	 - HAL resources
 - access and extend configurations of other plugins

### plugin structure

Each plugin is an node module. An optional "package.json" may be provided to configure custom options and paths for files.

The following properties are used by freshr when loading a plugin if they exist:
 - `main` - path to the plugin module. default: 'index.js'
 - `freshr` - object for freshr specific configuration options, containing the following optional properties:
 	- `basePath` - base path used as the root for all other path lookups in this plugin. default: '.'. Often used to specify a `build` directory for plugins that have their own build pipeline (e.g. typescript).
 	- `baseUrl` - default base URL that all API and resources in `site` directory should be served at. This may be modified when a plugin is registered. this allows self-contained modules to be easily added to a site (e.g. a forum-subsite). if undefined, the no resources will be served by the web server (useful if you are only using the resources in your own build tasks). default `undefined`
    - `templates` - path to the templates directory. default: `templates`
    - `partials` - path to the templates directory. default: `partials`
    - `components` - path to the client-side js components directory. default: `components`

 #### plugin module
All server-side code, such as API implementations, hypermedia processors, build task definitions, and handlebars helpers, are provided through the plugin module.

A plugin module is a CommonJS module that exports a module factory -- a function that takes freshr plugin options as input and returns a module instance. This allows one plugin to be used for multiple different uses in the same freshr site. For example, a forum plugin could be used to run multiple forums side-by-side with different API URLs and configurations.

Some plugins utilize the freshr build system to build some of their files. This build step occurs after the module is initialized, so the plugin can use build task defintiions added by the module. This also allows build steps to be customized through plugin module options.

#### components
A component is an ES6 module that can be used in client-side javascript. Freshr uses Rollup to bundle components, and makes them accessible to your site with aliased imports, namespaced by the plugin name.

For example: The filesystem plugin contains the `file-explorer.js` component which exports a React component that renders an interactive file explorer which is populated from the FileSystem websocket API (implemented in the plugin module).

You can import this component with the following line of javascript:

```js
import { FileExplorerComponent } from 'filesystem/file-explorer';
```

#### templates
Each template is a handlebars (.hbs) file which specifies a root-level HTML document. Custom templates give a plugin full control over the HTML generated by the renderer.

#### partials
Each partial is a handlebars (.hbs) file containing a partial template. These partials are registered in the renderer so they can be utilized by your site or other plugins.

#### HAL resources
TODO
If your plugin contains resources that need to be processed by the hypermedia engine and served to users, they may be provided here. E.g. a forum index page.

#### generic assets
TODO
Your plugin may include arbitrary assets that aren't processed by freshr directly. These may be images, stylesheets, or any other files you want to provide to the server or client.

# notes
plugins have too many different configuration files and pieces. here's what we really need:
 - options that tell freshr where to find files when loading plugin:
    - these are currently provided in the package.json
    - basePath: not necessary, but simplifies defining other paths
    - templates/partials: used for HTML renderer. maybe require these to be grouped?
    - components: javascript specific
    - site: where the HAL resources are located. configuring these paths by themselves doesn't do anything (requires hypermedia option as well). is there a situation where we want to be able to access these paths without automatically serving them? e.g. as a template/source for processors?
    - hypermedia: configuring this lets freshr know that we want to serve these resources AS IS as soon as we register the plugin. can provide a base URL, essentially creating a mini website inside the website. can specify a custom template to be used (what if you want to override?)
 - module options: not just JSON, but actual javascript module that is executed.
 	 - necessary for executable plugin code:
		 - hypermedia processors
		 - handlebars helpers
		 - websocket middleware
		 - build task definitions
	 - we also have some "static" configuration options here:
	 	 - build steps to be executed before the plugin is registered
 	 - useful because a module is a "factory"
		 - passed options when registered, allowing for customization on use
		 - can be instantiated multiple times, with different options
		 	 - currently you could run into problems if you dynamically generate the build steps, since multiple instances will be using the same physical files on disc. 2nd instance may delete or overwrite files that first instance relies on
		 	 - solution: instances always copy the entire plugin to a new (ephemeral?) directory. this makes a lot of sense but also increases filesize, especially if the plugin has a lot of assets, like images/icons/etc.
		 	 - most plugins probably don't need this level of isolation? but then if you didn't need multiple discrete copies, you wouldn't instanciate multiple?

Possible simplifications
 - no static "JSON" configuration file. everything is included in the module
 	 - pros:
 	 	 - simple, only one file required
 	 	 - potential to customize all options at instancing time
 	 - cons:
 	 	 - increases attack surface
			 - but we're already executing arbitrary code anyway...
			 - makes it slightly more complex to create "asset bundle" plugins that don't need to execute code, if we allow plugins to forgo a module file
			 - lose some peace of mind when including "asset bundle" plugins (which don't necessarily require the user to check for malicious code)
 	 	 - increases chances of plugin loading failure
 	 	 	 - is this a concern? if the plugin is broken it's broken...
 - how do we determine we're looking at a (valid) freshr plugin?
 	 - existence of "freshr" option in package.json

each instance will re-register templates/partials/processors etc. no way currently to specify which instance of those to use, unless you manually prefix the instances based on options parameter
multi-instancing creates a lot of issues with namespacing/symbol names, essentially means many/all the assets in plugin must be dynamically generated (during build phase).

how useful is it to change the path of templats/partials/components/site/etc at instance time? can't see any situation where it would be beneficial. why would the build steps create different directories based on parameters? currently freshr will just register everything at plugin top-level namespace anyway.
why limit it though? is it any simpler to have a completely separate config file just for "static" options? perhaps if you generate the config option with a tool, etc. but that seems like an extreme edge case. you can always have your plugin instance code load the data dynamically from your tool-generated files anyway.

what about installing plugins? npm install is nice. also nice to just be able to clone/copy plugins you want. remember that eventually freshr will be doing this for you

potential to implement "preview draft" just by reinstancing user's site plugin with a temporary base URL. publishing the draft simply copies the new src/page files back onto the main plugin
 - again... we could make a complete copy of the site by reinstancing everything. then all the plugins need to handle the namespacing issues automatically
 - would also potentially have poor performance--have to copy/reinstance/rebuild all plugins?

reinstancing could work with HTML renderer pieces if all partials/layouts/templates are accessed with helper functions. each instance would get its own version of the "lookup asset" helper that rewrites the path.
I don't think handlebars has a way to register/pass helper function on a per-template basis. however, we could include data in the context, and maybe even have that context automatically included in the helper call somehow? otherwise you have to pass the context to the lookup function every time, not the simplest solution

plugin dependencies:
 - plugins should have to explicitly list all the plugin dependencies they have.
 	 - allows us to create dependency graph, register plugins in correct order, detect conflicts, etc.
	 - specify version number
 	 - how does instancing affect this?
		 - specify whether to use shared or separate instance of the dependency?
			 - default shared
			 - can specify initialization options for instanced dependnencies


new plugin format
 - freshr only directly cares about one file: javascript module file.
 - export.default must be a Plugin object
 - loadPlugin: executes the module, returning a Plugin:
 - Plugin contains ModuleFactory, default FactoryOptions, buildTasks, and dependency array
 - plugin is added to dictionary of loaded plugins
 - if module file is changed, don't (directly) do anything. the plugin must be explicitly unloaded and reloaded to update version, etc.
 - future: option to auto-install dependencies at this point

new Module: creates an isolated (or not) module, that can later be registered into freshr
 - inputs: name of plugin, standard plugin options, custom plugin-specific options, dependencies
 - before executing registerPlugin, the caller MAY retrieve the defaultOptions fron the loaded plugin and use those as the base
 - unspecified options are NOT automatically set to defaults (important for intentionally null values)
 - error if plugin not loaded or missing dependencies
 - all module code should use relative paths. these will be prepended with the modulePath
 - if modulePath is specified, the entire plugin directory is copied into the modulePath (fully isolated copy), otherwise set modulePath to the plugin directory
 - executes ModuleFactory with options
 - returns Module (instance of a plugin).
 	- full set of plugin options passed to the factory
 	- buildSteps
    - FileWatcher: stream of notable plugin file events
		- added, changed, removed
    	- template, partial, 
    - informational data (template/partial/site/components paths, etc.). no action is required by caller, but may be useful for debugging or further interactions with the plugin
    - hypermedia engine options (processors)
    - html renderer options (handlebars helpers)
 - now the caller can make custom modifications to build steps, hypermedia options, etc. (why??)

registerModule: hooks up the module to the live freshr
 - install processors, handlebars helpers, etc
 - subscribe to fileWatcher, which registers templates/partials, loads HAL resources into hypermedia engine, etc.
 - if build enabled, execute build steps
 - return build stream

auto installation:
 - pulls down plugin from source (e.g. npm, git repo)
 - auto-loads the plugin

concerns:
 - are separate "initializeModule" and "registerModule" steps necessary?
 	 - pros: allows moduleFactory to customize buildSteps, etc, and then gives user a chance to further customize buildSteps
 	 - does the module really need to customize the build steps? can't it have a "defaultBuildSteps" returned in loadPlugin, and then allow user to customize the build steps from there?
 	 - concern: how do the paths get set if a mirrored instance is created? it is prepended to buildSteps regardless? think about the user's site-plugin. we may want to include files outside of the plugin (dependencies)
 	 - note: TaskDefinitions are NOT customizable by module factory, and can be used as soon as the module is loaded.


# demo
We use nohoist for build assets in the demo workspace, so the sass includePath is the same as if you downloaded and modified the demo package directly.
