import cytoscape from 'cytoscape';
// import dagre from 'dagre';
import cytoscapeDagre from 'cytoscape-dagre';

cytoscape.use(cytoscapeDagre);

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

const resourceGraph = cytoscape({
	container: document.getElementById('resource-graph'),
	elements: {
		nodes,
		edges,
	},
	style: [
		{
			selector: 'node',
			style: {
				'background-color': '#666',
				'label': 'data(id)'
			}
		},
		{
			selector: 'edge',
			style: {
				'width': 3,
				'line-color': '#ccc',
				// 'target-arrow-color': '#ccc',
				// 'target-arrow-shape': 'triangle'
				'arrow-scale': 2,
				'mid-target-arrow-color': '#ccc',
				'mid-target-arrow-shape': 'triangle',
			}
		}
	],
	// layout: {
		// name: 'grid',
		// rows: 1
	// }
});
