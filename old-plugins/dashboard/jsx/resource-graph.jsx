import cytoscape from 'cytoscape';
// import dagre from 'dagre';
import cytoscapeDagre from 'cytoscape-dagre';
import klay from 'cytoscape-klay';
import coseBilkent from 'cytoscape-cose-bilkent';

cytoscape.use(cytoscapeDagre);
cytoscape.use(klay);
cytoscape.use(coseBilkent);
// const graph = dagre.graphlib.json.read(window.freshrResource.graph);
// graph.setGraph({});
// graph.setDefaultEdgeLabel(() => ({}));

// dagre.layout(graph);
// console.log(graph);


const graphData = window.freshrResource.graph;
const nodes = graphData.nodes.map((node) => {
	return {
		data: {
			id: node.v,
			origin: node.value.origin,
		}
	};
});

const edges = graphData.edges.map((edge) => {
	return {
		data: {
			source: edge.v,
			target: edge.w,
		}
	};
});

const cy = cytoscape({
	container: document.getElementById('resource-graph'),
	elements: {
		nodes,
		edges,
	},
	style: [
		{
			selector: 'node',
			style: {
				'label': 'data(id)',
				'width': 'label',
				'height': '70px',
				'shape': 'round-rectangle',
				'background-color': '#666',
				'padding': '10px',

				'color': '#fff',
				'text-valign': 'center',
			}
		},
		{
			selector: "node[origin != 'fs']",
			style: {
				'background-color': '#557',
			}
		},
		{
			selector: '.hover, .child, .parent',
			style: {
				'color': '#000',
			}
		},
		{
			selector: '$node.hover',
			style: {
				'background-color': '#ddd',
				'label': 'data(id)'
			}
		},
		{
			selector: '$node.parent',
			style: {
				'background-color': '#66ff66',
				'label': 'data(id)'
			}
		},
		{
			selector: '$node.child',
			style: {
				'background-color': '#ff6666',
				'label': 'data(id)'
			}
		},
		{
			selector: 'edge',
			style: {
				'width': 3,
				'line-color': '#ccc',
				'arrow-scale': 2,
				'mid-target-arrow-color': '#ccc',
				'mid-target-arrow-shape': 'triangle',
			}
		},
		{
			selector: '$edge.hover',
			style: {
				'width': 3,
				'line-color': '#fff',
				'arrow-scale': 2,
				'mid-target-arrow-color': '#fff',
				'mid-target-arrow-shape': 'triangle',
			}
		},
		{
			selector: '$edge.parent',
			style: {
				'width': 3,
				'line-color': '#cfc',
				'arrow-scale': 2,
				'mid-target-arrow-color': '#cfc',
				'mid-target-arrow-shape': 'triangle',
			}
		},
		{
			selector: '$edge.child',
			style: {
				'width': 3,
				'line-color': '#fcc',
				'arrow-scale': 2,
				'mid-target-arrow-color': '#fcc',
				'mid-target-arrow-shape': 'triangle',
			}
		},
	],
	layout: {
		name: 'klay',
		klay: {
			// edgeSpacingFactor: 1,
			spacing: 30,
		},
		// name: 'dagre',
		// name: 'grid',
		// rows: 5,
		// transform: (node, position) => {
			// position.y += position.x/5;
			// return position;
		// },
			//
		// name: 'cose-bilkent',
		// idealEdgeLength: 200,
	}
});

const highlightedNodes = [];
const highlightedEdges = [];

cy.on('mouseover', 'node', (event) => {
	event.target.outgoers().map((edge) => {
		edge.addClass('parent');
		edge.target().addClass('parent');
	});

	event.target.incomers().map((edge) => {
		edge.addClass('child');
		edge.source().addClass('child');
	});

	event.target.addClass('hover');
});
cy.on('mouseout', 'node', (event) => {
	event.target.outgoers().map((edge) => {
		edge.removeClass('parent');
		edge.target().removeClass('parent');
	});

	event.target.incomers().map((edge) => {
		edge.removeClass('child');
		edge.source().removeClass('child');
	});

	event.target.removeClass('hover');
});

cy.on('click', 'node', (event) => {
	if(event.originalEvent.ctrlKey) {
		window.open(event.target.id());
	}
});
