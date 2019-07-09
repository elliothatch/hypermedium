const Path = require('path');
const { src, dest, parallel, series } = require('gulp');
// const rename = require('gulp-rename');
// const gulpif = require('gulp-if');
// const del = require('del');

function createPluginTask(pluginName) {
	return parallel(
		() => {
			return src(Path.join('src', 'plugins', pluginName, 'templates', '**', '*'))
				.pipe(dest(Path.join('build','plugins', pluginName, 'templates')));
		},
		() => {
			return src(Path.join('src', 'plugins', pluginName, 'partials', '**', '*'))
				.pipe(dest(Path.join('build','plugins', pluginName, 'partials')));
		}
	);
}

// function clean() {
	// return del('build');
// }

function corePlugin() {
	return src([
		'src/plugins/core/templates/**/*',
		'src/plugins/core/partials/**/*'
	]).pipe(dest('build/plugins/core'));
}

// exports.clean = clean;
exports.corePlugin = createPluginTask('core');
exports.default = exports.corePlugin;
// exports.default = series(clean, corePlugin);
