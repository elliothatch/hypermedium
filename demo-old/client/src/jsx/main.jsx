import React from 'react';
import ReactDOM from 'react-dom';

class ConfigComponent extends React.Component {
	render() {
		return <div></div>;
	}
}

render();

function render() {
	const element = <ConfigComponent />;
	ReactDOM.render(
		element,
		document.getElementById('root')
	);
}
