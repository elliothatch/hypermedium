import React from 'react';
import ReactDOM from 'react-dom';

/*
 * entry:
 *   name{string}
 *   path{string}
 *   type{'file' | 'directory'}
 *   entries{entry[]}
 */
class ConfigComponent extends React.Component {

	handleClickBuild(event) {
		// configSocket.emit('build');
	}

	render() {
		return <div>
			<header>
				<h1 className="title">Freshr Configuration</h1>
			</header>
			<div className="page-content">
			</div>
		</div>;
	}
}

render();

function render() {
	const element = <ConfigComponent />
	ReactDOM.render(
		element,
		document.getElementById('root')
	);
}


