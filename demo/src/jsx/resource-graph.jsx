import cytoscape from 'cytoscape';
import dagre from 'dagre';
import cytoscapeDagre from 'cytoscape-dagre';

// cytoscape.use(cytoscapeDagre);

const graph = dagre.graphlib.json.read(window.freshrResource.graph);
graph.setGraph({});
graph.setDefaultEdgeLabel(() => ({}));

dagre.layout(graph);
// console.log(graph);

const resourceGraph = cytoscape({
	container: document.getElementById('resource-graph'),
	elements: graph,
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
				'target-arrow-color': '#ccc',
				'target-arrow-shape': 'triangle'
			}
		}
	],
	layout: {
		name: 'grid',
		rows: 1
	}
});
