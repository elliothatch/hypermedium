# freshr
## a blogging platform for all!
a HAL hypermedia engine for dynamic resources with a highly customizable HAL to HTML renderer

# build

```
yarn
```

or

```
npm install
```

# usage

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
