import React from 'react';
import ReactDOM from 'react-dom';

/**
 * Single-page application that uses fetch API to navigate and interact with HAL sites
 * documents may contain the "_ws" property, indicating that live updates may be obtained from that resource. "_ws" has the same structure as "_links", but to websocket addresses
*/

/*
 * entry:
 *   name{string}
 *   path{string}
 *   type{'file' | 'directory'}
 *   entries{entry[]}
 */
class HypermediaClient extends React.Component {

	render() {
		return 
			<div>
			<div className="page-content">
			</div>
		</div>;
	}
}
