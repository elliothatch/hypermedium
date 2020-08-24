const materialIconsModuleFactory = (options, freshr) => {
	return {
		buildSteps: {
			sType: 'multitask',
			steps: [{
				sType: 'task',
				definition: 'regex',
				options: {
					rules: [{
						regex: /url\(/g,
						replace: 'url(/material-icons/fonts/'
						// TODO: make this configurable via options
					}]
				},
				files: [{
					inputs: {target: ['node_modules/material-design-icons/iconfont/material-icons.css']},
					outputs: {destination: ['build/css/material-icons.css']}
				}]
			}, {
				sType: 'task',
				definition: 'copy',
				files: [{
					inputs: {target: ['node_modules/material-design-icons/iconfont/MaterialIcons-Regular.woff2']},
					outputs: {destination: ['build/fonts/MaterialIcons-Regular.woff2']}
				}, {
					inputs: {target: ['node_modules/material-design-icons/iconfont/MaterialIcons-Regular.woff']},
					outputs: {destination: ['build/fonts/MaterialIcons-Regular.woff']}
				}, {
					inputs: {target: ['node_modules/material-design-icons/iconfont/MaterialIcons-Regular.eot']},
					outputs: {destination: ['build/fonts/MaterialIcons-Regular.eot']}
				}, {
					inputs: {target: ['node_modules/material-design-icons/iconfont/MaterialIcons-Regular.ttf']},
					outputs: {destination: ['build/fonts/MaterialIcons-Regular.ttf']}
				}]
			}]
		}
	};
};

exports.default = materialIconsModuleFactory;
